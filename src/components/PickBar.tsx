export const EMOJIS = ['😮', '🎯', '💥', '🙈', '🔥'] as const

export function PickBar({
  homePct,
  drawPct,
  awayPct,
  className = '',
}: {
  homePct: number
  drawPct: number
  awayPct: number
  className?: string
}) {
  return (
    <div className={`flex h-5 overflow-hidden rounded-full text-[10px] font-bold text-white ${className}`}>
      {homePct > 0 && (
        <div style={{ width: `${homePct}%` }} className="flex items-center justify-center bg-blue-950/500 transition-all">
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
