import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API_KEY = Deno.env.get('APIFOOTBALL_API_KEY')

const API_BASE = 'https://v3.football.api-sports.io'
// FIFA World Cup on API-Football: league=1, 2026 season.
const WC_LEAGUE = 1
const WC_SEASON = 2026
// Minimum gap between API calls for the same match (saves free-tier quota).
const MIN_SYNC_MS = 8 * 60 * 1000

// football-data.org team names that differ from API-Football canonical names.
const ALIASES: Record<string, string> = {
  'usa': 'united states',
  'ir iran': 'iran',
  'korea republic': 'south korea',
  'republic of ireland': 'ireland',
  'cote d ivoire': 'ivory coast',
  'trinidad and tobago': 'trinidad & tobago',
}

function normalize(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return ALIASES[s] ?? s
}

async function apiFetch(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-apisports-key': API_KEY!, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`API-Football ${path} → ${res.status}`)
  return res.json()
}

function parseStat(stats: Array<{ type: string; value: unknown }>, key: string): number | null {
  const item = stats.find((s) => s.type === key)
  if (!item) return null
  const raw = String(item.value ?? '').replace('%', '').trim()
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResp(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (!API_KEY) {
    return jsonResp({
      error: 'APIFOOTBALL_API_KEY not configured',
      hint: 'supabase secrets set APIFOOTBALL_API_KEY=<your-key>',
    }, 503)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  // Matches that are live, paused, or kicking off within the next 30 minutes.
  // Football-data.org auto-sync already updates statuses — we trust those values.
  const soonCutoff = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const { data: candidates, error: matchErr } = await supabase
    .from('matches')
    .select('id, ext_id, home_team, away_team, kickoff_at, status, apifootball_id')
    .or(
      `status.in.(IN_PLAY,PAUSED),and(status.in.(TIMED,SCHEDULED),kickoff_at.lte.${soonCutoff})`,
    )

  if (matchErr) return jsonResp({ error: matchErr.message }, 500)
  if (!candidates?.length) {
    return jsonResp({ skipped: true, reason: 'no live or imminent matches' })
  }

  // --- Resolve API-Football fixture IDs for any matches that don't have one ---
  const unresolved = candidates.filter((m) => !m.apifootball_id)
  if (unresolved.length > 0) {
    const fixturesJson = await apiFetch(`/fixtures?league=${WC_LEAGUE}&season=${WC_SEASON}`) as {
      response?: Array<{
        fixture: { id: number; date: string }
        teams: { home: { name: string }; away: { name: string } }
      }>
    }
    const allFixtures = fixturesJson?.response ?? []

    for (const m of unresolved) {
      const matchDate = m.kickoff_at.slice(0, 10)
      const hNorm = normalize(m.home_team)
      const aNorm = normalize(m.away_team)

      const hit = allFixtures.find((f) => {
        if (f.fixture.date.slice(0, 10) !== matchDate) return false
        const fh = normalize(f.teams.home.name)
        const fa = normalize(f.teams.away.name)
        return (fh === hNorm && fa === aNorm) || (fh === aNorm && fa === hNorm)
      })

      if (hit) {
        await supabase.from('matches').update({ apifootball_id: hit.fixture.id }).eq('id', m.id)
        m.apifootball_id = hit.fixture.id
      }
    }
  }

  // --- Live sync: only IN_PLAY / PAUSED matches, throttled to MIN_SYNC_MS ---
  const live = candidates.filter(
    (m) => (m.status === 'IN_PLAY' || m.status === 'PAUSED') && m.apifootball_id,
  )

  // Check existing stats timestamps to avoid hammering the API on every 2-min tick.
  const { data: recentStats } = await supabase
    .from('match_stats')
    .select('match_id, updated_at')
    .in('match_id', live.map((m) => m.id))

  const lastSyncMs = new Map(
    (recentStats ?? []).map((s) => [s.match_id, new Date(s.updated_at).getTime()]),
  )

  let synced = 0
  let throttled = 0

  for (const match of live) {
    if (Date.now() - (lastSyncMs.get(match.id) ?? 0) < MIN_SYNC_MS) {
      throttled++
      continue
    }

    const fixtureId = match.apifootball_id!

    const [eventsJson, statsJson] = await Promise.all([
      apiFetch(`/fixtures/events?fixture=${fixtureId}`),
      apiFetch(`/fixtures/statistics?fixture=${fixtureId}`),
    ]) as [
      { response?: Array<{
        time: { elapsed: number; extra: number | null }
        team: { name: string }
        player: { name: string | null }
        assist: { name: string | null }
        type: string
        detail: string
      }> },
      { response?: Array<{
        team: { name: string }
        statistics: Array<{ type: string; value: unknown }>
      }> },
    ]

    // -- Events: delete all and re-insert (idempotent; avoids duplicate detection) --
    const rawEvents = eventsJson?.response ?? []
    const eventRows = rawEvents
      .filter((e) => ['Goal', 'Card', 'subst', 'Var'].includes(e.type))
      .map((e) => ({
        match_id: match.id,
        minute: e.time?.elapsed ?? 0,
        extra_minute: e.time?.extra ?? null,
        event_type: e.type,
        team: e.team?.name ?? '',
        player: e.player?.name ?? null,
        assist: e.assist?.name ?? null,
        detail: e.detail ?? null,
      }))

    await supabase.from('match_events_live').delete().eq('match_id', match.id)
    if (eventRows.length > 0) {
      await supabase.from('match_events_live').insert(eventRows)
    }

    // -- Statistics: upsert one row per match --
    const teamStats = statsJson?.response ?? []
    if (teamStats.length >= 1) {
      const homeNorm = normalize(match.home_team)
      const homeData = teamStats.find((t) => normalize(t.team?.name ?? '') === homeNorm) ?? teamStats[0]
      const awayData = teamStats.find((t) => normalize(t.team?.name ?? '') !== homeNorm) ?? teamStats[1]
      const hSt = homeData?.statistics ?? []
      const aSt = awayData?.statistics ?? []

      await supabase.from('match_stats').upsert(
        {
          match_id: match.id,
          home_possession: parseStat(hSt, 'Ball Possession'),
          away_possession: parseStat(aSt, 'Ball Possession'),
          home_shots: parseStat(hSt, 'Total Shots'),
          away_shots: parseStat(aSt, 'Total Shots'),
          home_shots_on_target: parseStat(hSt, 'Shots on Goal'),
          away_shots_on_target: parseStat(aSt, 'Shots on Goal'),
          home_corners: parseStat(hSt, 'Corner Kicks'),
          away_corners: parseStat(aSt, 'Corner Kicks'),
          home_fouls: parseStat(hSt, 'Fouls'),
          away_fouls: parseStat(aSt, 'Fouls'),
          home_yellow_cards: parseStat(hSt, 'Yellow Cards'),
          away_yellow_cards: parseStat(aSt, 'Yellow Cards'),
          home_red_cards: parseStat(hSt, 'Red Cards'),
          away_red_cards: parseStat(aSt, 'Red Cards'),
          home_offsides: parseStat(hSt, 'Offsides'),
          away_offsides: parseStat(aSt, 'Offsides'),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id' },
      )
    }

    synced++
  }

  return jsonResp({
    candidates: candidates.length,
    live: live.length,
    synced,
    throttled,
    resolved: unresolved.length,
  })
})
