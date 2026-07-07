/**
 * PassingNetwork — graph-native tactical analysis component.
 *
 * Reads from public.match_events (Pass rows) and computes:
 *   • A weighted adjacency matrix (passer → receiver, weight = pass count)
 *   • Node betweenness centrality (simplified: degree × volume heuristic)
 *   • Network centralization index
 *   • A "tactical fingerprint" summary: dominant passer, key connector, avg chain length
 *
 * Renders nodes positioned by average pass origin (x, y), with edges drawn
 * proportionally to pass volume. High-centrality nodes are highlighted.
 *
 * This uses StatsBomb open-data (WC 2022 historical), not live 2026 data.
 */
import type { MatchEvent } from '../types/models'

// ---------------------------------------------------------------------------
// Maths / graph metrics
// ---------------------------------------------------------------------------

type Node = {
  id: string           // player name
  avgX: number         // average pass-origin x (StatsBomb coords)
  avgY: number         // average pass-origin y
  totalPasses: number
  centrality: number   // normalized 0-1
}

type Edge = {
  from: string
  to: string
  count: number
  weight: number  // normalized 0-1
}

export type NetworkMetrics = {
  nodes: Node[]
  edges: Edge[]
  centralization: number    // 0 = perfectly distributed, 1 = star topology
  avgChainLength: number    // avg passes before a non-pass event
  topConnector: string      // player with highest betweenness (degree heuristic)
  dominantPasser: string    // player with most passes
  totalPasses: number
}

/**
 * Build a player-centric "ego" network — only edges where the player
 * is the sender OR receiver. Lets you see exactly who a player combines
 * with and from whom they receive. Needs ≥3 touches to render.
 */
export function buildPlayerNetwork(events: MatchEvent[], player: string): NetworkMetrics | null {
  const relevant = events.filter(
    (e) => e.event_type === 'Pass' && e.player && e.to_player &&
           (e.player === player || e.to_player === player),
  )
  if (relevant.length < 3) return null

  const nodeMap = new Map<string, { xs: number[]; ys: number[]; sent: number }>()
  const edgeMap = new Map<string, number>()

  for (const e of relevant) {
    const from = e.player!
    const to   = e.to_player!
    const x    = e.x ?? 60
    const y    = e.y ?? 40

    const n = nodeMap.get(from) ?? { xs: [], ys: [], sent: 0 }
    n.xs.push(x); n.ys.push(y); n.sent++
    nodeMap.set(from, n)

    if (!nodeMap.has(to)) {
      nodeMap.set(to, { xs: [e.end_x ?? x + 5], ys: [e.end_y ?? y], sent: 0 })
    }
    edgeMap.set(`${from}→${to}`, (edgeMap.get(`${from}→${to}`) ?? 0) + 1)
  }

  const maxSent = Math.max(...[...nodeMap.values()].map((n) => n.sent), 1)
  const nodes: Node[] = [...nodeMap.entries()].map(([id, n]) => ({
    id,
    avgX: n.xs.reduce((s, v) => s + v, 0) / n.xs.length,
    avgY: n.ys.reduce((s, v) => s + v, 0) / n.ys.length,
    totalPasses: n.sent,
    centrality: id === player ? 1 : n.sent / maxSent,
  }))

  const maxEdge = Math.max(...[...edgeMap.values()], 1)
  const edges: Edge[] = [...edgeMap.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('→')
      return { from, to, count, weight: count / maxEdge }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const sent     = relevant.filter((e) => e.player === player).length
  const received = relevant.filter((e) => e.to_player === player).length

  const partnerCounts = new Map<string, number>()
  for (const e of edges) {
    if (e.from === player) partnerCounts.set(e.to, (partnerCounts.get(e.to) ?? 0) + e.count)
    if (e.to === player)   partnerCounts.set(e.from, (partnerCounts.get(e.from) ?? 0) + e.count)
  }
  const topConnector = [...partnerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  return {
    nodes,
    edges,
    centralization: received > 0 ? sent / received : 1,
    avgChainLength: sent + received,
    topConnector,
    dominantPasser: player,
    totalPasses: sent + received,
  }
}

/** Build a passing network from a flat list of Pass events for ONE team. */
export function buildNetwork(events: MatchEvent[], team: string): NetworkMetrics | null {
  const teamPasses = events.filter((e) => e.event_type === 'Pass' && e.team === team && e.player && e.to_player)
  if (teamPasses.length < 5) return null

  // Node accumulation
  const nodeMap = new Map<string, { xs: number[]; ys: number[]; sent: number }>()
  // Edge accumulation
  const edgeMap = new Map<string, number>()

  for (const e of teamPasses) {
    const from = e.player!
    const to   = e.to_player!
    const x    = e.x ?? 60
    const y    = e.y ?? 40

    const node = nodeMap.get(from) ?? { xs: [], ys: [], sent: 0 }
    node.xs.push(x); node.ys.push(y); node.sent++
    nodeMap.set(from, node)

    const key = `${from}→${to}`
    edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1)
  }

  const maxPasses = Math.max(...[...nodeMap.values()].map((n) => n.sent), 1)
  const nodes: Node[] = [...nodeMap.entries()].map(([id, n]) => ({
    id,
    avgX: n.xs.reduce((s, v) => s + v, 0) / n.xs.length,
    avgY: n.ys.reduce((s, v) => s + v, 0) / n.ys.length,
    totalPasses: n.sent,
    centrality: n.sent / maxPasses,
  }))

  const maxEdge = Math.max(...[...edgeMap.values()], 1)
  const edges: Edge[] = [...edgeMap.entries()]
    .filter(([, count]) => count >= 3)
    .map(([key, count]) => {
      const [from, to] = key.split('→')
      return { from, to, count, weight: count / maxEdge }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  // Centralization: variance of degree distribution (0=flat, 1=concentrated)
  const degrees = nodes.map((n) => n.centrality)
  const mean = degrees.reduce((s, d) => s + d, 0) / degrees.length
  const variance = degrees.reduce((s, d) => s + (d - mean) ** 2, 0) / degrees.length
  const centralization = Math.min(Math.sqrt(variance) * 4, 1)

  // Average chain length: passes per possession sequence (heuristic)
  const avgChainLength = teamPasses.length / Math.max(edges.length, 1) * 0.6

  const dominantPasser = nodes.sort((a, b) => b.totalPasses - a.totalPasses)[0]?.id ?? '—'

  // Betweenness heuristic: players that appear in many edges (as from OR to)
  const betweenness = new Map<string, number>()
  for (const e of edges) {
    betweenness.set(e.from, (betweenness.get(e.from) ?? 0) + e.count)
    betweenness.set(e.to, (betweenness.get(e.to) ?? 0) + e.count)
  }
  const topConnector = [...betweenness.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  return {
    nodes,
    edges,
    centralization,
    avgChainLength,
    topConnector,
    dominantPasser,
    totalPasses: teamPasses.length,
  }
}

// ---------------------------------------------------------------------------
// SVG visualization
// ---------------------------------------------------------------------------

const PITCH_W = 320
const PITCH_H = 200
const PAD = 20

function sbToSvgPitch(sbX: number, sbY: number): [number, number] {
  const px = PAD + (sbX / 120) * (PITCH_W - PAD * 2)
  const py = PAD + ((80 - sbY) / 80) * (PITCH_H - PAD * 2)
  return [px, py]
}

type Props = {
  metrics: NetworkMetrics
  title?: string
}

export function PassingNetworkViz({ metrics, title }: Props) {
  const { nodes, edges, centralization, avgChainLength, topConnector, dominantPasser, totalPasses } = metrics

  const nodeByName = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div className="space-y-3">
      {title && <p className="text-xs font-semibold text-slate-500">{title}</p>}

      {/* Network SVG */}
      <div className="overflow-x-auto">
        <svg
          width={PITCH_W}
          height={PITCH_H}
          className="rounded-lg"
          style={{ background: '#166534' }}
          role="img"
          aria-label="Passing network"
        >
          {/* Pitch outline */}
          <rect x={PAD} y={PAD} width={PITCH_W - PAD * 2} height={PITCH_H - PAD * 2}
            fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          {/* Centre line */}
          <line x1={PITCH_W / 2} y1={PAD} x2={PITCH_W / 2} y2={PITCH_H - PAD}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          {/* Centre circle */}
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={30}
            fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

          {/* Edges (pass connections) */}
          {edges.map((e, i) => {
            const from = nodeByName.get(e.from)
            const to   = nodeByName.get(e.to)
            if (!from || !to) return null
            const [fx, fy] = sbToSvgPitch(from.avgX, from.avgY)
            const [tx, ty] = sbToSvgPitch(to.avgX, to.avgY)
            return (
              <line key={i} x1={fx} y1={fy} x2={tx} y2={ty}
                stroke="rgba(255,255,255,0.6)"
                strokeWidth={Math.max(1, e.weight * 6)}
                opacity={0.4 + e.weight * 0.5}>
                <title>{`${e.from} → ${e.to}: ${e.count} passes`}</title>
              </line>
            )
          })}

          {/* Nodes (players) */}
          {nodes.map((n) => {
            const [cx, cy] = sbToSvgPitch(n.avgX, n.avgY)
            const r = Math.max(5, Math.min(14, n.centrality * 14))
            const isConnector = n.id === topConnector
            return (
              <g key={n.id}>
                <circle cx={cx} cy={cy} r={r}
                  fill={isConnector ? '#f59e0b' : '#3b82f6'}
                  stroke="white" strokeWidth={1.5} opacity={0.9}>
                  <title>{`${n.id}: ${n.totalPasses} passes`}</title>
                </circle>
                {/* Show short name for high-centrality nodes */}
                {n.centrality > 0.4 && (
                  <text cx={cx} cy={cy + r + 8} textAnchor="middle"
                    fontSize={7} fill="white" opacity={0.9}>
                    {n.id.split(' ').pop()}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total passes" value={String(totalPasses)} />
        <Metric label="Centralization" value={`${Math.round(centralization * 100)}%`}
          note="100% = all through one player" />
        <Metric label="Avg chain length" value={avgChainLength.toFixed(1)} note="passes per sequence" />
        <Metric label="Key connector" value={topConnector.split(' ').pop() ?? topConnector} note="highest betweenness" />
      </div>

      <p className="text-[10px] text-slate-400">
        Dominant passer: {dominantPasser} · Node size = pass volume · Yellow = key connector · Edge weight = pass count
      </p>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-center">
      <p className="text-base font-bold text-slate-900">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      {note && <p className="mt-0.5 text-[9px] text-slate-300">{note}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Player-centric ego-network visualization
// ---------------------------------------------------------------------------

type PlayerNetworkProps = {
  metrics: NetworkMetrics
  player: string
}

export function PlayerNetworkViz({ metrics, player }: PlayerNetworkProps) {
  const { nodes, edges, topConnector, totalPasses } = metrics
  const nodeByName = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <svg
          width={PITCH_W}
          height={PITCH_H}
          className="rounded-lg"
          style={{ background: '#166534' }}
          role="img"
          aria-label={`Passing network for ${player}`}
        >
          <rect x={PAD} y={PAD} width={PITCH_W - PAD * 2} height={PITCH_H - PAD * 2}
            fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          <line x1={PITCH_W / 2} y1={PAD} x2={PITCH_W / 2} y2={PITCH_H - PAD}
            stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={30}
            fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

          {edges.map((e, i) => {
            const from = nodeByName.get(e.from)
            const to   = nodeByName.get(e.to)
            if (!from || !to) return null
            const [fx, fy] = sbToSvgPitch(from.avgX, from.avgY)
            const [tx, ty] = sbToSvgPitch(to.avgX, to.avgY)
            const isOut = e.from === player
            return (
              <line key={i} x1={fx} y1={fy} x2={tx} y2={ty}
                stroke={isOut ? 'rgba(96,165,250,0.8)' : 'rgba(251,146,60,0.8)'}
                strokeWidth={Math.max(1, e.weight * 5)}
                opacity={0.4 + e.weight * 0.5}>
                <title>{`${e.from} → ${e.to}: ${e.count} passes`}</title>
              </line>
            )
          })}

          {nodes.map((n) => {
            const [cx, cy] = sbToSvgPitch(n.avgX, n.avgY)
            const isPlayer = n.id === player
            const r = isPlayer ? 10 : Math.max(4, Math.min(9, n.centrality * 9))
            return (
              <g key={n.id}>
                <circle cx={cx} cy={cy} r={r}
                  fill={isPlayer ? '#f59e0b' : '#3b82f6'}
                  stroke="white" strokeWidth={isPlayer ? 2 : 1}
                  opacity={0.9}>
                  <title>{`${n.id}: ${n.totalPasses} passes sent`}</title>
                </circle>
                {(isPlayer || n.centrality > 0.3) && (
                  <text x={cx} y={cy + r + 8} textAnchor="middle"
                    fontSize={7} fill="white" opacity={0.9}>
                    {n.id.split(' ').pop()}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Metric label="Passes sent" value={String(totalPasses)} />
        <Metric label="Top combination" value={topConnector.split(' ').pop() ?? topConnector}
          note="most exchanges" />
        <Metric label="Partners" value={String(Math.max(0, nodes.length - 1))} />
      </div>
      <p className="text-[10px] text-slate-400">
        Yellow = {player.split(' ').pop()}. Blue lines = passes sent · Orange lines = passes received · Thickness = frequency.
      </p>
    </div>
  )
}
