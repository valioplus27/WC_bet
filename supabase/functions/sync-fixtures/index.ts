// ============================================================================
// sync-fixtures — admin-triggered Edge Function that pulls World Cup
// fixtures, results, and group standings from football-data.org and upserts
// them into `matches` / `standings` using the service role (bypasses RLS,
// same as any upstream-authoritative job should). Safe to re-run any time:
// matches are matched up by their stable external ID and standings by
// (group, team).
//
// Triggered from the Admin page via supabase.functions.invoke('sync-fixtures'),
// which forwards the signed-in user's access token — checked below so only
// admins can run it, even if someone calls the endpoint directly.
//
// Required secrets (`supabase secrets set …`):
//   FOOTBALL_DATA_API_KEY            — your football-data.org API token
//   FOOTBALL_DATA_COMPETITION_CODE   — competition code (optional, defaults to "WC")
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Edge Runtime — do not set them yourself.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4'

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

// ----------------------------------------------------------------------------
// football-data.org v4 response shapes (trimmed to the fields we use)
// ----------------------------------------------------------------------------
type FootballDataMatch = {
  id: number
  utcDate: string
  status: string
  stage: string
  group: string | null
  homeTeam: { name?: string | null } | null
  awayTeam: { name?: string | null } | null
  score?: { fullTime?: { home: number | null; away: number | null } | null } | null
}

type FootballDataStandingRow = {
  position: number
  team: { name: string }
  playedGames: number
  won: number
  draw: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
}

type FootballDataStandingGroup = {
  type: string
  group: string | null
  table: FootballDataStandingRow[]
}

// ----------------------------------------------------------------------------
// Mapping → our schema
// ----------------------------------------------------------------------------

/** "GROUP_A" / "group b" / "Group A" all normalize to "Group A"; anything else passes through trimmed. */
function normalizeGroupName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const match = /^group[ _]?([a-z0-9]+)$/i.exec(trimmed)
  return match ? `Group ${match[1].toUpperCase()}` : trimmed
}

function toMatchRow(match: FootballDataMatch) {
  return {
    ext_id: String(match.id),
    // Future knockout fixtures often have no team assigned yet (e.g. "Winner Group A" slots) — store a placeholder rather than null, since the column is not-null.
    home_team: match.homeTeam?.name?.trim() || 'TBD',
    away_team: match.awayTeam?.name?.trim() || 'TBD',
    kickoff_at: match.utcDate,
    stage: match.stage,
    group_name: normalizeGroupName(match.group),
    home_score: match.score?.fullTime?.home ?? null,
    away_score: match.score?.fullTime?.away ?? null,
    status: match.status,
  }
}

function toStandingRows(groups: FootballDataStandingGroup[]) {
  const rows: Array<{
    group_name: string
    team_name: string
    played: number
    won: number
    draw: number
    lost: number
    goals_for: number
    goals_against: number
    goal_difference: number
    points: number
    position: number
  }> = []

  for (const group of groups) {
    // football-data.org also reports HOME/AWAY split tables for some
    // competitions — we only want the combined standings.
    if (group.type !== 'TOTAL') continue
    const groupName = normalizeGroupName(group.group)
    if (!groupName) continue

    for (const entry of group.table) {
      rows.push({
        group_name: groupName,
        team_name: entry.team.name,
        played: entry.playedGames,
        won: entry.won,
        draw: entry.draw,
        lost: entry.lost,
        goals_for: entry.goalsFor,
        goals_against: entry.goalsAgainst,
        goal_difference: entry.goalDifference,
        points: entry.points,
        position: entry.position,
      })
    }
  }

  return rows
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const apiKey = Deno.env.get('FOOTBALL_DATA_API_KEY')
  const competitionCode = Deno.env.get('FOOTBALL_DATA_COMPETITION_CODE')?.trim() || 'WC'

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfiguration: Supabase connection secrets are missing.' }, 500)
  }
  if (!apiKey) {
    return jsonResponse(
      { error: 'FOOTBALL_DATA_API_KEY is not set. Run `supabase secrets set FOOTBALL_DATA_API_KEY=…` and redeploy.' },
      500,
    )
  }

  // ---- Authorization: only signed-in admins may trigger a sync -------------
  // The Admin page is already gated client-side, but this function is a public
  // HTTP endpoint — re-check server-side so a crafted request can't run it.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header — sign in and try again.' }, 401)

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const {
    data: { user },
    error: userError,
  } = await callerClient.auth.getUser()
  if (userError || !user) return jsonResponse({ error: 'Your session has expired — sign in again and retry.' }, 401)

  const { data: callerProfile } = await callerClient.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!callerProfile?.is_admin) return jsonResponse({ error: 'Admins only.' }, 403)

  // ---- Pull from football-data.org ------------------------------------------
  const upstreamHeaders = { 'X-Auth-Token': apiKey }

  const matchesResponse = await fetch(`${FOOTBALL_DATA_BASE_URL}/competitions/${competitionCode}/matches`, {
    headers: upstreamHeaders,
  })
  if (!matchesResponse.ok) {
    const detail = (await matchesResponse.text()).slice(0, 300)
    return jsonResponse(
      { error: `football-data.org rejected the matches request (HTTP ${matchesResponse.status}): ${detail}` },
      502,
    )
  }
  const matchesPayload = (await matchesResponse.json()) as { matches?: FootballDataMatch[] }
  const matchRows = (matchesPayload.matches ?? []).map(toMatchRow)

  // ---- Write to Supabase with the service role (bypasses RLS) ---------------
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  if (matchRows.length > 0) {
    const { error } = await adminClient.from('matches').upsert(matchRows, { onConflict: 'ext_id' })
    if (error) return jsonResponse({ error: `Writing matches failed: ${error.message}` }, 500)
  }

  // Standings can 4xx before the group draw is final, or while the API has
  // nothing to report yet — that shouldn't fail a sync that already landed
  // fixtures, so it's handled as a soft "skipped" note rather than an error.
  let standingsSynced = 0
  let standingsNote: string | null = null
  const standingsResponse = await fetch(`${FOOTBALL_DATA_BASE_URL}/competitions/${competitionCode}/standings`, {
    headers: upstreamHeaders,
  })
  if (standingsResponse.ok) {
    const standingsPayload = (await standingsResponse.json()) as { standings?: FootballDataStandingGroup[] }
    const standingRows = toStandingRows(standingsPayload.standings ?? [])
    if (standingRows.length > 0) {
      const { error } = await adminClient.from('standings').upsert(standingRows, { onConflict: 'group_name,team_name' })
      if (error) return jsonResponse({ error: `Writing standings failed: ${error.message}` }, 500)
      standingsSynced = standingRows.length
    } else {
      standingsNote = 'no group tables published yet'
    }
  } else {
    standingsNote = `standings unavailable (HTTP ${standingsResponse.status})`
  }

  const matchesSynced = matchRows.length
  const summary =
    `Synced ${matchesSynced} match${matchesSynced === 1 ? '' : 'es'}` +
    (standingsNote
      ? ` — standings skipped (${standingsNote}).`
      : ` and ${standingsSynced} standings row${standingsSynced === 1 ? '' : 's'}.`)

  return jsonResponse({ summary, matchesSynced, standingsSynced, standingsNote })
})
