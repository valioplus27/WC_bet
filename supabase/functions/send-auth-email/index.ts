// ============================================================================
// send-auth-email — handler for Supabase Auth's "Send Email" hook. Auth calls
// this (instead of its own shared, rate-limited mailer) for every auth email —
// magic links, signup confirmations, password resets, email-change confirmations
// — so the group can sign in without hitting "email rate limit exceeded".
//
// Contract (Authentication → Hooks → Send Email): Auth POSTs a Standard
// Webhooks-signed JSON body shaped like
//   { user: {...}, email_data: { token, token_hash, redirect_to, email_action_type, site_url } }
// We verify the signature, render a branded email for the action type, and
// deliver it through Resend's API. Errors are logged here with detail and
// returned in the { error: { http_code, message } } shape Auth expects —
// the user just sees a generic "error sending confirmation email".
//
// One-time setup, in order:
//   1. supabase functions deploy send-auth-email --no-verify-jwt
//      (the flag matters: Auth calls hooks without a user/anon JWT, authenticating
//      via the webhook signature below instead — the gateway's default JWT check
//      would reject every call with 401 before this code ever runs)
//   2. resend.com → API Keys → create one → `supabase secrets set RESEND_API_KEY=…`
//   3. Dashboard → Authentication → Hooks → enable "Send Email hook", point it at
//      this function's URL, and copy the generated secret (looks like
//      "v1,whsec_…") into `supabase secrets set SEND_EMAIL_HOOK_SECRET=…`
//   4. Verify a sending domain at resend.com/domains (add the DNS records it
//      gives you — SPF/DKIM, DMARC recommended), then
//      `supabase secrets set AUTH_EMAIL_FROM="WC 2026 Tulosveto <noreply@yourdomain.com>"`.
//      Don't skip this for a group: the sandbox sender below
//      (onboarding@resend.dev) is allowed to deliver ONLY to the address on
//      the Resend account itself — every other recipient gets back HTTP 403
//      validation_error "You can only send testing emails to your own email
//      address (...). To send emails to other recipients, please verify a
//      domain…", which this function surfaces as the 502 "Resend rejected
//      the email (HTTP 403): …" below (Auth then flattens that to its own
//      generic "Unexpected status code returned from hook: 502"). Until a
//      domain is verified, only the account owner can ever receive mail —
//      friends' magic links and password emails will all bounce with that 502.
//
// Required secrets: RESEND_API_KEY, SEND_EMAIL_HOOK_SECRET
// Optional secret: AUTH_EMAIL_FROM — technically optional (falls back to the
// sandbox sender, see step 4 on why that's a trap for anything but solo testing)
// SUPABASE_URL is injected automatically — it's how the verification link is built.
// ============================================================================

import { Webhook } from 'npm:standardwebhooks@1.0.0'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const FROM_ADDRESS = Deno.env.get('AUTH_EMAIL_FROM')?.trim() || 'WC 2026 Tulosveto <onboarding@resend.dev>'

function errorResponse(httpCode: number, message: string): Response {
  console.error(`send-auth-email: ${message}`)
  return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
    status: httpCode,
    headers: { 'Content-Type': 'application/json' },
  })
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!)
}

// ----------------------------------------------------------------------------
// Hook payload shape (trimmed to what we use — see Supabase's Send Email hook docs)
// ----------------------------------------------------------------------------
type HookPayload = {
  user: { email: string; user_metadata?: { display_name?: string } }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: string
    site_url: string
  }
}

const ACTION_COPY: Record<string, { subject: string; heading: string; body: string }> = {
  magiclink: {
    subject: 'Your sign-in link',
    heading: 'Sign in to WC 2026 Tulosveto',
    body: 'Click the button below to sign in on this device. The link works once and expires shortly.',
  },
  signup: {
    subject: 'Confirm your email',
    heading: 'Confirm your email',
    body: 'Click the button below to confirm your address and finish creating your account.',
  },
  recovery: {
    subject: 'Reset your password',
    heading: 'Reset your password',
    body: "Click the button below to choose a new password. If you didn't request this, you can safely ignore this email.",
  },
  email_change: {
    subject: 'Confirm your new email',
    heading: 'Confirm your new email address',
    body: 'Click the button below to confirm this address as your new sign-in email.',
  },
  invite: {
    subject: "You're invited",
    heading: "You're invited to WC 2026 Tulosveto",
    body: 'Click the button below to accept your invitation and set up your account.',
  },
  reauthentication: {
    subject: 'Confirm it’s you',
    heading: 'Confirm it’s you',
    body: 'Enter the verification code below to confirm this action.',
  },
}
const DEFAULT_COPY = { subject: 'Confirm your request', heading: 'Confirm your request', body: 'Click the button below to continue.' }

function renderEmail(payload: HookPayload, verifyUrl: string): { subject: string; html: string } {
  const { email_data, user } = payload
  const copy = ACTION_COPY[email_data.email_action_type] ?? DEFAULT_COPY
  const name = user.user_metadata?.display_name?.trim()
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi,'
  const subject = `${copy.subject} — WC 2026 Tulosveto`

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <tr><td style="padding:28px 32px 0;">
        <p style="margin:0;font-size:20px;font-weight:700;">⚽ WC 2026 Tulosveto</p>
      </td></tr>
      <tr><td style="padding:20px 32px 0;">
        <h1 style="margin:0 0 12px;font-size:18px;font-weight:700;">${escapeHtml(copy.heading)}</h1>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#334155;">${greeting}</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(copy.body)}</p>
        <p style="margin:0 0 24px;">
          <a href="${verifyUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:8px;">Continue →</a>
        </p>
        <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">Or, if you're asked for a code instead of a link:</p>
        <p style="margin:0 0 24px;font-size:20px;font-weight:700;letter-spacing:0.2em;color:#0f172a;">${escapeHtml(email_data.token)}</p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">If the button doesn't work, copy and paste this link:<br/><span style="word-break:break-all;">${escapeHtml(verifyUrl)}</span></p>
      </td></tr>
      <tr><td style="padding:16px 32px 28px;border-top:1px solid #f1f5f9;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">Didn't request this? You can safely ignore this email — no changes were made to your account.</p>
      </td></tr>
    </table>
  </body>
</html>`

  return { subject, html }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorResponse(405, 'Use POST.')
  if (!RESEND_API_KEY) {
    return errorResponse(500, 'RESEND_API_KEY is not set. Run `supabase secrets set RESEND_API_KEY=…` (no redeploy needed — secrets are picked up on the next invocation).')
  }
  if (!HOOK_SECRET) {
    return errorResponse(
      500,
      'SEND_EMAIL_HOOK_SECRET is not set — copy the signing secret from Authentication → Hooks after enabling the Send Email hook.',
    )
  }
  if (!SUPABASE_URL) return errorResponse(500, 'SUPABASE_URL is missing from the function environment.')

  // The signature is computed over the *raw* request bytes — decoding to JSON
  // and re-serializing first would change whitespace and break verification.
  const rawBody = await req.text()

  let payload: HookPayload
  try {
    // Supabase shows the secret as "v1,whsec_…"; the "v1," is its own version
    // prefix and isn't part of the secret the standardwebhooks lib expects.
    const secret = HOOK_SECRET.startsWith('v1,') ? HOOK_SECRET.slice(3) : HOOK_SECRET
    const wh = new Webhook(secret)
    payload = wh.verify(rawBody, Object.fromEntries(req.headers)) as HookPayload
  } catch {
    return errorResponse(
      401,
      'Webhook signature verification failed — check that SEND_EMAIL_HOOK_SECRET matches the value shown in Authentication → Hooks.',
    )
  }

  const { user, email_data } = payload
  if (!user?.email || !email_data?.token_hash || !email_data?.email_action_type) {
    return errorResponse(400, 'Hook payload is missing required fields.')
  }

  // Mirrors what {{ .ConfirmationURL }} resolves to in Supabase's own templates:
  // a link to this project's GoTrue /verify endpoint, which redeems the token
  // and bounces the browser on to redirect_to with a live session.
  const verifyUrl =
    `${SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(email_data.token_hash)}` +
    `&type=${encodeURIComponent(email_data.email_action_type)}` +
    `&redirect_to=${encodeURIComponent(email_data.redirect_to || SUPABASE_URL)}`

  const { subject, html } = renderEmail(payload, verifyUrl)

  const sendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [user.email], subject, html }),
  })

  if (!sendResponse.ok) {
    const detail = (await sendResponse.text()).slice(0, 500)
    return errorResponse(502, `Resend rejected the email (HTTP ${sendResponse.status}): ${detail}`)
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
