import type { MatchStats } from '../types/models'

function PossessionBar({ home, away }: { home: number | null; away: number | null }) {
  if (home === null && away === null) return null
  const h = home ?? 50
  const a = away ?? 50

  return (
    <div className="space-y-0.5">
      <div className="flex h-2 overflow-hidden rounded-full">
        <div style={{ width: `${h}%` }} className="bg-blue-500" />
        <div style={{ width: `${a}%` }} className="bg-orange-400" />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums">
        <span className="font-semibold text-blue-600">{h}%</span>
        <span className="text-slate-400">possession</span>
        <span className="font-semibold text-orange-500">{a}%</span>
      </div>
    </div>
  )
}

function StatRow({
  label,
  homeVal,
  awayVal,
}: {
  label: string
  homeVal: number | null
  awayVal: number | null
}) {
  if (homeVal === null && awayVal === null) return null
  const h = homeVal ?? 0
  const a = awayVal ?? 0
  const total = h + a
  const homePct = total > 0 ? Math.round((h / total) * 100) : 50

  return (
    <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-1.5 text-xs">
      <span className="text-right tabular-nums font-semibold text-blue-600">{homeVal ?? '—'}</span>
      <div className="space-y-0.5">
        <div className="relative h-1 overflow-hidden rounded-full bg-orange-100">
          <div
            style={{ width: `${homePct}%` }}
            className="absolute inset-y-0 left-0 rounded-full bg-blue-400"
          />
        </div>
        <p className="text-center text-[10px] text-slate-400">{label}</p>
      </div>
      <span className="tabular-nums font-semibold text-orange-500">{awayVal ?? '—'}</span>
    </div>
  )
}

export function MatchStatsBar({
  stats,
  homeTeam,
  awayTeam,
}: {
  stats: MatchStats
  homeTeam: string
  awayTeam: string
}) {
  const hasData = [
    stats.home_possession,
    stats.home_shots,
    stats.home_corners,
    stats.home_fouls,
  ].some((v) => v !== null)

  if (!hasData) return null

  const yellowCards =
    stats.home_yellow_cards !== null || stats.away_yellow_cards !== null
      ? `🟨 ${stats.home_yellow_cards ?? '—'} / ${stats.away_yellow_cards ?? '—'}`
      : null
  const redCards =
    stats.home_red_cards !== null || stats.away_red_cards !== null
      ? `🟥 ${stats.home_red_cards ?? '—'} / ${stats.away_red_cards ?? '—'}`
      : null

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wide">
        <span className="max-w-[5rem] truncate text-blue-500">{homeTeam}</span>
        <span className="text-slate-400">Match stats</span>
        <span className="max-w-[5rem] truncate text-right text-orange-400">{awayTeam}</span>
      </div>

      <PossessionBar home={stats.home_possession} away={stats.away_possession} />

      <div className="space-y-2">
        <StatRow label="Shots" homeVal={stats.home_shots} awayVal={stats.away_shots} />
        <StatRow label="On target" homeVal={stats.home_shots_on_target} awayVal={stats.away_shots_on_target} />
        <StatRow label="Corners" homeVal={stats.home_corners} awayVal={stats.away_corners} />
        <StatRow label="Fouls" homeVal={stats.home_fouls} awayVal={stats.away_fouls} />
        <StatRow label="Offsides" homeVal={stats.home_offsides} awayVal={stats.away_offsides} />
      </div>

      {(yellowCards || redCards) && (
        <div className="flex gap-3 text-[10px] text-slate-500">
          {yellowCards && <span>{yellowCards}</span>}
          {redCards && <span>{redCards}</span>}
        </div>
      )}
    </div>
  )
}
