// ============================================================================
// match-narrative — Anthropic-powered match text generation.
//
// Two modes (controlled by `type` in POST body):
//   "pre"  → 2-sentence pre-match preview grounded in model probabilities,
//             team form, and rest/travel context. No outside knowledge used.
//   "post" → 3-sentence post-match narrative from structured stats only
//             (score, xG, win-prob swings, rating changes). No hallucination.
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

// ---------------------------------------------------------------------------
// Prompts — strictly grounded in provided numbers, zero outside knowledge
// ---------------------------------------------------------------------------

function preMatchPrompt(stats: {
  homeTeam: string; awayTeam: string; stage: string
  homeWinPct: number; drawPct: number; awayWinPct: number
  homeForm: string; awayForm: string        // e.g. "W W D L W"
  homeRestDays?: number; awayRestDays?: number
  expectedGoals?: number                    // λ_home + λ_away
}): string {
  return `You are a match analyst. Write exactly 2 concise sentences previewing this fixture.
RULES: Use ONLY the numbers below. No player names. No outside knowledge. No predictions beyond what the numbers imply.

Match: ${stats.homeTeam} vs ${stats.awayTeam} (${stats.stage})
Model probabilities: ${stats.homeTeam} win ${stats.homeWinPct}%, Draw ${stats.drawPct}%, ${stats.awayTeam} win ${stats.awayWinPct}%
Expected total goals: ${stats.expectedGoals?.toFixed(1) ?? 'unknown'}
${stats.homeTeam} recent form (last 5): ${stats.homeForm}
${stats.awayTeam} recent form (last 5): ${stats.awayForm}
${stats.homeRestDays != null ? `Rest days: ${stats.homeTeam} ${stats.homeRestDays}d, ${stats.awayTeam} ${stats.awayRestDays ?? '?'}d` : ''}

Write 2 sentences only. First sentence: describe the match balance using the probabilities. Second: note any meaningful form or rest context.`
}

function postMatchPrompt(stats: {
  homeTeam: string; awayTeam: string; stage: string
  homeScore: number; awayScore: number
  homeXG?: number; awayXG?: number
  preMatchHomeWinPct?: number; preMatchAwayWinPct?: number
  homeRatingChange?: number; awayRatingChange?: number
  totalShots?: number; shotsOnTarget?: number
}): string {
  return `You are a match analyst. Write exactly 3 concise sentences summarising this result.
RULES: Use ONLY the numbers below. No player names. No outside knowledge. Strictly factual.

Match: ${stats.homeTeam} ${stats.homeScore}–${stats.awayScore} ${stats.awayTeam} (${stats.stage})
${stats.homeXG != null ? `Expected goals: ${stats.homeTeam} xG ${stats.homeXG.toFixed(2)}, ${stats.awayTeam} xG ${stats.awayXG?.toFixed(2) ?? '—'}` : ''}
${stats.preMatchHomeWinPct != null ? `Pre-match model: ${stats.homeTeam} ${stats.preMatchHomeWinPct}%, ${stats.awayTeam} ${stats.preMatchAwayWinPct}%` : ''}
${stats.homeRatingChange != null ? `Rating changes: ${stats.homeTeam} ${stats.homeRatingChange > 0 ? '+' : ''}${stats.homeRatingChange?.toFixed(2)}, ${stats.awayTeam} ${stats.awayRatingChange ?? 0 > 0 ? '+' : ''}${stats.awayRatingChange?.toFixed(2)}` : ''}
${stats.totalShots != null ? `Total shots: ${stats.totalShots}` : ''}

Write 3 sentences only. Sentence 1: result and whether xG supported it. Sentence 2: any notable xG vs. actual divergence. Sentence 3: brief probabilistic note (was this an upset?).`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  if (!API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY not set. Run: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...' }, 503)
  }

  const body = await req.json().catch(() => ({})) as {
    type: 'pre' | 'post'
    stats: Record<string, unknown>
  }

  if (!body.type || !body.stats) {
    return json({ error: 'Provide { type: "pre"|"post", stats: {...} }' }, 400)
  }

  const prompt = body.type === 'pre'
    ? preMatchPrompt(body.stats as Parameters<typeof preMatchPrompt>[0])
    : postMatchPrompt(body.stats as Parameters<typeof postMatchPrompt>[0])

  const client = new Anthropic({ apiKey: API_KEY })

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',   // fast + cheap for short narratives
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (message.content[0] as { type: 'text'; text: string }).text.trim()

  return json({ narrative: text, type: body.type })
})
