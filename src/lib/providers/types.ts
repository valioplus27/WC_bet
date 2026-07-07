// ============================================================================
// Domain types — the internal language of the app.
//
// No provider's raw shape leaks past the adapter boundary. Every page and
// component uses these types; adapters translate upstream responses into them.
//
// Generalization hook: add a second adapter (e.g. APIFootballAdapter) that
// implements DataProvider using the same types — zero UI changes required.
// ============================================================================

// ---------------------------------------------------------------------------
// Competition
// ---------------------------------------------------------------------------

export type CompetitionId = 'WC2026' | 'WC2022' | (string & {})

export interface Competition {
  id: CompetitionId
  name: string
  season: string
}

// ---------------------------------------------------------------------------
// Team & Player
// ---------------------------------------------------------------------------

export interface Team {
  /** URL-safe slug derived from name — used as the identity key on free tier
   *  (no numeric team IDs from football-data.org free tier). */
  id: string
  name: string
  shortName?: string
  crest?: string
}

export interface Player {
  id: string
  name: string
  position?: string
  shirtNumber?: number
  nationality?: string
}

// ---------------------------------------------------------------------------
// Match status — normalized across providers
// ---------------------------------------------------------------------------

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'paused'
  | 'finished'
  | 'postponed'
  | 'cancelled'

// ---------------------------------------------------------------------------
// Match events
// ---------------------------------------------------------------------------

export type EventType =
  | 'goal'
  | 'own_goal'
  | 'penalty'
  | 'card'
  | 'substitution'
  | 'var'

export interface MatchEvent {
  minute: number
  extraMinute?: number
  type: EventType
  side: 'home' | 'away'
  player?: string
  assist?: string
  detail?: string
}

// ---------------------------------------------------------------------------
// In-match statistics
// All fields optional — free tier may not expose all; never crash on missing.
// ---------------------------------------------------------------------------

export interface StatPair {
  home: number
  away: number
}

export interface MatchStats {
  possession?: StatPair
  shots?: StatPair
  shotsOnTarget?: StatPair
  corners?: StatPair
  fouls?: StatPair
  yellowCards?: StatPair
  redCards?: StatPair
  offsides?: StatPair
}

// ---------------------------------------------------------------------------
// Lineup — only on paid tiers; omit gracefully when undefined
// ---------------------------------------------------------------------------

export interface LineupPlayer extends Player {
  position: string
  shirtNumber: number
}

export interface Lineup {
  formation?: string
  starters: LineupPlayer[]
  bench: LineupPlayer[]
}

// ---------------------------------------------------------------------------
// Core match — lightweight for calendars and lists
// ---------------------------------------------------------------------------

export interface Match {
  id: string        // internal DB id as string
  extId: string     // provider-specific external id (football-data.org id)
  competition: Competition
  stage: string
  groupName?: string
  homeTeam: Team
  awayTeam: Team
  kickoffAt: string  // ISO 8601 UTC
  status: MatchStatus
  homeScore?: number
  awayScore?: number
}

// Full match detail — Match + enrichments fetched on demand
export interface MatchDetail extends Match {
  events: MatchEvent[]   // empty array when none available (not undefined)
  stats?: MatchStats
  homeLineup?: Lineup    // omitted on free tier
  awayLineup?: Lineup
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

export interface StandingRow {
  team: Team
  position: number
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export interface StandingsGroup {
  groupName: string
  rows: StandingRow[]
}

// ---------------------------------------------------------------------------
// Team form & rolling metrics
// ---------------------------------------------------------------------------

/** Simple letter result — distinct from MatchPreview.FormResult (an object). */
export type FormLetter = 'W' | 'D' | 'L'

export interface TeamMatchRecord {
  match: Match
  goalsFor: number
  goalsAgainst: number
  result: FormLetter
  isHome: boolean
}

export interface FormWindow {
  /** Requested window (5 or 10). Actual sample may be smaller early in the tournament. */
  windowSize: number
  sampleSize: number
  /** Records from most-recent → oldest. */
  records: TeamMatchRecord[]
  avgGoalsFor: number
  avgGoalsAgainst: number
  medianGoalsFor: number
  medianGoalsAgainst: number
  wins: number
  draws: number
  losses: number
  /** 0–1 rating: W=1, D=1/3, L=0, equal-weighted. */
  formRating: number
}

export interface TeamDetail {
  team: Team
  form5: FormWindow
  form10: FormWindow
  upcoming: Match[]
  recent: Match[]
}
