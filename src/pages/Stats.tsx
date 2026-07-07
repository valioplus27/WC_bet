import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { isLocked, type Bet, type Match, type Profile } from '../types/models'
import { PickBar, EMOJIS } from '../components/PickBar'

// ---------------------------------------------------------------------------
// Tactical analytics types (StatsBomb WC 2022 metrics)
// ---------------------------------------------------------------------------

type TeamAnalytics = {
  team_name: string
  avg_passes_per_match: number | null
  pass_completion_rate: number | null
  avg_progressive_passes: number | null
  avg_pressures_per_match: number | null
  press_success_rate: number | null
  avg_carries_per_match: number | null
  avg_shots_per_match: number | null
  avg_xg_per_match: number | null
  avg_xg_per_shot: number | null
  avg_tackles_per_match: number | null
  avg_interceptions_per_match: number | null
  network_centralization: number | null
  avg_chain_length: number | null
  chaos_index: number | null
  matches_in_sample: number
}

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

function getPersonality(s: PlayerStats): Personality {
  if (s.totalBets === 0) return { label: 'Newcomer', bg: 'bg-surface-3', text: 'text-slate-500', icon: '🌱' }

  const exactPct = s.played > 0 ? s.exact / s.played : 0
  const outcomePct = s.played > 0 ? s.outcome / s.played : 0
  const avgGoals = s.totalBets > 0 ? s.totalPredictedGoals / s.totalBets : 0
  const homePct = s.totalBets > 0 ? s.homePickCount / s.totalBets : 0
  const drawPct = s.totalBets > 0 ? s.drawPickCount / s.totalBets : 0
  const awayPct = s.totalBets > 0 ? s.awayPickCount / s.totalBets : 0

  if (exactPct > 0.25) return { label: 'Sharpshooter', bg: 'bg-pitch-600/10', text: 'text-pitch-400', icon: '🎯' }
  if (outcomePct > 0.65) return { label: 'Mr. Reliable', bg: 'bg-blue-950/50', text: 'text-blue-700', icon: '📊' }
  if (avgGoals > 3.5) return { label: 'Goal Machine', bg: 'bg-red-950/60', text: 'text-red-400', icon: '⚽' }
  if (avgGoals < 1.5) return { label: 'Lockdown', bg: 'bg-surface-3', text: 'text-slate-400', icon: '🛡️' }
  if (drawPct > 0.3) return { label: 'Draw Merchant', bg: 'bg-amber-950/50', text: 'text-amber-400', icon: '🤝' }
  if (awayPct > 0.5) return { label: 'Upset Hunter', bg: 'bg-purple-50', text: 'text-purple-700', icon: '💥' }
  if (homePct > 0.65) return { label: 'Home Lover', bg: 'bg-indigo-50', text: 'text-indigo-700', icon: '🏠' }
  return { label: 'Balanced', bg: 'bg-surface-1', text: 'text-slate-400', icon: '⚖️' }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Funny takeaway generator from StatsBomb metrics
// ---------------------------------------------------------------------------

function generateTakeaways(teams: TeamAnalytics[]): { icon: string; text: string }[] {
  if (teams.length < 2) return []
  const facts: { icon: string; text: string }[] = []

  const byPasses = [...teams].filter((t) => t.avg_passes_per_match).sort((a, b) => (b.avg_passes_per_match ?? 0) - (a.avg_passes_per_match ?? 0))
  const byXg     = [...teams].filter((t) => t.avg_xg_per_match).sort((a, b) => (b.avg_xg_per_match ?? 0) - (a.avg_xg_per_match ?? 0))
  const byPress  = [...teams].filter((t) => t.avg_pressures_per_match).sort((a, b) => (b.avg_pressures_per_match ?? 0) - (a.avg_pressures_per_match ?? 0))
  const byChaos  = [...teams].filter((t) => t.chaos_index).sort((a, b) => (b.chaos_index ?? 0) - (a.chaos_index ?? 0))
  const byXgShot = [...teams].filter((t) => t.avg_xg_per_shot).sort((a, b) => (b.avg_xg_per_shot ?? 0) - (a.avg_xg_per_shot ?? 0))
  const byCent   = [...teams].filter((t) => t.network_centralization !== null).sort((a, b) => (b.network_centralization ?? 0) - (a.network_centralization ?? 0))

  if (byPasses.length >= 2) {
    const top = byPasses[0], bot = byPasses[byPasses.length - 1]
    const diff = Math.round((top.avg_passes_per_match ?? 0) - (bot.avg_passes_per_match ?? 0))
    facts.push({ icon: '🎭', text: `${top.team_name} averaged ${Math.round(top.avg_passes_per_match ?? 0)} passes per match — ${diff} more than ${bot.team_name}'s ${Math.round(bot.avg_passes_per_match ?? 0)}. One team plays chess, the other plays pinball.` })
  }

  if (byXg.length >= 2 && byPasses.length >= 2) {
    const efficientTeam = [...teams].filter((t) => t.avg_xg_per_shot && t.avg_passes_per_match).sort((a, b) => {
      const aEff = (a.avg_xg_per_shot ?? 0) / Math.max(a.avg_passes_per_match ?? 1, 1)
      const bEff = (b.avg_xg_per_shot ?? 0) / Math.max(b.avg_passes_per_match ?? 1, 1)
      return bEff - aEff
    })[0]
    if (efficientTeam) {
      facts.push({ icon: '🎯', text: `${efficientTeam.team_name} generates high-quality chances with minimal fuss — best xG-per-shot-per-pass ratio at WC 2022. They don't waste your time.` })
    }
  }

  if (byPress.length >= 2) {
    const maniac = byPress[0]
    facts.push({ icon: '🐕', text: `${maniac.team_name} averaged ${Math.round(maniac.avg_pressures_per_match ?? 0)} pressures per match — the most in the tournament. Their opponents spent 90 minutes being chased by rabid dogs.` })
  }

  if (byChaos.length >= 2) {
    const unpredictable = byChaos[0]
    facts.push({ icon: '🎲', text: `${unpredictable.team_name} had the highest xG variance across matches — total chaos. Brilliant one day, invisible the next. Great for neutrals, terrible for their fans.` })
  }

  if (byXgShot.length >= 2) {
    const clinical = byXgShot[0], wasteful = byXgShot[byXgShot.length - 1]
    facts.push({ icon: '🔬', text: `${clinical.team_name} averaged ${((clinical.avg_xg_per_shot ?? 0) * 100).toFixed(1)}% xG per shot — only taking high-probability chances. ${wasteful.team_name} tried their luck from everywhere with just ${((wasteful.avg_xg_per_shot ?? 0) * 100).toFixed(1)}% per shot.` })
  }

  if (byCent.length >= 2) {
    const centralized = byCent[0]
    const cent = Math.round((centralized.network_centralization ?? 0) * 100)
    facts.push({ icon: '⭐', text: `${centralized.team_name} had the most centralized passing network (${cent}% centralization score) — everything ran through one key player. Genius or single point of failure?` })
  }

  if (byPress.length >= 2) {
    const lazy = byPress[byPress.length - 1]
    facts.push({ icon: '😴', text: `${lazy.team_name} pressed the least — ${Math.round(lazy.avg_pressures_per_match ?? 0)} pressures per match. Low-block, counter-attack, and the patience of a Buddhist monk.` })
  }

  return facts.slice(0, 6)
}

// ---------------------------------------------------------------------------
// Metric bar for team comparison table
// ---------------------------------------------------------------------------

function MetricBar({ value, max, colorClass = 'bg-blue-400' }: { value: number; max: number; colorClass?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
      <div style={{ width: `${pct}%` }} className={`absolute inset-y-0 left-0 rounded-full ${colorClass}`} />
    </div>
  )
}

export default function Stats() {
  const { matches, loading: matchesLoading } = useMatches()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [bets, setBets] = useState<Bet[]>([])
  const [teamAnalytics, setTeamAnalytics] = useState<TeamAnalytics[]>([])
  const [loading, setLoading] = useState(true)
  const [tacticSort, setTacticSort] = useState<keyof TeamAnalytics>('avg_xg_per_match')

  useEffect(() => {
    async function load() {
      const [profilesRes, betsRes, analyticsRes] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('bets').select('*'),
        supabase.from('team_analytics').select('*').order('avg_xg_per_match', { ascending: false }),
      ])
      setProfiles(profilesRes.data ?? [])
      setBets(betsRes.data ?? [])
      setTeamAnalytics((analyticsRes.data ?? []) as TeamAnalytics[])
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

  const tacticalTakeaways = useMemo(() => generateTakeaways(teamAnalytics), [teamAnalytics])

  const sortedTactics = useMemo(() => {
    return [...teamAnalytics].sort((a, b) => {
      const av = (a[tacticSort] as number | null) ?? -Infinity
      const bv = (b[tacticSort] as number | null) ?? -Infinity
      return bv - av
    })
  }, [teamAnalytics, tacticSort])

  if (loading || matchesLoading) return <Spinner label="Loading analytics…" />

  const anyData = playerStats.some((s) => s.totalBets > 0)

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Analytics</h1>
        <p className="text-sm text-slate-500">Prediction styles, accuracy rates, and the numbers behind the bets.</p>
      </div>

      {!anyData && (
        <p className="rounded-lg border border-dashed border-slate-600 bg-surface-2 px-4 py-12 text-center text-sm text-slate-500">
          Analytics fill in once players start placing predictions.
        </p>
      )}

      {/* Personality cards */}
      {anyData && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-100">Prediction Personalities</h2>
          <p className="text-xs text-slate-400">Based on each player's betting style across all predictions.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {playerStats.map(({ profile, personality, played, exact, outcome, totalBets }) => (
              <div key={profile.id} className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-100">{profile.display_name}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${personality.bg} ${personality.text}`}>
                    {personality.icon} {personality.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {totalBets === 0 ? 'No picks yet' : `${totalBets} pick${totalBets === 1 ? '' : 's'}`}
                  {played > 0 && ` · ${played} played`}
                </p>
                {played > 0 && (
                  <div className="mt-3 grid grid-cols-3 divide-x divide-surface-4/40 border-t border-surface-4/40 pt-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-pitch-400">{exact}</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Exact</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-600">{Math.round((outcome / played) * 100)}%</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">Outcome</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-slate-300">{played}</p>
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
          <h2 className="text-base font-semibold text-slate-100">Accuracy Breakdown</h2>
          <div className="overflow-x-auto rounded-xl border border-surface-4/70 bg-surface-2 shadow-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-4/40 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
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
                  <tr key={profile.id} className="hover:bg-surface-1">
                    <td className="px-4 py-3 font-medium text-slate-100">{profile.display_name}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="font-bold text-pitch-400">{exact}</span>
                      <span className="ml-1 text-xs text-slate-300">/ {played}</span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {played > 0 ? (
                        <span className={outcome / played > 0.5 ? 'font-semibold text-pitch-400' : 'text-slate-400'}>
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
          <h2 className="text-base font-semibold text-slate-100">Most Contested Predictions</h2>
          <p className="text-xs text-slate-400">Matches where players disagreed the most on the scoreline.</p>
          <div className="space-y-3">
            {contestedMatches.map(({ match, total, homeCount, drawCount }) => {
              const homePct = total > 0 ? Math.round((homeCount / total) * 100) : 0
              const drawPct = total > 0 ? Math.round((drawCount / total) * 100) : 0
              const awayPct = 100 - homePct - drawPct
              return (
                <div key={match.id} className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-100">
                        {match.home_team} <span className="text-slate-400">vs</span> {match.away_team}
                      </p>
                      <p className="text-xs text-slate-400">{total} player{total === 1 ? '' : 's'} predicted</p>
                    </div>
                    {match.home_score !== null && (
                      <span className="rounded-lg bg-surface-3 px-3 py-1 text-sm font-bold tabular-nums text-slate-300">
                        {match.home_score} – {match.away_score}
                      </span>
                    )}
                  </div>
                  <PickBar homePct={homePct} drawPct={drawPct} awayPct={awayPct} className="mt-3" />
                  <div className="mt-1.5 flex justify-between text-xs">
                    <span className="text-blue-400">🏠 Home {homePct}%</span>
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
          <h2 className="text-base font-semibold text-slate-100">Fun Facts</h2>
          <ul className="space-y-2">
            {funFacts.map((fact, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-surface-4/70 bg-surface-2 p-4 text-sm text-slate-300 shadow-none">
                <span className="text-xl leading-none">{fact.icon}</span>
                {fact.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tactical analytics (StatsBomb WC 2022)                              */}
      {/* ------------------------------------------------------------------ */}

      {teamAnalytics.length > 0 && (
        <>
          <div className="border-t border-surface-4 pt-6">
            <h1 className="text-xl font-bold text-slate-100">Tactical Intelligence</h1>
            <p className="text-sm text-slate-500">
              Per-team metrics from StatsBomb WC 2022 open data — historical reference for how teams play.
              <span className="ml-1 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-slate-500">WC 2022</span>
            </p>
          </div>

          {/* Funny tactical takeaways */}
          {tacticalTakeaways.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-slate-100">The Verdict</h2>
              <p className="text-xs text-slate-400">Auto-generated from the numbers. Results may be unfair to your team.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {tacticalTakeaways.map((t, i) => (
                  <div key={i} className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
                    <div className="mb-2 text-2xl">{t.icon}</div>
                    <p className="text-sm text-slate-300 leading-relaxed">{t.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Team fingerprint comparison table */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-100">Team Fingerprints</h2>
                <p className="text-xs text-slate-400">Click a column header to re-sort.</p>
              </div>
              <span className="text-[10px] text-slate-400">{teamAnalytics[0]?.matches_in_sample ?? '?'} matches/team avg</span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-surface-4/70 bg-surface-2 shadow-none">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-surface-4/40 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 sticky left-0 bg-surface-2">Team</th>
                    {([
                      ['avg_xg_per_match',          'xG/game',    'bg-pitch-400'],
                      ['avg_shots_per_match',        'Shots/game', 'bg-blue-400'],
                      ['avg_passes_per_match',       'Passes/game','bg-indigo-400'],
                      ['pass_completion_rate',       'Pass %',     'bg-indigo-300'],
                      ['avg_pressures_per_match',    'Press/game', 'bg-orange-400'],
                      ['network_centralization',     'Net. cent.', 'bg-purple-400'],
                      ['chaos_index',                'Chaos',      'bg-red-400'],
                    ] as const).map(([key, label]) => (
                      <th
                        key={key}
                        className="px-3 py-3 text-right cursor-pointer hover:text-slate-300 select-none"
                        onClick={() => setTacticSort(key)}
                      >
                        {label}{tacticSort === key ? ' ↓' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sortedTactics.map((t) => {
                    const maxXg       = Math.max(...teamAnalytics.map((x) => x.avg_xg_per_match ?? 0))
                    const maxShots    = Math.max(...teamAnalytics.map((x) => x.avg_shots_per_match ?? 0))
                    const maxPasses   = Math.max(...teamAnalytics.map((x) => x.avg_passes_per_match ?? 0))
                    const maxPressure = Math.max(...teamAnalytics.map((x) => x.avg_pressures_per_match ?? 0))
                    const maxChaos    = Math.max(...teamAnalytics.map((x) => x.chaos_index ?? 0))
                    return (
                      <tr key={t.team_name} className="hover:bg-surface-1">
                        <td className="px-4 py-2.5 font-medium text-slate-100 sticky left-0 bg-surface-2">{t.team_name}</td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <MetricBar value={t.avg_xg_per_match ?? 0} max={maxXg} colorClass="bg-pitch-400" />
                            <span className="w-10 tabular-nums font-semibold text-pitch-400">{t.avg_xg_per_match?.toFixed(2) ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <MetricBar value={t.avg_shots_per_match ?? 0} max={maxShots} colorClass="bg-blue-400" />
                            <span className="w-10 tabular-nums">{t.avg_shots_per_match?.toFixed(1) ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <MetricBar value={t.avg_passes_per_match ?? 0} max={maxPasses} colorClass="bg-indigo-400" />
                            <span className="w-12 tabular-nums">{t.avg_passes_per_match?.toFixed(0) ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {t.pass_completion_rate != null ? `${Math.round(t.pass_completion_rate * 100)}%` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <MetricBar value={t.avg_pressures_per_match ?? 0} max={maxPressure} colorClass="bg-orange-400" />
                            <span className="w-10 tabular-nums">{t.avg_pressures_per_match?.toFixed(0) ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {t.network_centralization != null ? `${Math.round(t.network_centralization * 100)}%` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <MetricBar value={t.chaos_index ?? 0} max={maxChaos} colorClass="bg-red-400" />
                            <span className="w-10 tabular-nums">{t.chaos_index?.toFixed(2) ?? '—'}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400">
              Chaos index = xG variance normalised by mean xG. Network centralization = Freeman index (0 = distributed, 100% = all through one player).
              Data: StatsBomb WC 2022 open data (CC BY-SA 4.0) — run "Compute Team Analytics" from Admin to populate.
            </p>
          </section>
        </>
      )}

      {teamAnalytics.length === 0 && (
        <section className="rounded-xl border border-dashed border-slate-600 bg-surface-2 p-8 text-center">
          <p className="text-sm font-medium text-slate-300">Tactical analytics not yet computed</p>
          <p className="mt-1 text-xs text-slate-400">
            First run StatsBomb ingestion, then hit "Compute Team Analytics" in Admin.
          </p>
        </section>
      )}
    </div>
  )
}

export { PickBar, EMOJIS }
