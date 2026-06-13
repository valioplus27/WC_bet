// ============================================================================
// auto-sync-fixtures — called by pg_cron every minute.
//
// Smart polling: first checks whether any match is currently live or starting
// within 90 minutes. If not, returns immediately without touching
// football-data.org (zero API quota used between match days).
//
// When active:
//   • Always syncs match scores (detects goals as they happen)
//   • Syncs standings + top scorers when a recently-started match just finished
//     (kickoff within the last 4 hours, status now FINISHED)
//
// No user auth — pg_cron can't generate JWTs. The function is harmless to
// call externally: the smart-skip means it only touches the external API when
// matches are genuinely live, so even a flood of spurious calls wastes at
// most one cheap DB read per call.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API_KEY = Deno.env.get('FOOTBALL_DATA_API_KEY')!
const COMPETITION = Deno.env.get('FOOTBALL_DATA_COMPETITION_CODE')?.trim() || 'WC'
const BASE_URL = 'https://api.football-data.org/v4'

// ----------------------------------------------------------------------------
// football-data.org response shapes (trimmed to fields we use)
// ----------------------------------------------------------------------------
type FDMatch = {
  id: number
  utcDate: string
  status: string
  stage: string
  group: string | null
  homeTeam: { name?: string | null } | null
  awayTeam: { name?: string | null } | null
  score?: { fullTime?: { home: number | null; away: number | null } | null } | null
}

type FDStandingRow = {
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

type FDStandingGroup = {
  type: string
  group: string | null
  table: FDStandingRow[]
}

type FDScorer = {
  player: { id: number; name: string; nationality: string | null }
  team: { name: string }
  goals: number
  assists: number | null
  penalties: number | null
  playedMatches: number
}

// ----------------------------------------------------------------------------
// Row mappers
// ----------------------------------------------------------------------------
function normalizeGroup(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^group[ _]?([a-z0-9]+)$/i.exec(raw.trim())
  return m ? `Group ${m[1].toUpperCase()}` : raw.trim()
}

function toMatchRow(m: FDMatch) {
  return {
    ext_id: String(m.id),
    home_team: m.homeTeam?.name?.trim() || 'TBD',
    away_team: m.awayTeam?.name?.trim() || 'TBD',
    kickoff_at: m.utcDate,
    stage: m.stage,
    group_name: normalizeGroup(m.group),
    home_score: m.score?.fullTime?.home ?? null,
    away_score: m.score?.fullTime?.away ?? null,
    status: m.status,
  }
}

function toStandingRows(groups: FDStandingGroup[]) {
  const rows = []
  for (const g of groups) {
    if (g.type !== 'TOTAL') continue
    const groupName = normalizeGroup(g.group)
    if (!groupName) continue
    for (const e of g.table) {
      rows.push({
        group_name: groupName,
        team_name: e.team.name,
        played: e.playedGames,
        won: e.won,
        draw: e.draw,
        lost: e.lost,
        goals_for: e.goalsFor,
        goals_against: e.goalsAgainst,
        goal_difference: e.goalDifference,
        points: e.points,
        position: e.position,
      })
    }
  }
  return rows
}

function toScorerRow(s: FDScorer) {
  return {
    player_ext_id: s.player.id,
    player_name: s.player.name,
    team_name: s.team.name,
    nationality: s.player.nationality ?? null,
    goals: s.goals ?? 0,
    assists: s.assists ?? 0,
    penalties: s.penalties ?? 0,
    played_matches: s.playedMatches ?? 0,
    updated_at: new Date().toISOString(),
  }
}

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const now = new Date()
  const in90min = new Date(now.getTime() + 90 * 60 * 1000)

  // Smart skip: only proceed if a match is live or starting within 90 minutes.
  const { count } = await db
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(
      `status.in.(IN_PLAY,PAUSED),` +
      `and(status.eq.SCHEDULED,kickoff_at.gte.${now.toISOString()},kickoff_at.lte.${in90min.toISOString()})`,
    )

  if (!count) {
    return json({ skipped: true, reason: 'No live or imminent matches' })
  }

  const headers = { 'X-Auth-Token': API_KEY }

  // ---- Sync matches ---------------------------------------------------------
  const matchRes = await fetch(`${BASE_URL}/competitions/${COMPETITION}/matches`, { headers })
  if (!matchRes.ok) {
    return json({ error: `football-data.org matches HTTP ${matchRes.status}` }, 502)
  }
  const { matches = [] }: { matches: FDMatch[] } = await matchRes.json()
  const matchRows = matches.map(toMatchRow)

  if (matchRows.length > 0) {
    const { error } = await db.from('matches').upsert(matchRows, { onConflict: 'ext_id' })
    if (error) return json({ error: `match upsert: ${error.message}` }, 500)
  }

  // ---- Sync standings + scorers when a match recently finished --------------
  // "Recently" = kickoff was within the last 4 hours and status is now FINISHED
  // (covers 90-min matches, extra time, and penalty shootouts with room to spare).
  const cutoff = new Date(now.getTime() - 4 * 60 * 60 * 1000)
  const hasRecentlyFinished = matches.some(
    (m) => m.status === 'FINISHED' && new Date(m.utcDate) >= cutoff,
  )

  let standingsSynced = 0
  let scorersSynced = 0

  if (hasRecentlyFinished) {
    const [standRes, scorerRes] = await Promise.all([
      fetch(`${BASE_URL}/competitions/${COMPETITION}/standings`, { headers }),
      fetch(`${BASE_URL}/competitions/${COMPETITION}/scorers`, { headers }),
    ])

    if (standRes.ok) {
      const { standings = [] }: { standings: FDStandingGroup[] } = await standRes.json()
      const rows = toStandingRows(standings)
      if (rows.length > 0) {
        await db.from('standings').upsert(rows, { onConflict: 'group_name,team_name' })
        standingsSynced = rows.length
      }
    }

    if (scorerRes.ok) {
      const { scorers = [] }: { scorers: FDScorer[] } = await scorerRes.json()
      const rows = scorers.map(toScorerRow)
      if (rows.length > 0) {
        await db.from('scorers').upsert(rows, { onConflict: 'player_ext_id' })
        scorersSynced = rows.length
      }
    }
  }

  return json({ matchesSynced: matchRows.length, standingsSynced, scorersSynced })
})
