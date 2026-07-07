// ============================================================================
// compute-predictions — Poisson model for WC 2026 knockout-stage matches.
//
// The model:
//   1. Estimates team attack/defense strengths from finished group-stage results.
//   2. Applies shrinkage toward the historical WC average (fewer games played →
//      more shrinkage) so early-tournament predictions aren't wild.
//   3. Computes win/draw/loss probabilities with a Poisson joint distribution
//      + Dixon-Coles low-score correction (adjusts the (0,0)/(1,0)/(0,1)/(1,1)
//      cells, which a pure Poisson model misprices).
//   4. Temperature scaling (post-hoc calibration):
//      Once ≥ TEMP_MIN_SAMPLES resolved predictions exist, fits a temperature
//      parameter T via gradient descent on negative log-likelihood of resolved
//      outcomes. The scaled distribution P[i]^(1/T) / Σ P[j]^(1/T) is stored.
//      T < 1 sharpens (model underconfident); T > 1 flattens (overconfident).
//   5. Upserts results into public.predictions.
//   6. Resolves any already-computed predictions whose match just finished:
//      sets actual_outcome, brier_score, and log_loss.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MODEL_VERSION        = 'poisson-v2'
const PRIOR_GAMES          = 5      // Bayesian-shrinkage pseudo-game count toward generic WC average
const TACTICAL_PRIOR_GAMES = 3      // Extra pseudo-games from WC 2022 tactical prior (team-specific)
const MAX_GOALS            = 8      // Poisson tail truncation (P(X>8) < 0.002 at typical λ)
const WC_HIST_AVG          = 1.28   // Goals per team per game (WC 2018 + 2022 combined)
const DC_RHO               = -0.10  // Dixon-Coles correlation parameter
const TEMP_MIN_SAMPLES     = 20     // Minimum resolved predictions before temperature scaling activates

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

function poissonPMF(lambda: number, k: number): number {
  if (k < 0 || k > MAX_GOALS || lambda <= 0) return 0
  // Compute via log to avoid overflow
  let lp = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) lp -= Math.log(i)
  return Math.exp(lp)
}

/** Dixon-Coles adjustment for score cells (0,0), (0,1), (1,0), (1,1). */
function dc(h: number, a: number, lh: number, la: number, rho: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * rho
  if (h === 0 && a === 1) return 1 + lh * rho
  if (h === 1 && a === 0) return 1 + la * rho
  if (h === 1 && a === 1) return 1 - rho
  return 1
}

function computeProbs(lh: number, la: number): { homeWin: number; draw: number; awayWin: number } {
  let hw = 0, d = 0, aw = 0
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPMF(lh, h) * poissonPMF(la, a) * dc(h, a, lh, la, DC_RHO)
      if (h > a) hw += p
      else if (h === a) d += p
      else aw += p
    }
  }
  const total = hw + d + aw || 1
  return { homeWin: hw / total, draw: d / total, awayWin: aw / total }
}

// ---------------------------------------------------------------------------
// Temperature scaling (post-hoc calibration)
// ---------------------------------------------------------------------------

type Triple = [number, number, number]

function applyTemperature(p: Triple, T: number): Triple {
  const powered = p.map((v) => Math.pow(Math.max(v, 1e-9), 1 / T)) as Triple
  const sum = powered.reduce((s, v) => s + v, 0)
  return powered.map((v) => v / sum) as Triple
}

type ResolvedPred = { home: number; draw: number; away: number; outcome: string }

function fitTemperature(samples: ResolvedPred[]): number {
  let T = 1.0
  const lr = 0.02
  const iters = 300
  for (let i = 0; i < iters; i++) {
    const delta = T * 0.001 + 1e-6
    let lossPlus = 0, lossMinus = 0
    for (const s of samples) {
      const probs: Triple = [s.home, s.draw, s.away]
      const idx = s.outcome === 'home_win' ? 0 : s.outcome === 'draw' ? 1 : 2
      lossPlus  -= Math.log(Math.max(applyTemperature(probs, T + delta)[idx], 1e-10))
      lossMinus -= Math.log(Math.max(applyTemperature(probs, T - delta)[idx], 1e-10))
    }
    const grad = (lossPlus - lossMinus) / (2 * delta)
    T = Math.max(0.3, Math.min(4.0, T - lr * grad / samples.length))
  }
  return Math.round(T * 1000) / 1000
}

function brierScore(p: { homeWin: number; draw: number; awayWin: number }, outcome: string): number {
  return (
    (p.homeWin - (outcome === 'home_win' ? 1 : 0)) ** 2 +
    (p.draw    - (outcome === 'draw'     ? 1 : 0)) ** 2 +
    (p.awayWin - (outcome === 'away_win' ? 1 : 0)) ** 2
  )
}

function logLoss(p: { homeWin: number; draw: number; awayWin: number }, outcome: string): number {
  const pCorrect =
    outcome === 'home_win' ? p.homeWin :
    outcome === 'draw'     ? p.draw    :
    p.awayWin
  return -Math.log(Math.max(pCorrect, 1e-10))
}

// ---------------------------------------------------------------------------
// Team-strength estimation
// ---------------------------------------------------------------------------

type FinishedRow = { home_team: string; away_team: string; home_score: number; away_score: number }

type TacticalRow = {
  team_name: string
  avg_xg_per_match: number | null
  avg_pressures_per_match: number | null
  pass_completion_rate: number | null
  chaos_index: number | null
  network_centralization: number | null
}

// Normalize team name for fuzzy matching WC 2022 names to WC 2026 names.
function normTeam(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '')
}

function findTacticalMatch(
  target: string,
  tactics: TacticalRow[],
): TacticalRow | undefined {
  const nt = normTeam(target)
  // Exact match first
  let hit = tactics.find((t) => normTeam(t.team_name) === nt)
  if (hit) return hit
  // Prefix match (handles "Republic of Korea" → "korea", "USA" → "unitedstates")
  hit = tactics.find((t) => {
    const nt2 = normTeam(t.team_name)
    return nt.startsWith(nt2.slice(0, 5)) || nt2.startsWith(nt.slice(0, 5))
  })
  return hit
}

// Tactical attack proxy: xG-per-match relative to league xG average.
// If tactical data is unavailable, returns 1.0 (neutral).
function tacticalAttackPrior(ta: TacticalRow | undefined, leagueXgAvg: number): number {
  if (!ta || !ta.avg_xg_per_match || leagueXgAvg <= 0) return 1.0
  return ta.avg_xg_per_match / leagueXgAvg
}

// Tactical defense proxy: inverse of pressing intensity (more pressing → harder to score against).
// Scale: 0.85 – 1.15 range to avoid extreme adjustments.
function tacticalDefensePrior(ta: TacticalRow | undefined, maxPressures: number): number {
  if (!ta || !ta.avg_pressures_per_match || maxPressures <= 0) return 1.0
  const pressRatio = ta.avg_pressures_per_match / maxPressures
  // High pressing teams → harder to score against → lower "conceded" factor
  return 1.15 - 0.3 * pressRatio  // range 0.85 (max pressing) – 1.15 (low pressing)
}

function estimateStrengths(
  finished: FinishedRow[],
  tactics: TacticalRow[],
): {
  strengths: Map<string, { attack: number; defense: number }>
  leagueAvg: number
  tacticalBoost: boolean
} {
  const stats = new Map<string, { gf: number; ga: number; n: number }>()

  for (const m of finished) {
    const getOrInit = (t: string) => {
      if (!stats.has(t)) stats.set(t, { gf: 0, ga: 0, n: 0 })
      return stats.get(t)!
    }
    const h = getOrInit(m.home_team)
    const a = getOrInit(m.away_team)
    h.gf += m.home_score; h.ga += m.away_score; h.n++
    a.gf += m.away_score; a.ga += m.home_score; a.n++
  }

  const totalGoals = finished.reduce((s, m) => s + m.home_score + m.away_score, 0)
  const totalGames = finished.length
  const obsAvg = totalGames > 0 ? totalGoals / (totalGames * 2) : WC_HIST_AVG
  const w = Math.min(totalGames / 32, 1)
  const leagueAvg = w * obsAvg + (1 - w) * WC_HIST_AVG

  // League-level tactical priors from WC 2022 StatsBomb data
  const leagueXgAvg = tactics.length > 0
    ? tactics.reduce((s, t) => s + (t.avg_xg_per_match ?? 0), 0) / tactics.length
    : 0
  const maxPressures = tactics.length > 0
    ? Math.max(...tactics.map((t) => t.avg_pressures_per_match ?? 0))
    : 0
  const tacticalBoost = tactics.length > 0

  const strengths = new Map<string, { attack: number; defense: number }>()

  // Collect all team names across finished matches + tactics
  const allTeams = new Set([
    ...[...stats.keys()],
    ...tactics.map((t) => t.team_name),
  ])

  for (const team of allTeams) {
    const s = stats.get(team) ?? { gf: 0, ga: 0, n: 0 }
    const ta = findTacticalMatch(team, tactics)

    // WC 2022 tactical priors (team-specific Bayesian prior instead of neutral 1.0)
    const tacAtk = tacticalAttackPrior(ta, leagueXgAvg)
    const tacDef = tacticalDefensePrior(ta, maxPressures)

    // WC 2026 observed strength
    const hasObs = s.n > 0
    const obsAtk = hasObs && leagueAvg > 0 ? (s.gf / s.n) / leagueAvg : tacAtk
    const obsDef = hasObs && leagueAvg > 0 ? (s.ga / s.n) / leagueAvg : tacDef

    // Blend: WC 2026 observations shrink toward the WC 2022 tactical prior (not generic 1.0)
    const shrinkObs = s.n / (s.n + PRIOR_GAMES)
    // Extra weight from tactical prior vs. generic WC average
    const shrinkTac = TACTICAL_PRIOR_GAMES / (PRIOR_GAMES + TACTICAL_PRIOR_GAMES)

    const priorAtk = shrinkTac * tacAtk + (1 - shrinkTac) * 1.0
    const priorDef = shrinkTac * tacDef + (1 - shrinkTac) * 1.0

    strengths.set(team, {
      attack:  shrinkObs * obsAtk + (1 - shrinkObs) * priorAtk,
      defense: shrinkObs * obsDef + (1 - shrinkObs) * priorDef,
    })
  }

  return { strengths, leagueAvg, tacticalBoost }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Use POST', { status: 405, headers: CORS_HEADERS })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // 1. Fetch finished matches (group stage + knockout) for team-strength estimation.
  const { data: finishedRaw, error: finErr } = await supabase
    .from('matches')
    .select('home_team, away_team, home_score, away_score')
    .eq('status', 'FINISHED')
    .not('home_score', 'is', null)

  if (finErr) return jsonResponse({ error: finErr.message }, 500)

  const finished: FinishedRow[] = (finishedRaw ?? []).map((m) => ({
    home_team: m.home_team, away_team: m.away_team,
    home_score: m.home_score!, away_score: m.away_score!,
  }))

  // Load WC 2022 tactical priors from StatsBomb-derived team_analytics table
  const { data: tacticsRaw } = await supabase
    .from('team_analytics')
    .select('team_name, avg_xg_per_match, avg_pressures_per_match, pass_completion_rate, chaos_index, network_centralization')

  const tactics: TacticalRow[] = (tacticsRaw ?? []).map((t) => ({
    team_name:              t.team_name,
    avg_xg_per_match:       t.avg_xg_per_match,
    avg_pressures_per_match: t.avg_pressures_per_match,
    pass_completion_rate:   t.pass_completion_rate,
    chaos_index:            t.chaos_index,
    network_centralization: t.network_centralization,
  }))

  const { strengths, leagueAvg, tacticalBoost } = estimateStrengths(finished, tactics)

  // 2a. Fit temperature scaling from resolved predictions (if enough data).
  const { data: resolvedPreds } = await supabase
    .from('predictions')
    .select('home_win_prob, draw_prob, away_win_prob, actual_outcome')
    .not('actual_outcome', 'is', null)

  const tempSamples: ResolvedPred[] = (resolvedPreds ?? [])
    .filter((r) => r.actual_outcome !== null)
    .map((r) => ({
      home:    r.home_win_prob,
      draw:    r.draw_prob,
      away:    r.away_win_prob,
      outcome: r.actual_outcome!,
    }))

  const calibrated = tempSamples.length >= TEMP_MIN_SAMPLES
  const temperature = calibrated ? fitTemperature(tempSamples) : 1.0

  // 2b. Compute predictions for all non-group-stage upcoming matches.
  const { data: upcoming, error: upErr } = await supabase
    .from('matches')
    .select('id, home_team, away_team, stage')
    .neq('stage', 'GROUP_STAGE')
    .in('status', ['SCHEDULED', 'TIMED'])

  if (upErr) return jsonResponse({ error: upErr.message }, 500)

  const rows: object[] = []
  for (const m of upcoming ?? []) {
    if (m.home_team === 'TBD' || m.away_team === 'TBD') continue
    const h = strengths.get(m.home_team)
    const a = strengths.get(m.away_team)
    // Fall back to average strength for teams we have no data on (e.g. newly-advanced teams)
    const hStr = h ?? { attack: 1, defense: 1 }
    const aStr = a ?? { attack: 1, defense: 1 }

    const lh   = leagueAvg * hStr.attack * aStr.defense
    const la   = leagueAvg * aStr.attack * hStr.defense
    const raw  = computeProbs(lh, la)
    const cal  = calibrated
      ? applyTemperature([raw.homeWin, raw.draw, raw.awayWin], temperature)
      : ([raw.homeWin, raw.draw, raw.awayWin] as Triple)

    rows.push({
      match_id:      m.id,
      model_version: MODEL_VERSION,
      home_win_prob: Math.round(cal[0] * 10000) / 10000,
      draw_prob:     Math.round(cal[1] * 10000) / 10000,
      away_win_prob: Math.round(cal[2] * 10000) / 10000,
      computed_at:   new Date().toISOString(),
    })
  }

  let computed = 0
  if (rows.length > 0) {
    const { error } = await supabase
      .from('predictions')
      .upsert(rows, { onConflict: 'match_id,model_version' })
    if (error) return jsonResponse({ error: error.message }, 500)
    computed = rows.length
  }

  // 3. Resolve predictions for matches that have since finished.
  const { data: unresolved } = await supabase
    .from('predictions')
    .select('id, match_id, home_win_prob, draw_prob, away_win_prob')
    .is('actual_outcome', null)

  let resolved = 0
  for (const pred of unresolved ?? []) {
    const { data: match } = await supabase
      .from('matches')
      .select('home_score, away_score, status')
      .eq('id', pred.match_id)
      .single()

    if (!match || match.status !== 'FINISHED' || match.home_score === null) continue

    const outcome =
      match.home_score > match.away_score ? 'home_win' :
      match.home_score < match.away_score ? 'away_win' :
      'draw'

    const p = { homeWin: pred.home_win_prob, draw: pred.draw_prob, awayWin: pred.away_win_prob }

    await supabase.from('predictions').update({
      actual_outcome: outcome,
      brier_score:    Math.round(brierScore(p, outcome) * 1e6) / 1e6,
      log_loss:       Math.round(logLoss(p, outcome)    * 1e6) / 1e6,
      resolved_at:    new Date().toISOString(),
    }).eq('id', pred.id)

    resolved++
  }

  return jsonResponse({
    computed,
    resolved,
    teams:          strengths.size,
    leagueAvgGoals: leagueAvg.toFixed(3),
    tacticalPrior:  tacticalBoost,
    calibration: {
      applied:     calibrated,
      temperature: calibrated ? temperature : null,
      samples:     tempSamples.length,
      minRequired: TEMP_MIN_SAMPLES,
    },
  })
})
