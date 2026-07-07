// ============================================================================
// DataProvider interface — the contract every data adapter must implement.
//
// To plug in a second source (API-Football, StatsBomb paid, etc.):
//   1. Create a new class that implements DataProvider.
//   2. Change the singleton export in index.ts to use it.
//   3. No UI code changes required.
// ============================================================================

import type { Match, MatchDetail, StandingsGroup, TeamDetail } from './types'

export interface DataProvider {
  /**
   * Every match on a UTC calendar date (YYYY-MM-DD), sorted by kickoff time.
   * Pass competitionId to scope; omit to return all competitions in the DB.
   */
  getFixturesByDate(date: string, competitionId?: string): Promise<Match[]>

  /**
   * Single match with full detail: events, stats, lineups where the tier provides them.
   * Returns null when the match id is not found.
   */
  getMatch(matchId: string): Promise<MatchDetail | null>

  /**
   * Team detail: form windows, upcoming fixtures, recent results.
   * teamSlug is the URL-safe slug derived from the canonical team name.
   * Returns null when the slug does not resolve to a known team.
   */
  getTeam(teamSlug: string): Promise<TeamDetail | null>

  /**
   * Group-stage standings for a competition, grouped by group name.
   */
  getStandings(competitionId?: string): Promise<StandingsGroup[]>
}
