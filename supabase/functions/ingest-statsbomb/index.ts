// ============================================================================
// ingest-statsbomb — StatsBomb open-data adapter.
//
// Fetches shot and pass events from the StatsBomb open-data GitHub repository
// and stores them in public.shots and public.match_events.
//
// Usage: POST with JSON body { limit?: number, offset?: number, competition?: number }
//   limit      — matches to process in this call (default 3; keep low to stay under the 60s function timeout)
//   offset     — starting index into the match list (default 0)
//   competition — index into COMPETITIONS array (default 0 = WC 2022)
//
// Idempotent: matches whose shots are already in the DB are skipped.
//
// License notice: StatsBomb open data is published under CC BY-SA 4.0
// (non-commercial use; attribution required). See SOURCES.md for details.
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

const BASE = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data'
// Identify ourselves to GitHub's CDN as recommended for open-source tool usage.
const UA   = 'WC2026Tulosveto/1.0 (educational; statsbomb/open-data CC BY-SA 4.0)'

// ---------------------------------------------------------------------------
// Source adapter interface — uniform shape for any future source
// ---------------------------------------------------------------------------

const COMPETITIONS = [
  { competition_id: 43, season_id: 106, label: 'FIFA World Cup 2022' },
  // Add future StatsBomb-published competitions here; downstream code is unchanged.
]

// ---------------------------------------------------------------------------
// StatsBomb JSON shapes (trimmed to fields we use)
// ---------------------------------------------------------------------------

type SBMatchMeta = {
  match_id: number
  home_team: { home_team_name: string }
  away_team: { away_team_name: string }
  match_date: string
}

type SBEvent = {
  type:     { name: string }
  minute:   number
  second:   number
  period:   number
  team:     { name: string }
  player?:  { name: string }
  location?: [number, number]
  shot?: {
    statsbomb_xg?: number
    outcome:       { name: string }
    body_part?:    { name: string }
    type?:         { name: string }    // "Open Play", "Penalty", "Free Kick", …
  }
  pass?: {
    recipient?:    { name: string }
    end_location?: [number, number]
    outcome?:      { name: string }   // absent on complete passes
  }
  dribble?:       { outcome?: { name: string } }
  duel?:          { type?: { name: string }; outcome?: { name: string } }
  interception?:  { outcome?: { name: string } }
}

// Non-shot, non-pass event types we also track for tactical analysis
// (pressing intensity, ball-carrying, dribbling, defensive actions).
// Stored under their literal StatsBomb type.name so downstream consumers
// (compute-team-analytics, PlayerPage) can filter on the exact same string.
const TRACKED_EVENT_TYPES = new Set(['Pressure', 'Carry', 'Dribble', 'Interception', 'Duel', 'Dribbled Past'])

function trackedOutcome(e: SBEvent): string | null {
  if (e.type.name === 'Dribble') return e.dribble?.outcome?.name ?? null
  if (e.type.name === 'Duel') return e.duel?.outcome?.name ?? null
  if (e.type.name === 'Interception') return e.interception?.outcome?.name ?? null
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJSON(url: string) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`)
  return r.json()
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Use POST', { status: 405, headers: CORS_HEADERS })

  const body = await req.json().catch(() => ({}))
  const limit: number = Number(body.limit  ?? 3)
  const offset: number = Number(body.offset ?? 0)
  const compIdx: number = Number(body.competition ?? 0)

  const comp = COMPETITIONS[compIdx]
  if (!comp) {
    return jsonResponse({ error: `Unknown competition index ${compIdx}. Available: 0..${COMPETITIONS.length - 1}` }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Fetch the match list for this competition/season.
  const matchList: SBMatchMeta[] = await fetchJSON(
    `${BASE}/matches/${comp.competition_id}/${comp.season_id}.json`,
  )

  const batch = matchList.slice(offset, offset + limit)
  let shotsIngested = 0, eventsIngested = 0, skipped = 0

  for (const meta of batch) {
    // Each match gets a stable external ID scoped to source + competition.
    const matchExtId = `sb_${comp.competition_id}_${meta.match_id}`

    // Idempotency check — skip if we already have shots for this match.
    const { count } = await supabase
      .from('shots')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'statsbomb')
      .eq('match_ext_id', matchExtId)

    if ((count ?? 0) > 0) {
      skipped++
      continue
    }

    const events: SBEvent[] = await fetchJSON(`${BASE}/events/${meta.match_id}.json`)

    const shots: object[] = []
    const otherEvents: object[] = []

    for (const e of events) {
      const [x = 0, y = 0] = e.location ?? []
      const base = {
        source:         'statsbomb',
        match_ext_id:   matchExtId,
        competition_id: comp.competition_id,
        season_id:      comp.season_id,
        minute:         e.minute,
        period:         e.period,
        team:           e.team.name,
        player:         e.player?.name ?? 'Unknown',
        x,
        y,
      }

      if (e.type.name === 'Shot' && e.shot) {
        shots.push({
          ...base,
          xg:        e.shot.statsbomb_xg ?? null,
          outcome:   e.shot.outcome.name,
          body_part: e.shot.body_part?.name ?? null,
          is_penalty: e.shot.type?.name === 'Penalty',
        })
      }

      if (e.type.name === 'Pass' && e.pass) {
        const [ex = 0, ey = 0] = e.pass.end_location ?? []
        otherEvents.push({
          ...base,
          event_type: 'Pass',
          to_player:  e.pass.recipient?.name ?? null,
          end_x:      ex,
          end_y:      ey,
          outcome:    e.pass.outcome?.name ?? 'Complete',
        })
      }

      if (TRACKED_EVENT_TYPES.has(e.type.name)) {
        otherEvents.push({
          ...base,
          event_type: e.type.name,
          to_player:  null,
          end_x:      null,
          end_y:      null,
          outcome:    trackedOutcome(e),
        })
      }
    }

    if (shots.length > 0) {
      const { error } = await supabase.from('shots').insert(shots)
      if (error) return jsonResponse({ error: `shots insert: ${error.message}` }, 500)
      shotsIngested += shots.length
    }

    if (otherEvents.length > 0) {
      // Insert in chunks to stay within Postgres row limits per statement.
      const CHUNK = 500
      for (let i = 0; i < otherEvents.length; i += CHUNK) {
        const { error } = await supabase.from('match_events').insert(otherEvents.slice(i, i + CHUNK))
        if (error) return jsonResponse({ error: `events insert: ${error.message}` }, 500)
      }
      eventsIngested += otherEvents.length
    }

    // Polite delay between GitHub CDN requests.
    await new Promise((r) => setTimeout(r, 150))
  }

  return jsonResponse({
    competition:    comp.label,
    totalMatches:   matchList.length,
    batchOffset:    offset,
    batchSize:      batch.length,
    shotsIngested,
    eventsIngested,
    skipped,
    hasMore:        offset + limit < matchList.length,
    nextOffset:     offset + limit,
  })
})
