/**
 * MatchAnalysis — per-match deep dive using StatsBomb open-data (WC 2022).
 *
 * Accessible via /analysis?match=sb_43_<matchId>. Shows:
 *   • Shot map for each team
 *   • xG totals and comparison
 *   • Passing network with network metrics (centralization, key connector)
 *   • Tactical fingerprint summary
 *
 * Data availability note: StatsBomb open data covers WC 2022 historical
 * matches only. WC 2026 live event data is not available on this free tier.
 * An admin must run the StatsBomb ingestion (Admin → StatsBomb section) before
 * this page shows anything.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/Spinner'
import { ShotMap } from '../components/ShotMap'
import { PassingNetworkViz, buildNetwork } from '../components/PassingNetwork'
import type { Shot, MatchEvent } from '../types/models'

// ---------------------------------------------------------------------------
// Shared xG bar
// ---------------------------------------------------------------------------

function XGBar({ homeXG, awayXG, homeTeam, awayTeam }: {
  homeXG: number; awayXG: number; homeTeam: string; awayTeam: string
}) {
  const total = homeXG + awayXG || 1
  const homePct = Math.round((homeXG / total) * 100)
  const awayPct = 100 - homePct

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-slate-500">
        <span>{homeTeam}</span>
        <span className="font-semibold text-slate-100">xG</span>
        <span>{awayTeam}</span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full text-[10px] font-bold text-white">
        <div style={{ width: `${homePct}%` }} className="flex items-center justify-center bg-blue-500">
          {homePct > 20 ? `${homeXG.toFixed(2)}` : ''}
        </div>
        <div style={{ width: `${awayPct}%` }} className="flex items-center justify-center bg-orange-400">
          {awayPct > 20 ? `${awayXG.toFixed(2)}` : ''}
        </div>
      </div>
      <div className="flex justify-between text-xs tabular-nums text-slate-400">
        <span className="text-blue-400 font-semibold">{homeXG.toFixed(2)}</span>
        <span className="text-orange-500 font-semibold">{awayXG.toFixed(2)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MatchAnalysis() {
  const [params] = useSearchParams()
  const matchExtId = params.get('match')

  const [shots, setShots] = useState<Shot[]>([])
  const [events, setEvents] = useState<MatchEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!matchExtId) { setLoading(false); return }
    async function load() {
      const mid = matchExtId!
      const [shotsRes, eventsRes] = await Promise.all([
        supabase.from('shots').select('*').eq('match_ext_id', mid).eq('source', 'statsbomb'),
        supabase.from('match_events').select('*').eq('match_ext_id', mid).eq('source', 'statsbomb'),
      ])
      if (shotsRes.error) { setError(shotsRes.error.message); setLoading(false); return }
      if (eventsRes.error) { setError(eventsRes.error.message); setLoading(false); return }
      setShots(shotsRes.data ?? [])
      setEvents(eventsRes.data ?? [])
      setLoading(false)
    }
    void load()
  }, [matchExtId])

  const teams = useMemo(() => [...new Set(shots.map((s) => s.team))].sort(), [shots])
  const homeTeam = teams[0] ?? 'Home'
  const awayTeam = teams[1] ?? 'Away'

  const homeShots = useMemo(() => shots.filter((s) => s.team === homeTeam), [shots, homeTeam])
  const awayShots = useMemo(() => shots.filter((s) => s.team === awayTeam), [shots, awayTeam])

  const homeXG = useMemo(() => homeShots.reduce((s, sh) => s + (sh.xg ?? 0), 0), [homeShots])
  const awayXG = useMemo(() => awayShots.reduce((s, sh) => s + (sh.xg ?? 0), 0), [awayShots])

  const homeNetwork = useMemo(() => buildNetwork(events, homeTeam), [events, homeTeam])
  const awayNetwork = useMemo(() => buildNetwork(events, awayTeam), [events, awayTeam])

  if (!matchExtId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-xl font-bold text-slate-100">Match Analysis</h1>
        <p className="text-sm text-slate-500">
          This page shows shot maps, xG, and passing networks for individual WC 2022 matches
          (StatsBomb open data). Navigate here via a match link, or provide a{' '}
          <code className="rounded bg-surface-3 px-1 text-xs">?match=sb_43_&lt;id&gt;</code> query param.
        </p>
        <p className="text-sm">
          <Link to="/admin" className="font-medium text-pitch-400 hover:underline">
            Admin → StatsBomb section
          </Link>{' '}
          must be run first to populate the data.
        </p>
      </div>
    )
  }

  if (loading) return <Spinner label="Loading match data…" />

  if (error) {
    return <p className="rounded-md bg-red-950/60 px-4 py-3 text-sm text-red-400">Error: {error}</p>
  }

  if (shots.length === 0 && events.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-xl font-bold text-slate-100">Match Analysis</h1>
        <p className="rounded-lg border border-dashed border-slate-600 bg-surface-2 px-4 py-12 text-center text-sm text-slate-500">
          No data found for <code className="rounded bg-surface-3 px-1">{matchExtId}</code>.
          Run the StatsBomb ingestion from the{' '}
          <Link to="/admin" className="font-medium text-pitch-400 hover:underline">Admin page</Link> first.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <p className="text-xs text-slate-400">StatsBomb open data · WC 2022 · CC BY-SA 4.0</p>
        <h1 className="text-xl font-bold text-slate-100">
          {homeTeam} <span className="text-slate-400">vs</span> {awayTeam}
        </h1>
      </div>

      {/* xG bar */}
      <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
        <h2 className="mb-3 text-sm font-semibold text-slate-100">Expected goals (xG)</h2>
        <XGBar homeXG={homeXG} awayXG={awayXG} homeTeam={homeTeam} awayTeam={awayTeam} />
        <p className="mt-3 text-xs text-slate-400">
          xG measures the quality of each shot based on location, body part, and situation. Higher xG = better chances created.
        </p>
      </section>

      {/* Shot maps */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold text-slate-100">Shot maps — attacking half</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
            <ShotMap shots={homeShots} title={homeTeam} />
          </div>
          <div className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
            <ShotMap shots={awayShots} title={awayTeam} />
          </div>
        </div>
      </section>

      {/* Passing networks */}
      {(homeNetwork || awayNetwork) && (
        <section className="space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Passing networks</h2>
            <p className="text-xs text-slate-400">
              Nodes = players (positioned by average pass location). Edge width = pass volume between pair.
              Yellow node = key connector (highest betweenness centrality heuristic).
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {homeNetwork && (
              <div className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
                <PassingNetworkViz metrics={homeNetwork} title={homeTeam} />
              </div>
            )}
            {awayNetwork && (
              <div className="rounded-xl border border-surface-4/70 bg-surface-2 p-4 shadow-none">
                <PassingNetworkViz metrics={awayNetwork} title={awayTeam} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Tactical fingerprint comparison */}
      {homeNetwork && awayNetwork && (
        <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Tactical fingerprint</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-4/40 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">Metric</th>
                  <th className="py-2 pr-4 text-blue-400">{homeTeam}</th>
                  <th className="py-2 text-orange-500">{awayTeam}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-slate-300">
                <tr>
                  <td className="py-2 pr-4 text-xs text-slate-500">Total passes</td>
                  <td className="py-2 pr-4 font-semibold tabular-nums">{homeNetwork.totalPasses}</td>
                  <td className="py-2 font-semibold tabular-nums">{awayNetwork.totalPasses}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-xs text-slate-500">Centralization</td>
                  <td className="py-2 pr-4 tabular-nums">{Math.round(homeNetwork.centralization * 100)}%</td>
                  <td className="py-2 tabular-nums">{Math.round(awayNetwork.centralization * 100)}%</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-xs text-slate-500">Avg chain length</td>
                  <td className="py-2 pr-4 tabular-nums">{homeNetwork.avgChainLength.toFixed(1)}</td>
                  <td className="py-2 tabular-nums">{awayNetwork.avgChainLength.toFixed(1)}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-xs text-slate-500">Key connector</td>
                  <td className="py-2 pr-4">{homeNetwork.topConnector.split(' ').slice(-1)[0]}</td>
                  <td className="py-2">{awayNetwork.topConnector.split(' ').slice(-1)[0]}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-xs text-slate-500">Dominant passer</td>
                  <td className="py-2 pr-4">{homeNetwork.dominantPasser.split(' ').slice(-1)[0]}</td>
                  <td className="py-2">{awayNetwork.dominantPasser.split(' ').slice(-1)[0]}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
