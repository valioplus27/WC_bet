/**
 * ShotMap — football pitch SVG with shot locations.
 *
 * Coordinate system: StatsBomb (origin = bottom-left of attacking half,
 * x = 0-120 along long axis, y = 0-80 along short axis). We draw the
 * ATTACKING half only (x = 60-120) since all shots originate there.
 *
 * Dot size is proportional to xG (sqrt-scaled). Colour = outcome:
 *   Goal    → green   Saved   → blue   Blocked → slate
 *   Off T   → orange  Post    → amber  Wayward → slate-300
 */
import type { Shot } from '../types/models'

const OUTCOME_STYLE: Record<string, { fill: string; stroke: string }> = {
  Goal:    { fill: '#16a34a', stroke: '#15803d' },
  Saved:   { fill: '#3b82f6', stroke: '#2563eb' },
  Blocked: { fill: '#94a3b8', stroke: '#64748b' },
  'Off T': { fill: '#f97316', stroke: '#ea580c' },
  Post:    { fill: '#f59e0b', stroke: '#d97706' },
  Wayward: { fill: '#e2e8f0', stroke: '#cbd5e1' },
}
const DEFAULT_STYLE = { fill: '#cbd5e1', stroke: '#94a3b8' }

function shotStyle(outcome: string) {
  return OUTCOME_STYLE[outcome] ?? DEFAULT_STYLE
}

// Pitch dimensions in SVG pixels for the attacking half
const VIEW_W = 320   // SVG width
const VIEW_H = 220   // SVG height
const PAD    = 12    // inner padding

// StatsBomb attacking half: x in [60, 120], y in [0, 80]
const SB_X_MIN = 60, SB_X_MAX = 120
const SB_Y_MIN = 0,  SB_Y_MAX = 80

function sbToSvg(sbX: number, sbY: number): [number, number] {
  const px = PAD + ((sbX - SB_X_MIN) / (SB_X_MAX - SB_X_MIN)) * (VIEW_W - PAD * 2)
  // Invert Y so origin is bottom-left visually
  const py = PAD + ((SB_Y_MAX - sbY) / (SB_Y_MAX - SB_Y_MIN)) * (VIEW_H - PAD * 2)
  return [px, py]
}

function xgRadius(xg: number | null): number {
  return Math.max(4, Math.min(12, Math.sqrt((xg ?? 0.05) * 120)))
}

// Goal mouth in pitch coordinates
const GOAL_Y_LOW  = 36, GOAL_Y_HIGH = 44
const [goalLx] = sbToSvg(120, GOAL_Y_HIGH)
const [goalRx] = sbToSvg(120, GOAL_Y_LOW)

type Props = {
  shots: Shot[]
  title?: string
}

export function ShotMap({ shots, title }: Props) {
  const [, goalTopY] = sbToSvg(SB_X_MAX, GOAL_Y_HIGH)
  const [, goalBotY] = sbToSvg(SB_X_MAX, GOAL_Y_LOW)
  const [_sixYardX]  = sbToSvg(114, SB_Y_MIN)
  const [_penX]      = sbToSvg(108, SB_Y_MIN)
  const [, _penArcY] = sbToSvg(120, 40)

  // Six-yard box corners
  const [sixTLx, sixTLy] = sbToSvg(114, 62)
  const [sixBRx, sixBRy] = sbToSvg(120, 18)
  // Penalty box corners
  const [penTLx, penTLy] = sbToSvg(102, 68)
  const [penBRx, penBRy] = sbToSvg(120, 12)
  // Penalty spot
  const [pSpotX, pSpotY] = sbToSvg(108, 40)
  // Arc centre
  const [arcCx, arcCy]   = sbToSvg(108, 40)

  const totalXG = shots.reduce((s, sh) => s + (sh.xg ?? 0), 0)
  const goals   = shots.filter((s) => s.outcome === 'Goal').length

  return (
    <div className="space-y-2">
      {title && <p className="text-xs font-semibold text-slate-500">{title}</p>}
      <div className="overflow-x-auto">
        <svg
          width={VIEW_W}
          height={VIEW_H}
          className="rounded-lg"
          style={{ background: '#166534' }}
          role="img"
          aria-label="Shot map"
        >
          {/* Pitch lines */}
          {/* Penalty box */}
          <rect x={penTLx} y={penTLy} width={penBRx - penTLx} height={penBRy - penTLy}
            fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
          {/* Six-yard box */}
          <rect x={sixTLx} y={sixTLy} width={sixBRx - sixTLx} height={sixBRy - sixTLy}
            fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
          {/* Goal line */}
          <line x1={VIEW_W - PAD} y1={PAD} x2={VIEW_W - PAD} y2={VIEW_H - PAD}
            stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
          {/* Goal mouth */}
          <line x1={goalLx} y1={goalTopY} x2={goalRx} y2={goalBotY}
            stroke="white" strokeWidth={3} strokeLinecap="round" />
          {/* Penalty arc (partial circle) */}
          <circle cx={arcCx} cy={arcCy} r={28}
            fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
          {/* Penalty spot */}
          <circle cx={pSpotX} cy={pSpotY} r={2} fill="rgba(255,255,255,0.5)" />
          {/* Left boundary */}
          <line x1={PAD} y1={PAD} x2={PAD} y2={VIEW_H - PAD}
            stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
          {/* Top/bottom boundaries */}
          <line x1={PAD} y1={PAD} x2={VIEW_W - PAD} y2={PAD}
            stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
          <line x1={PAD} y1={VIEW_H - PAD} x2={VIEW_W - PAD} y2={VIEW_H - PAD}
            stroke="rgba(255,255,255,0.4)" strokeWidth={1} />

          {/* Shot dots */}
          {shots.map((sh, i) => {
            const [cx, cy] = sbToSvg(sh.x, sh.y)
            const r = xgRadius(sh.xg)
            const { fill, stroke } = shotStyle(sh.outcome)
            return (
              <circle key={i} cx={cx} cy={cy} r={r}
                fill={fill} stroke={stroke} strokeWidth={1.5} opacity={0.85}>
                <title>{`${sh.player} — ${sh.outcome}${sh.xg != null ? ` (xG ${sh.xg.toFixed(3)})` : ''} min ${sh.minute}`}</title>
              </circle>
            )
          })}
        </svg>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="text-slate-500"><span className="font-semibold text-slate-900">{shots.length}</span> shots</span>
        <span className="text-slate-500"><span className="font-semibold text-pitch-700">{goals}</span> goals</span>
        {totalXG > 0 && (
          <span className="text-slate-500">xG <span className="font-semibold text-slate-900">{totalXG.toFixed(2)}</span></span>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
        {Object.entries(OUTCOME_STYLE).map(([label, { fill }]) => (
          <span key={label} className="flex items-center gap-1">
            <svg width={10} height={10}><circle cx={5} cy={5} r={4} fill={fill} /></svg>
            {label}
          </span>
        ))}
        <span className="text-slate-400">· dot size ∝ xG</span>
      </div>
    </div>
  )
}
