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
  // Calibration metrics (computed from locked finished matches)
  outcomeCorrect: number   // count correct outcome (1/0 each)
  outcomePlayed: number    // count finished locked bets
  brierSum: number         // sum of per-bet Brier scores (lower = better)
}

type RankedRow = Row & { rank: number }

function betOutcome(predicted_home: number, predicted_away: number): 'home_win' | 'draw' | 'away_win' {
  if (predicted_home > predicted_away) return 'home_win'
  if (predicted_home < predicted_away) return 'away_win'
  return 'draw'
}

function matchOutcome(home_score: number, away_score: number): 'home_win' | 'draw' | 'away_win' {
  if (home_score > away_score) return 'home_win'
  if (home_score < away_score) return 'away_win'
  return 'draw'
}

function brierScore(predicted: 'home_win' | 'draw' | 'away_win', actual: 'home_win' | 'draw' | 'away_win'): number {
  const outcomes = ['home_win', 'draw', 'away_win'] as const
  return outcomes.reduce((sum, o) => {
    const p = predicted === o ? 1 : 0
    const a = actual === o ? 1 : 0
    return sum + (p - a) ** 2
  }, 0)
}

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

    // Build map of finished locked matches for Brier computation
    const finishedMatchMap = new Map<number, Match>()
    for (const m of matches) {
      if (m.status === 'FINISHED' && m.home_score !== null && m.away_score !== null && isLocked(m.kickoff_at)) {
        finishedMatchMap.set(m.id, m)
      }
    }

    const unranked = profiles.map((profile): Row => {
      const myBets = betsByUser.get(profile.id) ?? []
      const tournamentBet = tournamentBetByUser.get(profile.id) ?? null
      const matchPoints = myBets.reduce((sum, bet) => sum + (bet.points_awarded ?? 0), 0)
      const tournamentPoints = tournamentBet?.points_awarded ?? 0

      let outcomeCorrect = 0, outcomePlayed = 0, brierSum = 0
      for (const bet of myBets) {
        const m = finishedMatchMap.get(bet.match_id)
        if (!m || m.home_score === null || m.away_score === null) continue
        const predicted = betOutcome(bet.predicted_home, bet.predicted_away)
        const actual    = matchOutcome(m.home_score, m.away_score)
        if (predicted === actual) outcomeCorrect++
        brierSum += brierScore(predicted, actual)
        outcomePlayed++
      }

      return {
        profile, matchPoints, tournamentPoints,
        total: matchPoints + tournamentPoints,
        bets: myBets, tournamentBet,
        outcomeCorrect, outcomePlayed, brierSum,
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

  const [sortBy, setSortBy] = useState<'points' | 'brier'>('points')

  const sortedRows = useMemo(() => {
    if (sortBy === 'brier') {
      return [...rows]
        .filter((r) => r.outcomePlayed >= 3)
        .sort((a, b) => (a.brierSum / a.outcomePlayed) - (b.brierSum / b.outcomePlayed))
    }
    return rows
  }, [rows, sortBy])

  if (loading || matchesLoading) return <Spinner label="Loading leaderboard…" />

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Leaderboard</h1>
        <p className="text-sm text-slate-500">
          3 pts for exact score, 1 pt for right outcome, plus tournament bet. Tap a player to see their picks.
        </p>
      </div>

      {/* Sort toggle */}
      <div className="flex gap-2">
        {(['points', 'brier'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSortBy(s)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              sortBy === s ? 'bg-pitch-600/20 text-pitch-400 ring-1 ring-pitch-600/30' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            {s === 'points' ? '🏆 By points' : '🎯 By calibration (Brier)'}
          </button>
        ))}
        {sortBy === 'brier' && (
          <span className="self-center text-xs text-slate-500">Min. 3 predictions · lower Brier = better calibrated</span>
        )}
      </div>

      {sortedRows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-600 bg-surface-2 px-4 py-8 text-center text-sm text-slate-500">
          {sortBy === 'brier' ? 'Need at least 3 resolved predictions to rank by calibration.' : 'No players yet.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-4 bg-surface-2 shadow-none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-4/40 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">Player</th>
                {sortBy === 'points' ? (
                  <>
                    <th className="px-2 py-2 text-right font-medium">Matches</th>
                    <th className="px-2 py-2 text-right font-medium">Tournament</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-2 text-right font-medium">Correct %</th>
                    <th className="px-2 py-2 text-right font-medium">Brier ↓</th>
                    <th className="px-4 py-2 text-right font-medium">Played</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, idx) => (
                <PlayerRow
                  key={row.profile.id}
                  row={row}
                  idx={idx}
                  sortBy={sortBy}
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
  row, isMe, isOpen, onToggle, lockedMatches, config, sortBy, idx,
}: {
  row: RankedRow; isMe: boolean; isOpen: boolean; onToggle: () => void
  lockedMatches: Match[]; config: TournamentConfig | null
  sortBy: 'points' | 'brier'; idx: number
}) {
  const avgBrier = row.outcomePlayed > 0 ? row.brierSum / row.outcomePlayed : null
  const outcomePct = row.outcomePlayed > 0 ? Math.round((row.outcomeCorrect / row.outcomePlayed) * 100) : null

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-surface-4/30 transition hover:bg-surface-3 ${isMe ? 'bg-pitch-600/10' : ''}`}
      >
        <td className="px-4 py-2.5 font-semibold tabular-nums text-slate-400">
          {sortBy === 'points' ? row.rank : idx + 1}
        </td>
        <td className="px-2 py-2.5 font-medium text-slate-100">
          {row.profile.display_name}
          {isMe && (
            <span className="ml-1.5 rounded-full bg-pitch-600/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pitch-400">
              You
            </span>
          )}
        </td>
        {sortBy === 'points' ? (
          <>
            <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{row.matchPoints}</td>
            <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{row.tournamentPoints}</td>
            <td className="px-4 py-2.5 text-right">
              <button type="button" onClick={(e) => { e.stopPropagation(); onToggle() }}
                aria-expanded={isOpen}
                className="inline-flex items-center gap-1.5 rounded-md px-1 text-base font-bold tabular-nums text-slate-100">
                {row.total}
                <span className="text-xs font-normal text-slate-400">{isOpen ? '▲' : '▼'}</span>
              </button>
            </td>
          </>
        ) : (
          <>
            <td className="px-2 py-2.5 text-right tabular-nums">
              <span className={outcomePct != null && outcomePct >= 60 ? 'text-green-400 font-semibold' : 'text-slate-300'}>
                {outcomePct != null ? `${outcomePct}%` : '—'}
              </span>
            </td>
            <td className="px-2 py-2.5 text-right tabular-nums">
              <span className={avgBrier != null && avgBrier < 0.5 ? 'text-pitch-400 font-semibold' : 'text-slate-300'}>
                {avgBrier != null ? avgBrier.toFixed(3) : '—'}
              </span>
            </td>
            <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">{row.outcomePlayed}</td>
          </>
        )}
      </tr>
      {isOpen && (
        <tr className="border-b border-surface-4/40 bg-surface-1/50">
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
                      <span className="font-semibold tabular-nums text-slate-100">
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
      <span className="flex items-center gap-1.5 font-medium text-slate-100">
        <span className="truncate">{pick}</span>
        {resultsKnown && <span className={correct ? 'text-pitch-400' : 'text-slate-300'}>{correct ? '✓' : '✗'}</span>}
      </span>
    </li>
  )
}

function PointsTag({ points }: { points: number }) {
  const className =
    points >= 3 ? 'bg-pitch-600/10 text-pitch-400' : points >= 1 ? 'bg-amber-950/50 text-amber-400' : 'bg-surface-3 text-slate-500'
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>+{points}</span>
}
