import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { sortStages, stageLabel, type Match, type Standing } from '../types/models'
import { formatKickoff, matchStatusBadge } from '../lib/format'

export default function Standings() {
  const [standings, setStandings] = useState<Standing[]>([])
  const [loading, setLoading] = useState(true)
  const { matches, loading: matchesLoading } = useMatches()

  const loadStandings = useCallback(async () => {
    const { data } = await supabase
      .from('standings')
      .select('*')
      .order('group_name', { ascending: true })
      .order('position', { ascending: true, nullsFirst: false })
    setStandings(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadStandings()

    const channel = supabase
      .channel('standings-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standings' }, () => void loadStandings())
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadStandings])

  const groups = useMemo(() => {
    const byGroup = new Map<string, Standing[]>()
    for (const row of standings) {
      const rows = byGroup.get(row.group_name) ?? []
      rows.push(row)
      byGroup.set(row.group_name, rows)
    }
    for (const rows of byGroup.values()) rows.sort(compareStandingRows)
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [standings])

  const bracket = useMemo(() => {
    const byStage = new Map<string, Match[]>()
    for (const match of matches) {
      if (match.stage === 'GROUP_STAGE') continue
      const list = byStage.get(match.stage) ?? []
      list.push(match)
      byStage.set(match.stage, list)
    }
    for (const list of byStage.values()) list.sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at))
    return sortStages(byStage.keys()).map((stage) => [stage, byStage.get(stage)!] as const)
  }, [matches])

  if (loading || matchesLoading) return <Spinner label="Loading standings…" />

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Standings</h1>
        <p className="text-sm text-slate-500">Group tables and the knockout bracket — kept in sync with official results.</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Group stage</h2>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            No group standings yet — they'll appear here once the tournament kicks off and results start syncing.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            {groups.map(([groupName, rows]) => (
              <GroupTable key={groupName} groupName={groupName} rows={rows} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Knockout bracket</h2>
        {bracket.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
            The bracket fills in once the group stage wraps up and the knockout fixtures are synced.
          </p>
        ) : (
          <div className="space-y-5">
            {bracket.map(([stage, stageMatches]) => (
              <div key={stage}>
                <h3 className="mb-2 text-sm font-semibold text-slate-700">{stageLabel(stage)}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {stageMatches.map((match) => (
                    <BracketMatch key={match.id} match={match} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function compareStandingRows(a: Standing, b: Standing): number {
  if (a.position !== null || b.position !== null) {
    return (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
  }
  if (a.points !== b.points) return b.points - a.points
  if (a.goal_difference !== b.goal_difference) return b.goal_difference - a.goal_difference
  if (a.goals_for !== b.goals_for) return b.goals_for - a.goals_for
  return a.team_name.localeCompare(b.team_name)
}

function GroupTable({ groupName, rows }: { groupName: string; rows: Standing[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900">Group {groupName}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-1.5 text-left font-medium">Team</th>
            <th className="px-1.5 py-1.5 text-right font-medium">P</th>
            <th className="px-1.5 py-1.5 text-right font-medium">W</th>
            <th className="px-1.5 py-1.5 text-right font-medium">D</th>
            <th className="px-1.5 py-1.5 text-right font-medium">L</th>
            <th className="px-1.5 py-1.5 text-right font-medium">GD</th>
            <th className="px-3 py-1.5 text-right font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} className={index < 2 ? 'bg-pitch-50' : undefined}>
              <td className="truncate px-3 py-1.5 font-medium text-slate-900">
                <span className="mr-2 text-xs tabular-nums text-slate-400">{row.position ?? index + 1}</span>
                {row.team_name}
              </td>
              <td className="px-1.5 py-1.5 text-right tabular-nums text-slate-600">{row.played}</td>
              <td className="px-1.5 py-1.5 text-right tabular-nums text-slate-600">{row.won}</td>
              <td className="px-1.5 py-1.5 text-right tabular-nums text-slate-600">{row.draw}</td>
              <td className="px-1.5 py-1.5 text-right tabular-nums text-slate-600">{row.lost}</td>
              <td className="px-1.5 py-1.5 text-right tabular-nums text-slate-600">
                {row.goal_difference > 0 ? `+${row.goal_difference}` : row.goal_difference}
              </td>
              <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
        Highlighted rows advance automatically — 2026's 48-team format also carries through the best third-placed teams, so watch the bracket below as groups wrap up.
      </p>
    </div>
  )
}

function BracketMatch({ match }: { match: Match }) {
  const hasResult = match.home_score !== null && match.away_score !== null
  const badge = matchStatusBadge(match.status)
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <time dateTime={match.kickoff_at}>{formatKickoff(match.kickoff_at)}</time>
        {badge && <span className={`rounded-full px-1.5 py-0.5 font-medium ${badge.className}`}>{badge.label}</span>}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
        <p className="truncate text-right font-medium text-slate-900">{match.home_team}</p>
        {hasResult ? (
          <div className="flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 font-bold tabular-nums text-slate-900">
            <span>{match.home_score}</span>
            <span className="text-slate-400">–</span>
            <span>{match.away_score}</span>
          </div>
        ) : (
          <span className="px-2 text-xs text-slate-400">vs</span>
        )}
        <p className="truncate font-medium text-slate-900">{match.away_team}</p>
      </div>
    </div>
  )
}
