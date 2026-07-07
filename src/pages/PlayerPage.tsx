// ============================================================================
// PlayerPage — historical StatsBomb analytics for a player.
// Route: /player/:name  (name is URL-encoded)
//
// Data source: WC 2022 StatsBomb open data loaded into match_events + shots.
// This is historical data, not WC 2026 live data.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/Spinner'
import { PitchHeatmap, PassMap } from '../components/PitchHeatmap'
import { buildPlayerNetwork, PlayerNetworkViz } from '../components/PassingNetwork'
import type { MatchEvent as NetworkEvent } from '../types/models'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MatchEvent = {
  id: number
  event_type: string
  team: string
  player: string | null   // needed for buildPlayerNetwork
  x: number | null
  y: number | null
  end_x: number | null
  end_y: number | null
  outcome: string | null
  to_player: string | null
  minute: number
  period: number
}

type Shot = {
  id: number
  team: string
  x: number
  y: number
  xg: number | null
  outcome: string
  body_part: string | null
  is_penalty: boolean
  minute: number
}

// ---------------------------------------------------------------------------
// Half-pitch shot map
// ---------------------------------------------------------------------------

const HALF_W = 420, HALF_H = 280
const SB_H = 80

function hxs(x: number) { return ((x - 60) / 60) * HALF_W }
function hys(y: number) { return HALF_H - (y / SB_H) * HALF_H }

function ShotCloud({ shots }: { shots: Shot[] }) {
  const goals = shots.filter((s) => s.outcome === 'Goal')
  const saved = shots.filter((s) => s.outcome === 'Saved' || s.outcome === 'Saved To Post')
  const missed = shots.filter((s) => !['Goal', 'Saved', 'Saved To Post'].includes(s.outcome))

  const totalXg = shots.reduce((sum, s) => sum + (s.xg ?? 0), 0)

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-slate-400">Shot map</p>
      <svg
        viewBox={`0 0 ${HALF_W} ${HALF_H}`}
        className="w-full rounded-lg overflow-hidden"
        style={{ background: '#2d6a2d' }}
      >
        {/* Half-pitch lines */}
        <HalfPitchLines />

        {/* Missed / blocked shots */}
        {missed.map((s) => (
          <circle
            key={s.id}
            cx={hxs(s.x)}
            cy={hys(s.y)}
            r={Math.max(4, Math.min(12, (s.xg ?? 0.05) * 60))}
            fill="rgba(156,163,175,0.7)"
            stroke="white"
            strokeWidth={0.5}
          />
        ))}
        {/* Saved shots */}
        {saved.map((s) => (
          <circle
            key={s.id}
            cx={hxs(s.x)}
            cy={hys(s.y)}
            r={Math.max(4, Math.min(12, (s.xg ?? 0.05) * 60))}
            fill="rgba(251,146,60,0.85)"
            stroke="white"
            strokeWidth={0.5}
          />
        ))}
        {/* Goals */}
        {goals.map((s) => (
          <circle
            key={s.id}
            cx={hxs(s.x)}
            cy={hys(s.y)}
            r={Math.max(5, Math.min(14, (s.xg ?? 0.1) * 60))}
            fill="rgba(34,197,94,0.9)"
            stroke="white"
            strokeWidth={1}
          />
        ))}

        {shots.length === 0 && (
          <text
            x={HALF_W / 2}
            y={HALF_H / 2}
            textAnchor="middle"
            fill="rgba(255,255,255,0.5)"
            fontSize={14}
          >
            No shots found
          </text>
        )}

        {/* Legend */}
        {shots.length > 0 && (
          <>
            <circle cx={12} cy={HALF_H - 40} r={5} fill="rgba(34,197,94,0.9)" />
            <text x={21} y={HALF_H - 36} fill="white" fontSize={10}>Goal ({goals.length})</text>
            <circle cx={12} cy={HALF_H - 26} r={5} fill="rgba(251,146,60,0.85)" />
            <text x={21} y={HALF_H - 22} fill="white" fontSize={10}>Saved ({saved.length})</text>
            <circle cx={12} cy={HALF_H - 12} r={5} fill="rgba(156,163,175,0.7)" />
            <text x={21} y={HALF_H - 8} fill="white" fontSize={10}>Missed ({missed.length})</text>
          </>
        )}
      </svg>
      {shots.length > 0 && (
        <div className="flex gap-4 text-xs text-slate-500">
          <span><span className="font-semibold text-slate-100">{shots.length}</span> shots</span>
          <span><span className="font-semibold text-slate-100">{goals.length}</span> goals</span>
          <span>xG <span className="font-semibold text-slate-100">{totalXg.toFixed(2)}</span></span>
          <span>xG/shot <span className="font-semibold text-slate-100">{shots.length > 0 ? (totalXg / shots.length).toFixed(3) : '—'}</span></span>
        </div>
      )}
    </div>
  )
}

function HalfPitchLines() {
  const s = 'rgba(255,255,255,0.5)'
  const lw = 1
  // Penalty area: x=[102,120], y=[18,62]
  const penW = hxs(120) - hxs(102)
  const penTop = hys(62), penH = hys(18) - hys(62)
  // Six-yard box: x=[114,120], y=[30,50]
  const sixW = hxs(120) - hxs(114)
  const sixTop = hys(50), sixH = hys(30) - hys(50)
  // Goal: x=120, y=[36,44]
  const goalTop = hys(44), goalH = hys(36) - hys(44)
  // Penalty arc — circle around penalty spot that extends outside penalty area
  const penSpotX = hxs(108), penSpotY = hys(40)
  const arcR = ((10 / 60) * HALF_W) // 10 yards radius

  return (
    <g stroke={s} strokeWidth={lw} fill="none">
      {/* Left boundary (halfway line) */}
      <line x1={0} y1={0} x2={0} y2={HALF_H} />
      {/* Top & bottom touchlines */}
      <line x1={0} y1={0} x2={HALF_W} y2={0} />
      <line x1={0} y1={HALF_H} x2={HALF_W} y2={HALF_H} />
      {/* Goal line */}
      <line x1={HALF_W} y1={0} x2={HALF_W} y2={HALF_H} />
      {/* Penalty area */}
      <rect x={HALF_W - penW} y={penTop} width={penW} height={penH} />
      {/* Six-yard box */}
      <rect x={HALF_W - sixW} y={sixTop} width={sixW} height={sixH} />
      {/* Goal (behind goal line) */}
      <rect x={HALF_W} y={goalTop} width={8} height={goalH} />
      {/* Penalty spot */}
      <circle cx={penSpotX} cy={penSpotY} r={2} fill={s} />
      {/* Penalty arc (partial circle) */}
      <circle
        cx={penSpotX}
        cy={penSpotY}
        r={arcR}
        strokeDasharray={`${Math.PI * arcR * 0.5} ${Math.PI * arcR * 2}`}
        strokeDashoffset={Math.PI * arcR * 0.25}
      />
    </g>
  )
}

// ---------------------------------------------------------------------------
// Stat chip
// ---------------------------------------------------------------------------

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-surface-4/40 bg-surface-1 px-3 py-2 text-center">
      <p className="text-base font-bold tabular-nums text-slate-100">{value}</p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlayerPage() {
  const { name } = useParams<{ name: string }>()
  const playerName = decodeURIComponent(name ?? '')

  const [events, setEvents] = useState<MatchEvent[]>([])
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!playerName) return
    setLoading(true)

    Promise.all([
      supabase
        .from('match_events')
        .select('id,event_type,team,player,x,y,end_x,end_y,outcome,to_player,minute,period')
        .eq('player', playerName)
        .eq('source', 'statsbomb')
        .limit(5000),
      supabase
        .from('shots')
        .select('id,team,x,y,xg,outcome,body_part,is_penalty,minute')
        .eq('player', playerName)
        .eq('source', 'statsbomb'),
    ]).then(([evRes, shRes]) => {
      setEvents((evRes.data ?? []) as MatchEvent[])
      setShots((shRes.data ?? []) as Shot[])
      setLoading(false)
    })
  }, [playerName])

  const stats = useMemo(() => {
    const passes = events.filter((e) => e.event_type === 'Pass')
    const completePasses = passes.filter((e) => e.outcome == null || e.outcome === 'Complete')
    const pressures = events.filter((e) => e.event_type === 'Pressure')
    const carries = events.filter((e) => e.event_type === 'Carry')
    const dribbles = events.filter((e) => e.event_type === 'Dribble')
    const dribbleSuccess = dribbles.filter((e) => e.outcome === 'Complete')
    const goals = shots.filter((s) => s.outcome === 'Goal')
    const totalXg = shots.reduce((sum, s) => sum + (s.xg ?? 0), 0)
    const teamSet = new Set(events.map((e) => e.team).filter(Boolean))
    const team = teamSet.size === 1 ? [...teamSet][0] : teamSet.size > 1 ? [...teamSet].join(' / ') : null
    const matchSet = new Set(events.map((e) => e.period + ':' + Math.floor(e.minute / 45)))
    return {
      passes: passes.length,
      passCompletion: passes.length > 0 ? Math.round((completePasses.length / passes.length) * 100) : null,
      pressures: pressures.length,
      carries: carries.length,
      dribbles: dribbles.length,
      dribbleSuccess: dribbles.length > 0 ? Math.round((dribbleSuccess.length / dribbles.length) * 100) : null,
      goals: goals.length,
      totalXg,
      total: events.length,
      team,
      matchCount: matchSet.size,
    }
  }, [events, shots])

  const allPositions = useMemo(() => events.map((e) => ({ x: e.x, y: e.y })), [events])
  const passMoves = useMemo(
    () =>
      events
        .filter((e) => e.event_type === 'Pass')
        .map((e) => ({ x: e.x, y: e.y, end_x: e.end_x, end_y: e.end_y, to_player: e.to_player })),
    [events],
  )
  const playerNetwork = useMemo(
    () => buildPlayerNetwork(events as NetworkEvent[], playerName),
    [events, playerName],
  )
  // Heatmap by event type for richer context
  const pressurePositions = useMemo(
    () => events.filter((e) => e.event_type === 'Pressure').map((e) => ({ x: e.x, y: e.y })),
    [events],
  )

  const hasData = events.length > 0 || shots.length > 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/standings" className="text-xs text-pitch-600 hover:underline">← Standings</Link>
        <div className="mt-2">
          <h1 className="text-2xl font-black text-slate-100">{playerName || 'Player'}</h1>
          {stats.team && <p className="mt-0.5 text-sm text-slate-500">{stats.team}</p>}
        </div>
        <p className="mt-1 rounded-md bg-amber-950/50 px-3 py-1.5 text-xs text-amber-400 border border-amber-800 inline-block">
          StatsBomb open data · WC 2022 historical — not WC 2026 live data
        </p>
      </div>

      {loading ? (
        <Spinner label="Loading analytics…" />
      ) : !hasData ? (
        <div className="rounded-xl border border-dashed border-slate-600 bg-surface-2 px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-300">No data found for "{playerName}"</p>
          <p className="mt-1 text-xs text-slate-400">
            StatsBomb open data covers select WC 2022 matches. Try a different spelling.
          </p>
          <Link to="/standings" className="mt-4 inline-block text-xs text-pitch-600 hover:underline">
            ← Back to standings
          </Link>
        </div>
      ) : (
        <>
          {/* Key stats */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-100">
              Summary
              {stats.matchCount > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-400">
                  across approx. {stats.matchCount} match{stats.matchCount === 1 ? '' : 'es'}
                </span>
              )}
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <StatChip label="Events" value={stats.total} />
              <StatChip label="Passes" value={stats.passes} />
              <StatChip label="Pass %" value={stats.passCompletion != null ? `${stats.passCompletion}%` : '—'} />
              <StatChip label="Pressures" value={stats.pressures} />
              <StatChip label="Goals" value={stats.goals} />
              <StatChip label="xG" value={stats.totalXg.toFixed(2)} />
            </div>
          </section>

          {/* Position heatmap */}
          {allPositions.length > 0 && (
            <section className="rounded-xl border border-surface-4 bg-surface-2 p-5 shadow-none">
              <h2 className="mb-3 text-sm font-semibold text-slate-100">Position heatmap</h2>
              <p className="mb-3 text-xs text-slate-400">
                All {allPositions.length} events plotted on pitch. Darker red = higher activity zone. Attacking left→right.
              </p>
              <PitchHeatmap events={allPositions} />
            </section>
          )}

          {/* Passing network (ego) */}
          {playerNetwork && (
            <section className="rounded-xl border border-surface-4 bg-surface-2 p-5 shadow-none">
              <h2 className="mb-3 text-sm font-semibold text-slate-100">Passing network</h2>
              <p className="mb-3 text-xs text-slate-400">
                Who {playerName.split(' ').pop()} exchanged passes with. Yellow = the player. Blue lines = sent, orange = received. Thickness = frequency.
              </p>
              <PlayerNetworkViz metrics={playerNetwork} player={playerName} />
            </section>
          )}

          {/* Pass map */}
          {passMoves.length > 0 && (
            <section className="rounded-xl border border-surface-4 bg-surface-2 p-5 shadow-none">
              <h2 className="mb-3 text-sm font-semibold text-slate-100">Pass map</h2>
              <p className="mb-3 text-xs text-slate-400">
                Yellow dot = average position. Blue arrows = forward passes; orange = backward. Thickness = frequency.
              </p>
              <PassMap passes={passMoves} />
            </section>
          )}

          {/* Pressure heatmap (defenders/midfielders) */}
          {pressurePositions.length > 20 && (
            <section className="rounded-xl border border-surface-4 bg-surface-2 p-5 shadow-none">
              <h2 className="mb-3 text-sm font-semibold text-slate-100">Pressing heatmap</h2>
              <p className="mb-3 text-xs text-slate-400">
                Where {playerName.split(' ').pop()} applied pressure on the ball — darker red = higher pressing zone.
              </p>
              <PitchHeatmap events={pressurePositions} />
            </section>
          )}

          {/* Shot map */}
          {shots.length > 0 && (
            <section className="rounded-xl border border-surface-4 bg-surface-2 p-5 shadow-none">
              <h2 className="mb-3 text-sm font-semibold text-slate-100">Shot locations</h2>
              <p className="mb-3 text-xs text-slate-400">
                Shown from shooting perspective. Circle size = xG.
              </p>
              <ShotCloud shots={shots} />
            </section>
          )}

          {/* Event breakdown */}
          <section className="rounded-xl border border-surface-4 bg-surface-2 p-5 shadow-none">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">Event breakdown</h2>
            <EventBreakdown events={events} shots={shots} />
          </section>
        </>
      )}
    </div>
  )
}

function EventBreakdown({ events, shots }: { events: MatchEvent[]; shots: Shot[] }) {
  const countByType = new Map<string, number>()
  for (const e of events) {
    countByType.set(e.event_type, (countByType.get(e.event_type) ?? 0) + 1)
  }

  // Add shots from shots table (they're already in match_events too but with xG)
  const entries = [...countByType.entries()].sort((a, b) => b[1] - a[1])
  const max = entries[0]?.[1] ?? 1

  return (
    <div className="space-y-1.5">
      {entries.map(([type, count]) => (
        <div key={type} className="flex items-center gap-3 text-xs">
          <span className="w-36 shrink-0 truncate text-slate-400">{type}</span>
          <div className="flex-1 overflow-hidden rounded-full bg-surface-3 h-1.5">
            <div
              className="h-1.5 rounded-full bg-pitch-600/100"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums font-semibold text-slate-300">{count}</span>
        </div>
      ))}
      {shots.length > 0 && (
        <p className="mt-2 text-[10px] text-slate-400">
          Shots table: {shots.length} total, {shots.filter((s) => s.outcome === 'Goal').length} goals, xG {shots.reduce((s, sh) => s + (sh.xg ?? 0), 0).toFixed(2)}
        </p>
      )}
    </div>
  )
}
