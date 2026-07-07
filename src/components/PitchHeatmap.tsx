// SVG pitch with a heatmap overlay. Coordinates use the StatsBomb system:
// x: 0→120 yards (left goal line → right goal line)
// y: 0→80 yards (bottom touchline → top touchline)
// Pass `events` as flat list of {x, y} positions to visualise activity density.

const SB_W = 120, SB_H = 80
const SVG_W = 420, SVG_H = 280

// Map StatsBomb coords → SVG pixel coords (y is flipped so y=80 is at top)
const sx = (x: number) => (x / SB_W) * SVG_W
const sy = (y: number) => SVG_H - (y / SB_H) * SVG_H

// Grid resolution for the density heatmap
const COLS = 24, ROWS = 16

function heatColor(density: number): string {
  if (density <= 0) return 'transparent'
  const alpha = Math.min(density * 0.85 + 0.1, 0.92)
  const g = Math.round(Math.max(0, 160 - density * 160))
  const b = Math.round(Math.max(0, 60 - density * 60))
  return `rgba(255,${g},${b},${alpha.toFixed(2)})`
}

export function PitchHeatmap({
  events,
  title,
  mirror = false,
}: {
  events: { x: number | null; y: number | null }[]
  title?: string
  mirror?: boolean  // flip x for away team (attacking right→left)
}) {
  // Build density grid
  const grid = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0))
  let maxCount = 0
  for (const e of events) {
    if (e.x == null || e.y == null) continue
    const px = mirror ? SB_W - e.x : e.x
    const col = Math.min(Math.floor((px / SB_W) * COLS), COLS - 1)
    const row = Math.min(Math.floor(((SB_H - e.y) / SB_H) * ROWS), ROWS - 1)
    grid[row][col]++
    if (grid[row][col] > maxCount) maxCount = grid[row][col]
  }

  const cellW = SVG_W / COLS
  const cellH = SVG_H / ROWS

  return (
    <div className="space-y-1">
      {title && <p className="text-xs font-semibold text-slate-600">{title}</p>}
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full rounded-lg overflow-hidden"
        style={{ background: '#2d6a2d' }}
      >
        <PitchLines />
        {maxCount > 0 && grid.map((row, ri) =>
          row.map((count, ci) =>
            count > 0 ? (
              <rect
                key={`${ri}-${ci}`}
                x={ci * cellW}
                y={ri * cellH}
                width={cellW}
                height={cellH}
                fill={heatColor(count / maxCount)}
              />
            ) : null
          )
        )}
        {events.length === 0 && (
          <text x={SVG_W / 2} y={SVG_H / 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={14}>
            No event data
          </text>
        )}
      </svg>
      {events.length > 0 && (
        <p className="text-[10px] text-slate-400 text-right">{events.length} events plotted</p>
      )}
    </div>
  )
}

// Correct StatsBomb pitch markings
// Left 18-yard box: x=[0,18], y=[18,62]   (centered on y=40, 44 yards wide)
// Left 6-yard box:  x=[0,6],  y=[30,50]
// Left penalty spot: (12, 40)
// Centre circle radius: 10 yards
function PitchLines() {
  const s = 'rgba(255,255,255,0.55)'
  const lw = 1

  // Left penalty area
  const lpenX = 0, lpenY = sy(62), lpenW = sx(18), lpenH = sy(18) - sy(62)
  // Left 6-yard box
  const lsixX = 0, lsixY = sy(50), lsixW = sx(6), lsixH = sy(30) - sy(50)
  // Right penalty area (mirror)
  const rpenX = SVG_W - sx(18), rpenY = sy(62), rpenW = sx(18), rpenH = lpenH
  // Right 6-yard box (mirror)
  const rsixX = SVG_W - sx(6), rsixY = sy(50), rsixW = sx(6), rsixH = lsixH
  // Goal lines at x=0 and x=120, y=[36,44]
  const goalTop = sy(44), goalH = sy(36) - sy(44), goalW = sx(2.4)  // ~2m depth

  return (
    <g stroke={s} strokeWidth={lw} fill="none">
      {/* Outer boundary */}
      <rect x={0} y={0} width={SVG_W} height={SVG_H} />
      {/* Halfway line */}
      <line x1={SVG_W / 2} y1={0} x2={SVG_W / 2} y2={SVG_H} />
      {/* Centre circle */}
      <circle cx={SVG_W / 2} cy={SVG_H / 2} r={sx(10)} />
      <circle cx={SVG_W / 2} cy={SVG_H / 2} r={2} fill={s} />
      {/* Left penalty area */}
      <rect x={lpenX} y={lpenY} width={lpenW} height={lpenH} />
      {/* Left 6-yard box */}
      <rect x={lsixX} y={lsixY} width={lsixW} height={lsixH} />
      {/* Left penalty spot */}
      <circle cx={sx(12)} cy={sy(40)} r={2} fill={s} />
      {/* Left goal */}
      <rect x={-goalW} y={goalTop} width={goalW} height={goalH} fill="rgba(255,255,255,0.1)" stroke={s} />
      {/* Right penalty area */}
      <rect x={rpenX} y={rpenY} width={rpenW} height={rpenH} />
      {/* Right 6-yard box */}
      <rect x={rsixX} y={rsixY} width={rsixW} height={rsixH} />
      {/* Right penalty spot */}
      <circle cx={sx(108)} cy={sy(40)} r={2} fill={s} />
      {/* Right goal */}
      <rect x={SVG_W} y={goalTop} width={goalW} height={goalH} fill="rgba(255,255,255,0.1)" stroke={s} />
    </g>
  )
}

// ---------------------------------------------------------------------------
// Pass map: shows average player position + arrows to top recipients
// ---------------------------------------------------------------------------

export function PassMap({
  passes,
  title,
}: {
  passes: { x: number | null; y: number | null; end_x: number | null; end_y: number | null; to_player: string | null }[]
  title?: string
}) {
  // Count passes to each recipient
  const recipientData = new Map<string, { sumEndX: number; sumEndY: number; count: number }>()
  let totalX = 0, totalY = 0, n = 0

  for (const p of passes) {
    if (p.x == null || p.y == null) continue
    totalX += p.x; totalY += p.y; n++
    if (!p.to_player || p.end_x == null || p.end_y == null) continue
    const prev = recipientData.get(p.to_player) ?? { sumEndX: 0, sumEndY: 0, count: 0 }
    recipientData.set(p.to_player, {
      sumEndX: prev.sumEndX + p.end_x,
      sumEndY: prev.sumEndY + p.end_y,
      count: prev.count + 1,
    })
  }

  const avgX = n > 0 ? totalX / n : 60
  const avgY = n > 0 ? totalY / n : 40

  // Top 8 recipients
  const recipients = [...recipientData.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
  const maxCount = recipients[0]?.[1]?.count ?? 1

  return (
    <div className="space-y-1">
      {title && <p className="text-xs font-semibold text-slate-600">{title}</p>}
      <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full rounded-lg overflow-hidden" style={{ background: '#2d6a2d' }}>
        <PitchLines />

        <defs>
          <marker id="arrow-fwd" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#60a5fa" fillOpacity={0.8} />
          </marker>
          <marker id="arrow-bck" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#fb923c" fillOpacity={0.8} />
          </marker>
        </defs>

        {/* Arrows to top recipients */}
        {recipients.map(([, data], i) => {
          const rx = data.sumEndX / data.count
          const ry = data.sumEndY / data.count
          const isFwd = rx > avgX
          const opacity = 0.3 + (data.count / maxCount) * 0.7
          const strokeW = 1 + (data.count / maxCount) * 4
          return (
            <line
              key={i}
              x1={sx(avgX)} y1={sy(avgY)}
              x2={sx(rx)} y2={sy(ry)}
              stroke={isFwd ? '#60a5fa' : '#fb923c'}
              strokeWidth={strokeW}
              strokeOpacity={opacity}
              markerEnd={isFwd ? 'url(#arrow-fwd)' : 'url(#arrow-bck)'}
            />
          )
        })}

        {/* Player average position */}
        <circle cx={sx(avgX)} cy={sy(avgY)} r={9} fill="#fbbf24" stroke="white" strokeWidth={2} />
        <circle cx={sx(avgX)} cy={sy(avgY)} r={3} fill="white" />

        {n === 0 && (
          <text x={SVG_W / 2} y={SVG_H / 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={14}>
            No pass data
          </text>
        )}
      </svg>
      {n > 0 && (
        <div className="flex gap-4 text-[10px] text-slate-400">
          <span>{n} passes</span>
          <span className="text-blue-500">█ forward</span>
          <span className="text-orange-400">█ backward</span>
        </div>
      )}
    </div>
  )
}
