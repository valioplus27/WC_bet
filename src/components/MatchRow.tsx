// Compact match row for the Calendar page.
// Clicking navigates to the match detail page.

import { Link } from 'react-router-dom'
import { formatKickoff } from '../lib/format'
import type { Match } from '../lib/providers/types'

function LiveDot() {
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
}

function StatusChip({ status }: { status: Match['status'] }) {
  switch (status) {
    case 'live':
      return (
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-red-600">
          <LiveDot /> Live
        </span>
      )
    case 'paused':
      return <span className="text-[10px] font-semibold text-amber-600">HT</span>
    case 'finished':
      return <span className="text-[10px] text-slate-400">FT</span>
    case 'postponed':
      return <span className="text-[10px] text-orange-500">PPD</span>
    case 'cancelled':
      return <span className="text-[10px] text-slate-400 line-through">Cancelled</span>
    default:
      return null
  }
}

export function MatchRow({ match }: { match: Match }) {
  const hasScore = match.homeScore !== undefined && match.awayScore !== undefined
  const isLive   = match.status === 'live' || match.status === 'paused'

  return (
    <Link
      to={`/match/${match.id}`}
      className="group grid grid-cols-[1fr_5rem_1fr] items-center gap-2 rounded-lg border border-surface-4/40 bg-surface-2 px-3 py-2.5 shadow-none transition hover:border-pitch-200 hover:shadow"
    >
      {/* Home */}
      <span className="truncate text-right text-sm font-semibold text-slate-100 group-hover:text-pitch-400">
        {match.homeTeam.name}
      </span>

      {/* Score or kick-off time */}
      <div className="flex flex-col items-center text-center">
        {hasScore ? (
          <span className={`text-base font-bold tabular-nums leading-none ${isLive ? 'text-red-400' : 'text-slate-100'}`}>
            {match.homeScore} – {match.awayScore}
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-500">{formatKickoff(match.kickoffAt)}</span>
        )}
        <StatusChip status={match.status} />
      </div>

      {/* Away */}
      <span className="truncate text-sm font-semibold text-slate-100 group-hover:text-pitch-400">
        {match.awayTeam.name}
      </span>
    </Link>
  )
}
