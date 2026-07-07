// ============================================================================
// SupabaseAdapter — reads from our Supabase DB (pre-populated by ingestion
// edge functions) and translates DB rows into domain types.
//
// The DB is the cache. Reads never hit football-data.org or API-Football
// directly; those are the job of the scheduled ingestion functions.
// ============================================================================

import { supabase } from '../supabase'
import type { DataProvider } from './DataProvider'
import type {
  Competition,
  FormLetter,
  FormWindow,
  Match,
  MatchDetail,
  MatchEvent,
  MatchStats,
  MatchStatus,
  StandingRow,
  StandingsGroup,
  Team,
  TeamDetail,
  TeamMatchRecord,
} from './types'
import type { Database } from '../../types/database'

type DbMatch = Database['public']['Tables']['matches']['Row']
type DbEvent = Database['public']['Tables']['match_events_live']['Row']
type DbStats = Database['public']['Tables']['match_stats']['Row']

// ---------------------------------------------------------------------------
// Static competition registry — extend when multi-competition support is added
// ---------------------------------------------------------------------------

const WC_2026: Competition = { id: 'WC2026', name: 'FIFA World Cup 2026', season: '2026' }

// ---------------------------------------------------------------------------
// Slug utilities (exported so pages can use them for route generation)
// ---------------------------------------------------------------------------

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip diacritics: ô→o, é→e, etc.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Name-alias map: StatsBomb names → football-data.org WC2026 names.
// When Analytics (StatsBomb source) links to /team/<slug>, the slug is built
// from the StatsBomb name. This map lets deslugify find the WC2026 match name.
const TEAM_ALIASES: Record<string, string> = {
  'south-korea':  'Korea Republic',
  'iran':         'IR Iran',
  'ivory-coast':  'Côte d\'Ivoire',
  'usa':          'United States',
  'republic-of-korea': 'Korea Republic',
  'north-macedonia': 'North Macedonia',
  'czechia':      'Czech Republic',
}

export function deslugify(slug: string, allNames: string[]): string | null {
  // Direct slug match
  const direct = allNames.find((n) => slugify(n) === slug)
  if (direct) return direct
  // Alias fallback (StatsBomb name → WC2026 name)
  const aliased = TEAM_ALIASES[slug]
  if (aliased && allNames.includes(aliased)) return aliased
  // Loose partial match (last resort: slug prefix)
  return allNames.find((n) => slugify(n).startsWith(slug.slice(0, 6))) ?? null
}

// ---------------------------------------------------------------------------
// Row → domain type translators
// ---------------------------------------------------------------------------

function normalizeStatus(s: string): MatchStatus {
  switch (s) {
    case 'IN_PLAY':   return 'live'
    case 'PAUSED':    return 'paused'
    case 'FINISHED':  return 'finished'
    case 'POSTPONED': return 'postponed'
    case 'SUSPENDED':
    case 'CANCELLED': return 'cancelled'
    default:          return 'scheduled'
  }
}

export function teamFromName(name: string): Team {
  return { id: slugify(name), name }
}

function matchFromRow(row: DbMatch): Match {
  return {
    id:          String(row.id),
    extId:       row.ext_id,
    competition: WC_2026,
    stage:       row.stage,
    groupName:   row.group_name ?? undefined,
    homeTeam:    teamFromName(row.home_team),
    awayTeam:    teamFromName(row.away_team),
    kickoffAt:   row.kickoff_at,
    status:      normalizeStatus(row.status),
    homeScore:   row.home_score ?? undefined,
    awayScore:   row.away_score ?? undefined,
  }
}

function eventsFromRows(rows: DbEvent[], homeTeamName: string): MatchEvent[] {
  return rows
    .map((row): MatchEvent => {
      const side: 'home' | 'away' = row.team === homeTeamName ? 'home' : 'away'
      let type: MatchEvent['type'] = 'goal'
      if (row.event_type === 'Card')  type = 'card'
      else if (row.event_type === 'subst') type = 'substitution'
      else if (row.event_type === 'Var')   type = 'var'
      else if (row.detail === 'Own Goal')  type = 'own_goal'
      else if (row.detail === 'Penalty')   type = 'penalty'
      return {
        minute:      row.minute,
        extraMinute: row.extra_minute ?? undefined,
        type,
        side,
        player:  row.player  ?? undefined,
        assist:  row.assist  ?? undefined,
        detail:  row.detail  ?? undefined,
      }
    })
    .sort((a, b) => (a.minute * 100 + (a.extraMinute ?? 0)) - (b.minute * 100 + (b.extraMinute ?? 0)))
}

function statsFromRow(row: DbStats): MatchStats {
  const pair = (h: number | null, a: number | null) =>
    h !== null && a !== null ? { home: h, away: a } : undefined
  return {
    possession:    pair(row.home_possession,       row.away_possession),
    shots:         pair(row.home_shots,            row.away_shots),
    shotsOnTarget: pair(row.home_shots_on_target,  row.away_shots_on_target),
    corners:       pair(row.home_corners,          row.away_corners),
    fouls:         pair(row.home_fouls,            row.away_fouls),
    yellowCards:   pair(row.home_yellow_cards,     row.away_yellow_cards),
    redCards:      pair(row.home_red_cards,        row.away_red_cards),
    offsides:      pair(row.home_offsides,         row.away_offsides),
  }
}

// ---------------------------------------------------------------------------
// Rolling form computation
// ---------------------------------------------------------------------------

function sortedMedian(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function computeFormWindow(
  finishedMatches: Match[],
  teamName: string,
  windowSize: number,
): FormWindow {
  const relevant = finishedMatches
    .filter((m) => m.homeTeam.name === teamName || m.awayTeam.name === teamName)
    .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime())
    .slice(0, windowSize)

  const records: TeamMatchRecord[] = relevant.map((m): TeamMatchRecord => {
    const isHome  = m.homeTeam.name === teamName
    const gf      = isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0)
    const ga      = isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0)
    const result: FormLetter = gf > ga ? 'W' : gf === ga ? 'D' : 'L'
    return { match: m, goalsFor: gf, goalsAgainst: ga, result, isHome }
  })

  const n = records.length
  if (n === 0) {
    return { windowSize, sampleSize: 0, records: [], avgGoalsFor: 0, avgGoalsAgainst: 0, medianGoalsFor: 0, medianGoalsAgainst: 0, wins: 0, draws: 0, losses: 0, formRating: 0 }
  }

  const wins   = records.filter((r) => r.result === 'W').length
  const draws  = records.filter((r) => r.result === 'D').length
  const losses = n - wins - draws
  const gfSorted = records.map((r) => r.goalsFor).sort((a, b) => a - b)
  const gaSorted = records.map((r) => r.goalsAgainst).sort((a, b) => a - b)

  return {
    windowSize,
    sampleSize: n,
    records,
    avgGoalsFor:      records.reduce((s, r) => s + r.goalsFor,      0) / n,
    avgGoalsAgainst:  records.reduce((s, r) => s + r.goalsAgainst,  0) / n,
    medianGoalsFor:   sortedMedian(gfSorted),
    medianGoalsAgainst: sortedMedian(gaSorted),
    wins,
    draws,
    losses,
    formRating: (wins * 3 + draws) / (n * 3),
  }
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export class SupabaseAdapter implements DataProvider {
  // Thin in-memory cache of all team names — populated on first getTeam/getTeamHistory call.
  private _allTeamNames: string[] | null = null

  private async allTeamNames(): Promise<string[]> {
    if (this._allTeamNames) return this._allTeamNames
    const { data } = await supabase.from('matches').select('home_team, away_team')
    const names = new Set<string>()
    for (const row of data ?? []) { names.add(row.home_team); names.add(row.away_team) }
    this._allTeamNames = [...names]
    return this._allTeamNames
  }

  async getFixturesByDate(date: string): Promise<Match[]> {
    const start = `${date}T00:00:00.000Z`
    const end   = new Date(new Date(start).getTime() + 86_400_000).toISOString()
    const { data } = await supabase
      .from('matches')
      .select('*')
      .gte('kickoff_at', start)
      .lt('kickoff_at', end)
      .order('kickoff_at', { ascending: true })
    return (data ?? []).map(matchFromRow)
  }

  async getMatch(matchId: string): Promise<MatchDetail | null> {
    const numId = Number(matchId)
    const { data: row } = await supabase
      .from('matches')
      .select('*')
      .eq('id', numId)
      .single()
    if (!row) return null

    const [eventsRes, statsRes] = await Promise.all([
      supabase.from('match_events_live').select('*').eq('match_id', numId),
      supabase.from('match_stats').select('*').eq('match_id', numId).maybeSingle(),
    ])

    return {
      ...matchFromRow(row),
      events: eventsFromRows(eventsRes.data ?? [], row.home_team),
      stats:  statsRes.data ? statsFromRow(statsRes.data) : undefined,
    }
  }

  async getTeam(teamSlug: string): Promise<TeamDetail | null> {
    const names    = await this.allTeamNames()
    const teamName = deslugify(teamSlug, names)
    if (!teamName) return null

    const { data: allRows } = await supabase
      .from('matches')
      .select('*')
      .order('kickoff_at', { ascending: false })

    const all      = (allRows ?? []).map(matchFromRow)
    const finished = all.filter((m) => m.status === 'finished')
    const now      = Date.now()
    const upcoming = all
      .filter((m) =>
        (m.homeTeam.name === teamName || m.awayTeam.name === teamName) &&
        new Date(m.kickoffAt).getTime() > now,
      )
      .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())
      .slice(0, 5)

    const recent = all
      .filter((m) =>
        (m.homeTeam.name === teamName || m.awayTeam.name === teamName) &&
        m.status === 'finished',
      )
      .slice(0, 10)

    return {
      team:     teamFromName(teamName),
      form5:    computeFormWindow(finished, teamName, 5),
      form10:   computeFormWindow(finished, teamName, 10),
      upcoming,
      recent,
    }
  }

  async getStandings(): Promise<StandingsGroup[]> {
    const { data } = await supabase.from('standings').select('*')
    if (!data) return []

    const byGroup = new Map<string, StandingRow[]>()
    for (const row of data) {
      const sr: StandingRow = {
        team:           teamFromName(row.team_name),
        position:       row.position ?? 0,
        played:         row.played,
        won:            row.won,
        drawn:          row.draw,
        lost:           row.lost,
        goalsFor:       row.goals_for,
        goalsAgainst:   row.goals_against,
        goalDifference: row.goal_difference,
        points:         row.points,
      }
      const list = byGroup.get(row.group_name) ?? []
      list.push(sr)
      byGroup.set(row.group_name, list)
    }

    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupName, rows]) => ({
        groupName,
        rows: rows.sort((a, b) => a.position - b.position || b.points - a.points),
      }))
  }
}
