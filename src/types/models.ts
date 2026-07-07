import type { Database } from './database'

export type Profile = Database['public']['Tables']['profiles']['Row']
export type Reaction = Database['public']['Tables']['reactions']['Row']
export type Scorer = Database['public']['Tables']['scorers']['Row']
export type Match = Database['public']['Tables']['matches']['Row']
export type Standing = Database['public']['Tables']['standings']['Row']
export type Bet = Database['public']['Tables']['bets']['Row']
export type TournamentBet = Database['public']['Tables']['tournament_bets']['Row']
export type TournamentConfig = Database['public']['Tables']['tournament_config']['Row']
export type Prediction = Database['public']['Tables']['predictions']['Row']
export type Shot = Database['public']['Tables']['shots']['Row']
export type MatchEvent = Database['public']['Tables']['match_events']['Row']
export type MatchEventLive = Database['public']['Tables']['match_events_live']['Row']
export type MatchStats = Database['public']['Tables']['match_stats']['Row']

// 2026 expands to 48 teams, so a Round of 32 precedes the Round of 16 — both
// rounds are listed under both spellings data sources use in practice
// (football-data.org sends LAST_32/LAST_16; others send ROUND_OF_32/ROUND_OF_16).
export const KNOCKOUT_STAGE_ORDER = [
  'LAST_32',
  'ROUND_OF_32',
  'LAST_16',
  'ROUND_OF_16',
  'QUARTER_FINALS',
  'SEMI_FINALS',
  'THIRD_PLACE',
  'FINAL',
] as const

/** Bracket stages in tournament order; anything unrecognized sorts after, alphabetically. */
export function sortStages(stages: Iterable<string>): string[] {
  const known = new Map<string, number>(KNOCKOUT_STAGE_ORDER.map((stage, index) => [stage, index]))
  return [...stages].sort((a, b) => {
    const ai = known.get(a)
    const bi = known.get(b)
    if (ai !== undefined && bi !== undefined) return ai - bi
    if (ai !== undefined) return -1
    if (bi !== undefined) return 1
    return a.localeCompare(b)
  })
}

export const STAGE_LABELS: Record<string, string> = {
  GROUP_STAGE: 'Group stage',
  LAST_32: 'Round of 32',
  ROUND_OF_32: 'Round of 32',
  LAST_16: 'Round of 16',
  ROUND_OF_16: 'Round of 16',
  QUARTER_FINALS: 'Quarter-finals',
  SEMI_FINALS: 'Semi-finals',
  THIRD_PLACE: 'Third-place play-off',
  FINAL: 'Final',
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

export function isLocked(kickoffAt: string, now: Date = new Date()): boolean {
  return new Date(kickoffAt).getTime() <= now.getTime()
}

/**
 * Mirrors the SQL comparison in calculate_tournament_points (lower + trim),
 * so the UI's "✓ correct" markers always agree with the points the database
 * actually awards — important since the top-scorer pick is free text.
 */
export function picksMatch(pick: string, actual: string | null): boolean {
  if (actual === null) return false
  return pick.trim().toLowerCase() === actual.trim().toLowerCase()
}
