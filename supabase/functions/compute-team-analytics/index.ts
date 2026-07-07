// ============================================================================
// compute-team-analytics — mines StatsBomb WC 2022 event data to produce
// per-team tactical metrics stored in public.team_analytics.
//
// Reads from public.shots and public.match_events (StatsBomb source).
// Computes: passing metrics, pressing, build-up, attacking, network topology,
// and "fun" indices (chaos index, possession volatility).
//
// Trigger manually from Admin after StatsBomb data is ingested.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
// Maths helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
}

// ---------------------------------------------------------------------------
// Passing-network centralization (Freeman's centralization index, 0-1)
// ---------------------------------------------------------------------------

function networkCentralization(events: { player: string | null; to_player: string | null }[]): number {
  const passCount = new Map<string, number>()
  for (const e of events) {
    if (!e.player) continue
    passCount.set(e.player, (passCount.get(e.player) ?? 0) + 1)
  }
  if (passCount.size === 0) return 0
  const counts = [...passCount.values()]
  const maxCount = Math.max(...counts)
  const totalDiff = counts.reduce((s, c) => s + (maxCount - c), 0)
  const n = counts.length
  // Freeman's index denominator for directed graph: (n-1) * (n-2) * maxPossible
  // Simplified: normalize by (n-1) * maxCount
  const denom = (n - 1) * maxCount
  return denom > 0 ? Math.min(totalDiff / denom, 1) : 0
}

// Average length of possession chains (consecutive passes by same team before loss/shot/out)
function avgChainLength(events: { event_type: string; team: string }[]): number {
  if (events.length === 0) return 0
  let chains = 0
  let chainLen = 0
  let totalLen = 0
  let prevTeam = ''
  for (const e of events) {
    if (e.event_type !== 'Pass') {
      if (chainLen > 0) { totalLen += chainLen; chains++; chainLen = 0 }
      prevTeam = ''
      continue
    }
    if (e.team === prevTeam) {
      chainLen++
    } else {
      if (chainLen > 0) { totalLen += chainLen; chains++ }
      chainLen = 1
      prevTeam = e.team
    }
  }
  if (chainLen > 0) { totalLen += chainLen; chains++ }
  return chains > 0 ? totalLen / chains : 0
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// PostgREST caps an unpaginated select at the project's max-rows setting
// (1000 by default) — with 100k+ StatsBomb events this would silently
// truncate to a handful of matches. Page through with .range() instead.
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await query(from, from + PAGE - 1)
    if (error) return { data: all, error: error.message }
    all.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return { data: all, error: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Use POST', { status: 405, headers: CORS_HEADERS })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Fetch all StatsBomb events (pass + pressure + carry + tackle + interception)
  const { data: eventsRaw, error: evErr } = await fetchAll<{
    match_ext_id: string; event_type: string; team: string; player: string | null
    to_player: string | null; outcome: string | null
  }>((from, to) =>
    supabase
      .from('match_events')
      .select('match_ext_id, event_type, team, player, to_player, outcome')
      .eq('source', 'statsbomb')
      .range(from, to),
  )

  if (evErr) {
    return jsonResponse({ error: evErr }, 500)
  }

  // Fetch all shots
  const { data: shotsRaw, error: shErr } = await fetchAll<{
    match_ext_id: string; team: string; xg: number | null; outcome: string
  }>((from, to) =>
    supabase
      .from('shots')
      .select('match_ext_id, team, xg, outcome')
      .eq('source', 'statsbomb')
      .range(from, to),
  )

  if (shErr) {
    return jsonResponse({ error: shErr }, 500)
  }

  const events = eventsRaw ?? []
  const shots  = shotsRaw  ?? []

  if (events.length === 0 && shots.length === 0) {
    return jsonResponse({ error: 'No StatsBomb data found. Run StatsBomb ingestion from Admin first.' }, 400)
  }

  // Group events by team
  const teamsSet = new Set([...events.map((e) => e.team), ...shots.map((s) => s.team)])

  // Group shots by (team, match) for per-match stats
  const shotsByTeamMatch = new Map<string, Map<string, typeof shots>>()
  for (const s of shots) {
    const key = s.team
    if (!shotsByTeamMatch.has(key)) shotsByTeamMatch.set(key, new Map())
    const byMatch = shotsByTeamMatch.get(key)!
    if (!byMatch.has(s.match_ext_id)) byMatch.set(s.match_ext_id, [])
    byMatch.get(s.match_ext_id)!.push(s)
  }

  // Group events by (team, match)
  const eventsByTeamMatch = new Map<string, Map<string, typeof events>>()
  for (const e of events) {
    const key = e.team
    if (!eventsByTeamMatch.has(key)) eventsByTeamMatch.set(key, new Map())
    const byMatch = eventsByTeamMatch.get(key)!
    if (!byMatch.has(e.match_ext_id)) byMatch.set(e.match_ext_id, [])
    byMatch.get(e.match_ext_id)!.push(e)
  }

  // All events grouped by match (for chain-length computation)
  const allEventsByMatch = new Map<string, typeof events>()
  for (const e of events) {
    if (!allEventsByMatch.has(e.match_ext_id)) allEventsByMatch.set(e.match_ext_id, [])
    allEventsByMatch.get(e.match_ext_id)!.push(e)
  }

  const rows = []
  for (const team of teamsSet) {
    if (!team) continue

    // Per-match buckets
    const matchShotsMap = shotsByTeamMatch.get(team) ?? new Map()
    const matchEventsMap = eventsByTeamMatch.get(team) ?? new Map()
    const allMatches = new Set([...matchShotsMap.keys(), ...matchEventsMap.keys()])
    const n = allMatches.size
    if (n === 0) continue

    // Shooting / xG
    const xgPerMatch: number[] = []
    let totalShots = 0
    for (const [mid, mShots] of matchShotsMap) {
      void mid
      const xg = mShots.reduce((s, sh) => s + (sh.xg ?? 0), 0)
      xgPerMatch.push(xg)
      totalShots += mShots.length
    }
    const avgXgPerMatch   = mean(xgPerMatch)
    const avgShotsPerMatch = totalShots / n
    const avgXgPerShot    = totalShots > 0
      ? shots.filter((s) => s.team === team).reduce((s, sh) => s + (sh.xg ?? 0), 0) / totalShots
      : 0
    const chaosIndex = stddev(xgPerMatch) / Math.max(avgXgPerMatch, 0.01)

    // Passing metrics
    let totalPasses = 0
    let completedPasses = 0
    let totalProgressive = 0
    const allTeamPassEvents: typeof events = []
    for (const [, mEvents] of matchEventsMap) {
      const passes = mEvents.filter((e) => e.event_type === 'Pass')
      totalPasses += passes.length
      completedPasses += passes.filter((e) => e.outcome === null || e.outcome === 'Complete' || e.outcome === 'Success').length
      // Progressive pass: end_x not stored but we can count passes without explicit fail
      totalProgressive += passes.filter((e) => e.outcome === null || e.outcome === 'Complete').length
      allTeamPassEvents.push(...passes)
    }
    const avgPassesPerMatch = totalPasses / n
    const passCompletionRate = totalPasses > 0 ? completedPasses / totalPasses : 0
    const avgProgressivePasses = totalProgressive / n

    // Pressing
    let totalPressures = 0
    let successfulPressures = 0
    let totalCarries = 0
    let totalTackles = 0
    let totalInterceptions = 0
    for (const [, mEvents] of matchEventsMap) {
      const pressures     = mEvents.filter((e) => e.event_type === 'Pressure')
      const carries       = mEvents.filter((e) => e.event_type === 'Carry')
      const tackles       = mEvents.filter((e) => e.event_type === 'Duel' || e.event_type === 'Dribbled Past')
      const interceptions = mEvents.filter((e) => e.event_type === 'Interception')
      totalPressures     += pressures.length
      successfulPressures += pressures.filter((e) => e.outcome === 'Success' || e.outcome === 'Success In Play' || e.outcome === 'Won').length
      totalCarries       += carries.length
      totalTackles       += tackles.length
      totalInterceptions += interceptions.length
    }
    const avgPressuresPerMatch  = totalPressures / n
    const presSuccessRate       = totalPressures > 0 ? successfulPressures / totalPressures : 0
    const avgCarriesPerMatch    = totalCarries / n
    const avgTacklesPerMatch    = totalTackles / n
    const avgInterceptPerMatch  = totalInterceptions / n

    // Passing network centralization (aggregate across all matches)
    const networkCent = networkCentralization(allTeamPassEvents)

    // Average chain length across all matches this team played
    const chainLengths: number[] = []
    for (const mid of allMatches) {
      const matchAll = allEventsByMatch.get(mid) ?? []
      if (matchAll.length > 0) {
        chainLengths.push(avgChainLength(matchAll))
      }
    }
    const avgChain = mean(chainLengths)

    rows.push({
      team_name:                team,
      source:                   'statsbomb_wc2022',
      avg_passes_per_match:     Math.round(avgPassesPerMatch * 100) / 100,
      pass_completion_rate:     Math.round(passCompletionRate * 10000) / 10000,
      avg_progressive_passes:   Math.round(avgProgressivePasses * 100) / 100,
      avg_pressures_per_match:  Math.round(avgPressuresPerMatch * 100) / 100,
      press_success_rate:       Math.round(presSuccessRate * 10000) / 10000,
      avg_carries_per_match:    Math.round(avgCarriesPerMatch * 100) / 100,
      avg_shots_per_match:      Math.round(avgShotsPerMatch * 100) / 100,
      avg_xg_per_match:         Math.round(avgXgPerMatch * 10000) / 10000,
      avg_xg_per_shot:          Math.round(avgXgPerShot * 10000) / 10000,
      avg_tackles_per_match:    Math.round(avgTacklesPerMatch * 100) / 100,
      avg_interceptions_per_match: Math.round(avgInterceptPerMatch * 100) / 100,
      network_centralization:   Math.round(networkCent * 10000) / 10000,
      avg_chain_length:         Math.round(avgChain * 100) / 100,
      chaos_index:              Math.round(Math.min(chaosIndex, 9.9999) * 10000) / 10000,
      matches_in_sample:        n,
      updated_at:               new Date().toISOString(),
    })
  }

  if (rows.length === 0) {
    return jsonResponse({ computed: 0, message: 'No teams found in event data.' })
  }

  const { error: upsErr } = await supabase
    .from('team_analytics')
    .upsert(rows, { onConflict: 'team_name' })

  if (upsErr) {
    return jsonResponse({ error: upsErr.message }, 500)
  }

  return jsonResponse({ computed: rows.length, teams: rows.map((r) => r.team_name) })
})
