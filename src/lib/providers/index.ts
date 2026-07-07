// Public surface of the provider layer.
// To swap in a different backend, change the class used here; no UI code changes needed.

export type { DataProvider } from './DataProvider'
export type {
  Competition,
  CompetitionId,
  FormLetter,
  FormWindow,
  Lineup,
  LineupPlayer,
  Match,
  MatchDetail,
  MatchEvent,
  MatchStats,
  MatchStatus,
  Player,
  StandingRow,
  StandingsGroup,
  StatPair,
  Team,
  TeamDetail,
  TeamMatchRecord,
} from './types'
export { slugify, deslugify, teamFromName, SupabaseAdapter } from './SupabaseAdapter'

import { SupabaseAdapter } from './SupabaseAdapter'
import type { DataProvider } from './DataProvider'

/** Singleton — import `provider` everywhere in the app. */
export const provider: DataProvider = new SupabaseAdapter()
