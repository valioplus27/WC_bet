import { useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyAuthError } from '../lib/authErrors'

type Mode = 'password' | 'magic-link' | 'reset'

export default function SignIn() {
  const [mode, setMode] = useState<Mode>('password')

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">⚽ WC 2026 Tulosveto</h1>
          <p className="mt-1 text-sm text-slate-500">Private score-betting for the World Cup</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {mode === 'password' && (
            <PasswordSignInPanel onForgot={() => setMode('reset')} onFirstTime={() => setMode('magic-link')} />
          )}
          {mode === 'magic-link' && (
            <MagicLinkPanel onBack={() => setMode('password')} onForgotPassword={() => setMode('reset')} />
          )}
          {mode === 'reset' && <ResetPanel onBack={() => setMode('password')} />}
        </div>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Shared bits
// ----------------------------------------------------------------------------
function FieldError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  )
}

function SubmitButton({ pending, label, pendingLabel }: { pending: boolean; label: string; pendingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

function EmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor="email" className="block text-sm font-medium text-slate-700">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="you@example.com"
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
      />
    </div>
  )
}

function DisplayNameField({ value, onChange, hint }: { value: string; onChange: (value: string) => void; hint: string }) {
  return (
    <div>
      <label htmlFor="displayName" className="block text-sm font-medium text-slate-700">
        Display name <span className="font-normal text-slate-400">({hint})</span>
      </label>
      <input
        id="displayName"
        type="text"
        maxLength={40}
        autoComplete="nickname"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="What friends will see on the leaderboard"
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
      />
    </div>
  )
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-pitch-700 hover:underline">
      {children}
    </button>
  )
}

// ----------------------------------------------------------------------------
// Password sign-in — the default for returning users: one round trip, no
// email to wait on. First-timers and anyone who hasn't set a password yet
// are routed to the other two panels via the links below the form.
// ----------------------------------------------------------------------------
function PasswordSignInPanel({ onForgot, onFirstTime }: { onForgot: () => void; onFirstTime: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setStatus('submitting')

    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setError(friendlyAuthError(signInError.message))
      setStatus('idle')
    }
    // No error → the session lands and AuthProvider's listener swaps us out of here.
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-slate-600">Sign in with your email and password.</p>
      <EmailField value={email} onChange={setEmail} />
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <button type="button" onClick={onForgot} className="text-xs font-medium text-pitch-700 hover:underline">
            Forgot password?
          </button>
        </div>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
        />
      </div>
      <FieldError message={error} />
      <SubmitButton pending={status === 'submitting'} label="Sign in" pendingLabel="Signing in…" />
      <p className="text-center text-sm text-slate-500">
        First time here?{' '}
        <button type="button" onClick={onFirstTime} className="font-medium text-pitch-700 hover:underline">
          Get a magic link
        </button>
      </p>
    </form>
  )
}

// ----------------------------------------------------------------------------
// Magic link — the account-creation path, and *only* that. Submitting first
// asks email_has_account (see its migration) whether this address is already
// registered; if it is, nothing gets sent — it's turned away towards password
// sign-in instead, so an existing player never collects a redundant "sign in"
// link it doesn't need. Otherwise, clicking the emailed link both proves the
// address is real and creates the account (via the on_auth_user_created
// trigger), and lands them straight in <SetNewPassword mode="setup"> — see
// useAuth's needsPasswordSetup — which makes choosing a password the mandatory
// next step, so every account ends up with one and every sign-in after the
// first can skip the email round-trip.
// ----------------------------------------------------------------------------
function MagicLinkPanel({ onBack, onForgotPassword }: { onBack: () => void; onForgotPassword: () => void }) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'registered'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setStatus('sending')

    const trimmedEmail = email.trim()

    const { data: alreadyRegistered, error: lookupError } = await supabase.rpc('email_has_account', {
      lookup_email: trimmedEmail,
    })
    if (lookupError) {
      setError(friendlyAuthError(lookupError.message))
      setStatus('idle')
      return
    }
    if (alreadyRegistered) {
      setStatus('registered')
      return
    }

    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: window.location.origin,
        // Only matters the first time this email signs in — the on_auth_user_created
        // trigger reads it to seed profiles.display_name. Returning users keep theirs.
        data: displayName.trim() ? { display_name: displayName.trim() } : undefined,
      },
    })

    if (signInError) {
      setError(friendlyAuthError(signInError.message))
      setStatus('idle')
      return
    }
    setStatus('sent')
  }

  if (status === 'registered') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-lg font-semibold text-slate-900">You've already got an account</p>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{email}</span> already has one, so we didn't send another
          sign-in link — magic links are only for creating new accounts. Sign in with your password instead.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700"
        >
          Sign in with password
        </button>
        <button type="button" onClick={onForgotPassword} className="text-sm font-medium text-pitch-700 hover:underline">
          Forgot it? Send a reset link
        </button>
      </div>
    )
  }

  if (status === 'sent') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-lg font-semibold text-slate-900">Check your email</p>
        <p className="text-sm text-slate-600">
          We sent a sign-in link to <span className="font-medium text-slate-900">{email}</span>. Open it on this
          device to finish signing in — no password needed yet.
        </p>
        <button type="button" onClick={() => setStatus('idle')} className="text-sm font-medium text-pitch-700 hover:underline">
          Use a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-slate-600">
        New here? Enter your email and we'll send a link that signs you in and creates your account. Right after,
        you'll choose a password so every sign-in from then on is instant — no more emails to wait on.
      </p>
      <EmailField value={email} onChange={setEmail} />
      <DisplayNameField value={displayName} onChange={setDisplayName} hint="shown on the leaderboard" />
      <FieldError message={error} />
      <SubmitButton pending={status === 'sending'} label="Send magic link" pendingLabel="Sending…" />
      <p className="text-center text-sm">
        <BackLink onClick={onBack}>← Back to sign in</BackLink>
      </p>
    </form>
  )
}

// ----------------------------------------------------------------------------
// Forgot password — plus a quiet escape hatch for the one case the mandatory
// setup step (<SetNewPassword mode="setup">, see needsPasswordSetup) can't
// reach: someone who signed in via magic link, closed the tab before choosing
// a password, and came back without that session (cleared storage, another
// device, ...). They'd land here signed *out* with an account that has no
// password yet — and resetPasswordForEmail handles "set the first one" and
// "replace a forgotten one" identically, so this one form covers both. Either
// way it emails a recovery link that signs the user in and fires a
// PASSWORD_RECOVERY event, which useAuth/AuthProvider catches globally and
// routes to <SetNewPassword> regardless of which page the link redirects to.
// ----------------------------------------------------------------------------
function ResetPanel({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setStatus('sending')

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })

    if (resetError) {
      setError(friendlyAuthError(resetError.message))
      setStatus('idle')
      return
    }
    setStatus('sent')
  }

  if (status === 'sent') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-lg font-semibold text-slate-900">Check your email</p>
        <p className="text-sm text-slate-600">
          If <span className="font-medium text-slate-900">{email}</span> has an account, we've sent a link to set (or
          reset) its password. Open it on this device to continue.
        </p>
        <p className="text-sm">
          <BackLink onClick={onBack}>← Back to sign in</BackLink>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-slate-600">
        Enter your email and we'll send a link to set a new password — whether you're recovering one you forgot, or
        never got to finish choosing one after signing up.
      </p>
      <EmailField value={email} onChange={setEmail} />
      <FieldError message={error} />
      <SubmitButton pending={status === 'sending'} label="Send password link" pendingLabel="Sending…" />
      <p className="text-center text-sm">
        <BackLink onClick={onBack}>← Back to sign in</BackLink>
      </p>
    </form>
  )
}
