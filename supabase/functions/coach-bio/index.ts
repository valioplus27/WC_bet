// ============================================================================
// coach-bio — Anthropic-powered concise coach biography.
//
// Unlike match-narrative (which forbids outside knowledge), a coach bio is a
// public-figure summary, so the model is allowed to use its general knowledge.
// Kept short and hedged to avoid confidently stating stale facts.
//
// Requires ANTHROPIC_API_KEY secret:
//   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ============================================================================

import Anthropic from 'npm:@anthropic-ai/sdk@0.27'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

const API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  if (!API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY not set. Run: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...' }, 503)
  }

  const body = await req.json().catch(() => ({})) as {
    coach?: string
    nationality?: string
    team?: string
  }

  if (!body.coach) {
    return json({ error: 'Provide { coach, nationality?, team? }' }, 400)
  }

  const prompt = `Write a concise 3–4 sentence biography of the association-football head coach ${body.coach}${
    body.nationality ? ` (${body.nationality})` : ''
  }${body.team ? `, currently managing the ${body.team} national team` : ''}.

Cover: their playing background if notable, the clubs or national teams they have managed, and their most significant honours or achievements. Keep it factual and neutral, like a short encyclopedia entry.

If you are unsure about a specific detail, stay general rather than inventing specifics. Do not add a heading, bullet points, or a closing sentence about the upcoming World Cup. Output only the biography prose.`

  const client = new Anthropic({ apiKey: API_KEY })

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (message.content[0] as { type: 'text'; text: string }).text.trim()

  return json({ bio: text })
})
