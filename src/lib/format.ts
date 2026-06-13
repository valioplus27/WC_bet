const kickoffFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const fullDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
})

/** Compact "Sat 14 Jun, 18:00" form — used for match lists and brackets. */
export function formatKickoff(iso: string): string {
  return kickoffFormatter.format(new Date(iso))
}

/** Spelled-out "Saturday, 14 June 2026 at 18:00" form — used for lock-time call-outs. */
export function formatDateTime(iso: string): string {
  return fullDateTimeFormatter.format(new Date(iso))
}

/** Shared by match cards, the admin list, and Standings' bracket cards, so "Live"/"Final"/etc. look identical everywhere. */
export function matchStatusBadge(status: string): { label: string; className: string } | null {
  switch (status) {
    case 'FINISHED':
      return { label: 'Final', className: 'bg-slate-100 text-slate-600' }
    case 'IN_PLAY':
      return { label: 'Live', className: 'bg-red-100 text-red-700' }
    case 'PAUSED':
      return { label: 'HT', className: 'bg-amber-100 text-amber-700' }
    case 'POSTPONED':
      return { label: 'Postponed', className: 'bg-amber-100 text-amber-700' }
    case 'SUSPENDED':
      return { label: 'Suspended', className: 'bg-amber-100 text-amber-700' }
    case 'CANCELLED':
      return { label: 'Cancelled', className: 'bg-slate-100 text-slate-400 line-through' }
    default:
      return null
  }
}
