// Shared probability bar: home (blue) | draw (grey) | away (orange).
// Used by MatchDetail and can replace the local ProbBar in Bracket.tsx later.

export function ProbabilityBar({
  homeWin,
  draw,
  awayWin,
  homeLabel,
  awayLabel,
  size = 'md',
}: {
  homeWin: number
  draw: number
  awayWin: number
  homeLabel?: string
  awayLabel?: string
  size?: 'sm' | 'md'
}) {
  const hw = Math.round(homeWin * 100)
  const d  = Math.round(draw * 100)
  const aw = Math.round(awayWin * 100)
  const h  = size === 'sm' ? 'h-1.5' : 'h-2.5'

  return (
    <div className="space-y-1">
      <div className={`flex overflow-hidden rounded-full ${h}`}>
        <div style={{ width: `${hw}%` }} className="bg-blue-950/500" />
        <div style={{ width: `${d}%`  }} className="bg-slate-300" />
        <div style={{ width: `${aw}%` }} className="bg-orange-400" />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-400">
        <span className="font-semibold text-blue-400">{homeLabel ? `${homeLabel} ` : ''}{hw}%</span>
        <span>Draw {d}%</span>
        <span className="font-semibold text-orange-500">{aw}%{awayLabel ? ` ${awayLabel}` : ''}</span>
      </div>
    </div>
  )
}
