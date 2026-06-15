import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { isLocked, type Bet, type Match, type Profile } from '../types/models'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerStats = {
  profile: Profile
  totalBets: number
  played: number
  exact: number
  outcome: number
  totalPredictedGoals: number
  homePickCount: number
  drawPickCount: number
  awayPickCount: number
}

type Personality = { label: string; bg: string; text: string; icon: string }

type MatchContest = {
  match: Match
  total: number
  homeCount: number
  drawCount: number
  awayCount: number
  uniqueScores: number
}

// ---------------------------------------------------------------------------
// Personality logic
// ---------------------------------------------------------------------------

const EMOJIS = ['😮', '🎯', '💥', '🙈', '🔥'] as const

function getPersonality(s: PlayerStats): Personality {
  if (s.totalBets === 0) return { label: 'Newcomer', bg: 'bg-slate-100', text: 'text-slate-500', icon: '🌱' }

  const exactPct = s.played > 0 ? s.exact / s.played : 0
  const outcomePct = s.played > 0 ? s.outcome / s.played : 0
  const avgGoals = s.totalBets > 0 ? s.totalPredictedGoals / s.totalBets : 0
  const homePct = s.totalBets > 0 ? s.homePickCount / s.totalBets : 0
  const drawPct = s.totalBets > 0 ? s.drawPickCount / s.totalBets : 0
  const awayPct = s.totalBets > 0 ? s.awayPickCount / s.totalBets : 0

  if (exactPct > 0.25) return { label: 'Sharpshooter', bg: 'bg-pitch-50', text: 'text-pitch-700', icon: '🎯' }
  if (outcomePct > 0.65) return { label: 'Mr. Reliable', bg: 'bg-blue-50', text: 'text-blue-700', icon: '📊' }
  if (avgGoals > 3.5) return { label: 'Goal Machine', bg: 'bg-red-50', text: 'text-red-700', icon: '⚽' }
  if (avgGoals < 1.5) return { label: 'Lockdown', bg: 'bg-slate-100', text: 'text-slate-600', icon: '🛡️' }
  if (drawPct > 0.3) return { label: 'Draw Merchant', bg: 'bg-amber-50', text: 'text-amber-700', icon: '🤝' }
  if (awayPct > 0.5) return { label: 'Upset Hunter', bg: 'bg-purple-50', text: 'text-purple-700', icon: '💥' }
  if (homePct > 0.65) return { label: 'Home Lover', bg: 'bg-indigo-50', text: 'text-indigo-700', icon: '🏠' }
  return { label: 'Balanced', bg: 'bg-slate-50', text: 'text-slate-600', icon: '⚖️' }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Stats() {
  const { matches, loading: matchesLoading } = useMatches()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [bets, setBets] = useState<Bet[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [profilesRes, betsRes] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('bets').select('*'),
      ])
      setProfiles(profilesRes.data ?? [])
      setBets(betsRes.data ?? [])
      setLoading(false)
    }
    void load()

    const channel = supabase
      .channel('stats-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  const finishedMatchIds = useMemo(
    () => new Set(matches.filter((m) => m.status === 'FINISHED').map((m) => m.id)),
    [matches],
  )
  const lockedMatches = useMemo(() => matches.filter((m) => isLocked(m.kickoff_at)), [matches])

  // Per-player accuracy + style stats
  const playerStats = useMemo(() => {
    const betsByUser = new Map<string, Bet[]>()
    for (const bet of bets) {
      const list = betsByUser.get(bet.user_id) ?? []
      list.push(bet)
      betsByUser.set(bet.user_id, list)
    }

    return profiles
      .map((profile): PlayerStats & { personality: Personality } => {
        const userBets = betsByUser.get(profile.id) ?? []
        const playedBets = userBets.filter((b) => finishedMatchIds.has(b.match_id))

        let exact = 0, outcome = 0, totalGoals = 0, home = 0, draw = 0, away = 0

        for (const b of playedBets) {
          if (b.points_awarded === 3) exact++
          if ((b.points_awarded ?? 0) > 0) outcome++
        }
        for (const b of userBets) {
          totalGoals += b.predicted_home + b.predicted_away
          if (b.predicted_home > b.predicted_away) home++
          else if (b.predicted_home === b.predicted_away) draw++
          else away++
        }

        const stats: PlayerStats = {
          profile,
          totalBets: userBets.length,
          played: playedBets.length,
          exact,
          outcome,
          totalPredictedGoals: totalGoals,
          homePickCount: home,
          drawPickCount: draw,
          awayPickCount: away,
        }
        return { ...stats, personality: getPersonality(stats) }
      })
      .sort((a, b) => {
        const aRate = a.played > 0 ? a.outcome / a.played : -1
        const bRate = b.played > 0 ? b.outcome / b.played : -1
        return bRate - aRate || b.exact - a.exact || b.totalBets - a.totalBets
      })
  }, [profiles, bets, finishedMatchIds])

  // Most contested locked matches (most unique score predictions)
  const contestedMatches = useMemo<MatchContest[]>(() => {
    const betsByMatch = new Map<number, Bet[]>()
    for (const bet of bets) {
      const list = betsByMatch.get(bet.match_id) ?? []
      list.push(bet)
      betsByMatch.set(bet.match_id, list)
    }

    return lockedMatches
      .map((match) => {
        const mb = betsByMatch.get(match.id) ?? []
        let home = 0, draw = 0, away = 0
        const scores = new Set<string>()
        for (const b of mb) {
          scores.add(`${b.predicted_home}-${b.predicted_away}`)
          if (b.predicted_home > b.predicted_away) home++
          else if (b.predicted_home === b.predicted_away) draw++
          else away++
        }
        return { match, total: mb.length, homeCount: home, drawCount: draw, awayCount: away, uniqueScores: scores.size }
      })
      .filter((c) => c.total >= 2)
      .sort((a, b) => b.uniqueScores - a.uniqueScores || b.total - a.total)
      .slice(0, 5)
  }, [lockedMatches, bets])

  // Fun facts (only shown when enough data exists)
  const funFacts = useMemo(() => {
    const facts: { icon: string; text: string }[] = []
    if (playerStats.length === 0) return facts

    const withPlayed = playerStats.filter((s) => s.played > 0)
    const withBets = playerStats.filter((s) => s.totalBets > 0)

    if (withPlayed.length > 0) {
      const topExact = withPlayed.reduce((best, s) => (s.exact > best.exact ? s : best))
      if (topExact.exact > 0)
        facts.push({ icon: '🎯', text: `${topExact.profile.display_name} nailed the most exact scores — ${topExact.exact} so far.` })
    }

    if (withBets.length > 0) {
      const goalMachine = withBets.reduce((best, s) => {
        const avg = s.totalPredictedGoals / s.totalBets
        const bestAvg = best.totalPredictedGoals / best.totalBets
        return avg > bestAvg ? s : best
      })
      facts.push({
        icon: '⚽',
        text: `${goalMachine.profile.display_name} predicts the most goals — ${(goalMachine.totalPredictedGoals / goalMachine.totalBets).toFixed(1)} per match on average.`,
      })

      const drawLover = withBets.reduce((best, s) => {
        return s.drawPickCount / s.totalBets > best.drawPickCount / best.totalBets ? s : best
      })
      if (drawLover.drawPickCount > 0) {
        const pct = Math.round((drawLover.drawPickCount / drawLover.totalBets) * 100)
        facts.push({ icon: '🤝', text: `${drawLover.profile.display_name} loves a draw — ${pct}% of their picks end level.` })
      }
    }

    if (contestedMatches.length > 0) {
      const top = contestedMatches[0]
      facts.push({
        icon: '🔥',
        text: `${top.match.home_team} vs ${top.match.away_team} was the most contested — ${top.uniqueScores} different scores predicted by ${top.total} player${top.total === 1 ? '' : 's'}.`,
      })
    }

    return facts
  }, [playerStats, contestedMatches])

  if (loading || matchesLoading) return <Spinner label="Loading analytics…" />

  const anyData = playerStats.some((s) => s.totalBets > 0)

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500">Prediction styles, accuracy rates, and the numbers behind the bets.</p>
      </div>

      {!anyData && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
          Analytics fill in once players start placing predictions.
        </p>
      )}

      {/* Personality cards */}
      {anyData && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Prediction Personalities</h2>
          <p className="text-xs text-slate-400">Based on each player's betting style across all predictions.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {playerStats.map(({ profile, personality, played, exact, outcome, totalBets }) => (
              <div key={profile.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">{profile.display_name}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${personality.bg} ${personality.text}`}>
                    {personality.icon} {personality.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {totalBets === 0 ? 'No picks yet' : `${totalBets} pick${totalBets === 1 ? '' : 's'}`}
                  {played > 0 && ` · ${played} played`}
                </p>
                {played > 0 && (
                  <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-pitch-700">{exact}</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Exact</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-600">{Math.round((outcome / played) * 100)}%</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Outcome</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-700">{played}</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Played</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Accuracy table */}
      {playerStats.some((s) => s.played > 0) && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Accuracy Breakdown</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Player</th>
                  <th className="px-3 py-3 text-right">Exact</th>
                  <th className="px-3 py-3 text-right">Outcome %</th>
                  <th className="px-3 py-3 text-right">Home</th>
                  <th className="px-3 py-3 text-right">Draw</th>
                  <th className="px-3 py-3 text-right">Away</th>
                  <th className="px-4 py-3 text-right">Avg goals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {playerStats.map(({ profile, played, exact, outcome, homePickCount, drawPickCount, awayPickCount, totalBets, totalPredictedGoals }) => (
                  <tr key={profile.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{profile.display_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="font-bold text-pitch-700">{exact}</span>
                      <span className="ml-1 text-xs text-slate-300">/ {played}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {played > 0 ? (
                        <span className={outcome / played > 0.5 ? 'font-semibold text-pitch-700' : 'text-slate-600'}>
                          {Math.round((outcome / played) * 100)}%
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{homePickCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{drawPickCount}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{awayPickCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {totalBets > 0 ? (totalPredictedGoals / totalBets).toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Most contested matches */}
      {contestedMatches.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Most Contested Predictions</h2>
          <p className="text-xs text-slate-400">Matches where players disagreed the most on the scoreline.</p>
          <div className="space-y-3">
            {contestedMatches.map(({ match, total, homeCount, drawCount }) => {
              const homePct = total > 0 ? Math.round((homeCount / total) * 100) : 0
              const drawPct = total > 0 ? Math.round((drawCount / total) * 100) : 0
              const awayPct = 100 - homePct - drawPct
              return (
                <div key={match.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {match.home_team} <span className="text-slate-400">vs</span> {match.away_team}
                      </p>
                      <p className="text-xs text-slate-400">{total} player{total === 1 ? '' : 's'} predicted</p>
                    </div>
                    {match.home_score !== null && (
                      <span className="rounded-lg bg-slate-100 px-3 py-1 text-sm font-bold tabular-nums text-slate-700">
                        {match.home_score} – {match.away_score}
                      </span>
                    )}
                  </div>
                  <PickBar homePct={homePct} drawPct={drawPct} awayPct={awayPct} className="mt-3" />
                  <div className="mt-1.5 flex justify-between text-xs">
                    <span className="text-blue-600">🏠 Home {homePct}%</span>
                    <span className="text-slate-400">🤝 Draw {drawPct}%</span>
                    <span className="text-orange-500">✈️ Away {awayPct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Fun facts */}
      {funFacts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Fun Facts</h2>
          <ul className="space-y-2">
            {funFacts.map((fact, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                <span className="text-xl leading-none">{fact.icon}</span>
                {fact.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function PickBar({ homePct, drawPct, awayPct, className = '' }: { homePct: number; drawPct: number; awayPct: number; className?: string }) {
  return (
    <div className={`flex h-5 overflow-hidden rounded-full text-[10px] font-bold text-white ${className}`}>
      {homePct > 0 && (
        <div style={{ width: `${homePct}%` }} className="flex items-center justify-center bg-blue-500 transition-all">
          {homePct >= 15 ? `${homePct}%` : ''}
        </div>
      )}
      {drawPct > 0 && (
        <div style={{ width: `${drawPct}%` }} className="flex items-center justify-center bg-slate-400 transition-all">
          {drawPct >= 15 ? `${drawPct}%` : ''}
        </div>
      )}
      {awayPct > 0 && (
        <div style={{ width: `${awayPct}%` }} className="flex items-center justify-center bg-orange-400 transition-all">
          {awayPct >= 15 ? `${awayPct}%` : ''}
        </div>
      )}
    </div>
  )
}

export { EMOJIS }
