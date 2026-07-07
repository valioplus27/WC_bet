import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/Spinner'
import type { Scorer } from '../types/models'

export default function Scorers() {
  const [scorers, setScorers] = useState<Scorer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('scorers')
        .select('*')
        .order('goals', { ascending: false })
        .order('assists', { ascending: false })
        .order('played_matches', { ascending: true })
      if (error) setError(error.message)
      else setScorers(data ?? [])
      setLoading(false)
    }
    void load()

    const channel = supabase
      .channel('scorers-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scorers' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  if (loading) return <Spinner label="Loading top scorers…" />
  if (error) return <p className="rounded-md bg-red-950/60 px-4 py-3 text-sm text-red-400">Couldn't load scorers: {error}</p>

  if (scorers.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-600 bg-surface-2 px-4 py-12 text-center text-sm text-slate-500">
        Top scorers will appear here once matches have been played.
      </p>
    )
  }

  const updatedAt = scorers[0]?.updated_at
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scorers[0].updated_at))
    : null

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-slate-100">Top Scorers</h1>
        {updatedAt && <p className="text-xs text-slate-400">Updated {updatedAt}</p>}
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-4 bg-surface-2 shadow-none">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-4/40 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 w-8">#</th>
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3 text-slate-500">Team</th>
              <th className="px-4 py-3 text-right" title="Goals">G</th>
              <th className="px-4 py-3 text-right" title="Assists">A</th>
              <th className="px-4 py-3 text-right text-slate-300" title="Penalties scored">P</th>
              <th className="px-4 py-3 text-right text-slate-400" title="Matches played">MP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {scorers.map((scorer, idx) => (
              <tr key={scorer.id} className={idx === 0 ? 'bg-amber-950/50/60' : 'hover:bg-surface-1'}>
                <td className="px-4 py-3 text-slate-400 font-medium tabular-nums">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                </td>
                <td className="px-4 py-3">
                  <span className="font-semibold text-slate-100">{scorer.player_name}</span>
                  {scorer.nationality && (
                    <span className="ml-2 text-xs text-slate-400">{scorer.nationality}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{scorer.team_name}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-pitch-400">{scorer.goals}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">{scorer.assists}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">{scorer.penalties}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400 text-xs">{scorer.played_matches}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
