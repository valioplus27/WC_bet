import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { isLocked, picksMatch, type Bet, type Match, type Profile, type TournamentBet, type TournamentConfig } from '../types/models'

type Row = {
  profile: Profile
  matchPoints: number
  tournamentPoints: number
  total: number
  bets: Bet[]
  tournamentBet: TournamentBet | null
}

type RankedRow = Row & { rank: number }

/**
 * RLS already does the "reveal after lock" work for us: selecting from `bets`
 * returns our own rows plus everyone else's for matches whose kickoff has
 * passed (see the policy "users can view their own bets, others' once
 * locked"), and `tournament_bets` follows the same idea gated on
 * tournament_config.lock_at. So a plain select-all is exactly the right data
 * — nothing further to filter client-side for visibility.
 */
export default function Leaderboard() {
  const { session } = useAuth()
  const myId = session?.user.id
  const { matches, loading: matchesLoading } = useMatches()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [bets, setBets] = useState<Bet[]>([])
  const [tournamentBets, setTournamentBets] = useState<TournamentBet[]>([])
  const [config, setConfig] = useState<TournamentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const [profilesRes, betsRes, tournamentBetsRes, configRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('bets').select('*'),
      supabase.from('tournament_bets').select('*'),
      supabase.from('tournament_config').select('*').eq('id', 1).maybeSingle(),
    ])
    setProfiles(profilesRes.data ?? [])
    setBets(betsRes.data ?? [])
    setTournamentBets(tournamentBetsRes.data ?? [])
    setConfig(configRes.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadAll()

    const channel = supabase
      .channel('leaderboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, () => void loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_bets' }, () => void loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void loadAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_config' }, () => void loadAll())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadAll])

  // Locked = revealed, by the same kickoff-time rule the database enforces.
  const lockedMatches = useMemo(() => matches.filter((match) => isLocked(match.kickoff_at)), [matches])

  const rows = useMemo<RankedRow[]>(() => {
    const betsByUser = new Map<string, Bet[]>()
    for (const bet of bets) {
      const list = betsByUser.get(bet.user_id) ?? []
      list.push(bet)
      betsByUser.set(bet.user_id, list)
    }
    const tournamentBetByUser = new Map(tournamentBets.map((row) => [row.user_id, row]))

    const unranked = profiles.map((profile): Row => {
      const myBets = betsByUser.get(profile.id) ?? []
      const tournamentBet = tournamentBetByUser.get(profile.id) ?? null
      const matchPoints = myBets.reduce((sum, bet) => sum + (bet.points_awarded ?? 0), 0)
      const tournamentPoints = tournamentBet?.points_awarded ?? 0
      return {
        profile,
        matchPoints,
        tournamentPoints,
        total: matchPoints + tournamentPoints,
        bets: myBets,
        tournamentBet,
      }
    })

    unranked.sort((a, b) => b.total - a.total || a.profile.display_name.localeCompare(b.profile.display_name))

    // Standard competition ranking: ties share a place, the next rank skips ahead (1, 1, 3…).
    // Each rank is derived from the row immediately above it in the sorted list,
    // so no running counters need to be threaded (or mutated) across iterations.
    return unranked.reduce<RankedRow[]>((ranked, row, index) => {
      const previous = ranked[index - 1]
      const rank = previous && previous.total === row.total ? previous.rank : index + 1
      ranked.push({ ...row, rank })
      return ranked
    }, [])
  }, [profiles, bets, tournamentBets])

  if (loading || matchesLoading) return <Spinner label="Loading leaderboard…" />

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Leaderboard</h1>
        <p className="text-sm text-slate-500">
          3 pts for an exact score, 1 pt for the right outcome, plus the tournament bet. Tap a player to reveal their
          picks for matches that have locked at kickoff.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No players yet — the table fills in once people sign in and start predicting.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">Player</th>
                <th className="px-2 py-2 text-right font-medium">Matches</th>
                <th className="px-2 py-2 text-right font-medium">Tournament</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PlayerRow
                  key={row.profile.id}
                  row={row}
                  isMe={row.profile.id === myId}
                  isOpen={expandedId === row.profile.id}
                  onToggle={() => setExpandedId((current) => (current === row.profile.id ? null : row.profile.id))}
                  lockedMatches={lockedMatches}
                  config={config}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PlayerRow({
  row,
  isMe,
  isOpen,
  onToggle,
  lockedMatches,
  config,
}: {
  row: RankedRow
  isMe: boolean
  isOpen: boolean
  onToggle: () => void
  lockedMatches: Match[]
  config: TournamentConfig | null
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-slate-50 transition hover:bg-slate-50 ${isMe ? 'bg-pitch-50/50' : ''}`}
      >
        <td className="px-4 py-2.5 font-semibold tabular-nums text-slate-400">{row.rank}</td>
        <td className="px-2 py-2.5 font-medium text-slate-900">
          {row.profile.display_name}
          {isMe && (
            <span className="ml-1.5 rounded-full bg-pitch-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pitch-700">
              You
            </span>
          )}
        </td>
        <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{row.matchPoints}</td>
        <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{row.tournamentPoints}</td>
        <td className="px-4 py-2.5 text-right">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle()
            }}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} ${row.profile.display_name}'s picks`}
            className="inline-flex items-center gap-1.5 rounded-md px-1 text-base font-bold tabular-nums text-slate-900"
          >
            {row.total}
            <span className="text-xs font-normal text-slate-300">{isOpen ? '▲' : '▼'}</span>
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-slate-100 bg-slate-50/70">
          <td colSpan={5} className="px-4 py-4">
            <PlayerBreakdown row={row} lockedMatches={lockedMatches} config={config} />
          </td>
        </tr>
      )}
    </>
  )
}

function PlayerBreakdown({ row, lockedMatches, config }: { row: RankedRow; lockedMatches: Match[]; config: TournamentConfig | null }) {
  const betByMatch = useMemo(() => new Map(row.bets.map((bet) => [bet.match_id, bet])), [row.bets])
  const tournamentLocked = config ? isLocked(config.lock_at) : false
  const resultsKnown = Boolean(
    config?.actual_first && config?.actual_second && config?.actual_third && config?.actual_top_scorer,
  )

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Match picks <span className="font-normal normal-case text-slate-400">— {row.matchPoints} pts so far</span>
        </h4>
        {lockedMatches.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing revealed yet — picks appear here once a match locks at kickoff.</p>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {lockedMatches.map((match) => {
              const bet = betByMatch.get(match.id)
              return (
                <li key={match.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-slate-500">
                    {match.home_team} – {match.away_team}
                  </span>
                  {bet ? (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-semibold tabular-nums text-slate-900">
                        {bet.predicted_home}–{bet.predicted_away}
                      </span>
                      {bet.points_awarded !== null && <PointsTag points={bet.points_awarded} />}
                    </span>
                  ) : (
                    <span className="shrink-0 text-slate-400">no pick</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Tournament bet <span className="font-normal normal-case text-slate-400">— {row.tournamentPoints} pts</span>
        </h4>
        {!tournamentLocked ? (
          <p className="text-xs text-slate-400">Hidden until tournament bets lock — everyone's picks appear here together.</p>
        ) : !row.tournamentBet ? (
          <p className="text-xs text-slate-400">No tournament bet was placed before the lock.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            <TournamentPickLine label="🥇 1st" pick={row.tournamentBet.pick_first} actual={config?.actual_first ?? null} resultsKnown={resultsKnown} />
            <TournamentPickLine label="🥈 2nd" pick={row.tournamentBet.pick_second} actual={config?.actual_second ?? null} resultsKnown={resultsKnown} />
            <TournamentPickLine label="🥉 3rd" pick={row.tournamentBet.pick_third} actual={config?.actual_third ?? null} resultsKnown={resultsKnown} />
            <TournamentPickLine label="⚽ Scorer" pick={row.tournamentBet.pick_top_scorer} actual={config?.actual_top_scorer ?? null} resultsKnown={resultsKnown} />
          </ul>
        )}
      </div>
    </div>
  )
}

function TournamentPickLine({
  label,
  pick,
  actual,
  resultsKnown,
}: {
  label: string
  pick: string
  actual: string | null
  resultsKnown: boolean
}) {
  const correct = resultsKnown && picksMatch(pick, actual)
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="flex items-center gap-1.5 font-medium text-slate-900">
        <span className="truncate">{pick}</span>
        {resultsKnown && <span className={correct ? 'text-pitch-600' : 'text-slate-300'}>{correct ? '✓' : '✗'}</span>}
      </span>
    </li>
  )
}

function PointsTag({ points }: { points: number }) {
  const className =
    points >= 3 ? 'bg-pitch-50 text-pitch-700' : points >= 1 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>+{points}</span>
}
