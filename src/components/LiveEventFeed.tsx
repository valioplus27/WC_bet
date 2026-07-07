import type { MatchEventLive } from '../types/models'

function eventIcon(event: MatchEventLive): string {
  if (event.event_type === 'Card') {
    const d = (event.detail ?? '').toLowerCase()
    if (d.includes('red') || d.includes('red card')) return '🟥'
    return '🟨'
  }
  if (event.event_type === 'Goal') return '⚽'
  if (event.event_type === 'subst') return '🔄'
  if (event.event_type === 'Var') return '📺'
  return '•'
}

function minuteLabel(event: MatchEventLive): string {
  if (event.extra_minute) return `${event.minute}+${event.extra_minute}'`
  return `${event.minute}'`
}

function eventLabel(event: MatchEventLive): string {
  const parts: string[] = []
  if (event.player) parts.push(event.player)
  if (event.event_type === 'subst' && event.assist) {
    parts.push(`→ ${event.assist}`)
  } else if (event.event_type === 'Goal' && event.assist) {
    parts.push(`(${event.assist})`)
  }
  if (
    event.event_type === 'Goal' &&
    event.detail &&
    event.detail !== 'Normal Goal'
  ) {
    parts.push(`[${event.detail}]`)
  }
  return parts.join(' ')
}

export function LiveEventFeed({
  events,
  homeTeam,
}: {
  events: MatchEventLive[]
  homeTeam: string
}) {
  if (events.length === 0) return null

  const sorted = [...events].sort((a, b) => {
    const am = a.minute * 100 + (a.extra_minute ?? 0)
    const bm = b.minute * 100 + (b.extra_minute ?? 0)
    return am - bm
  })

  return (
    <div className="mt-3 border-t border-surface-4/40 pt-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Match events
      </p>
      <ul className="space-y-0.5">
        {sorted.map((event) => {
          const isHome = event.team === homeTeam
          return (
            <li key={event.id} className="flex items-baseline gap-1.5 text-xs text-slate-300">
              <span className="w-10 shrink-0 text-right font-mono text-[10px] text-slate-400">
                {minuteLabel(event)}
              </span>
              <span>{eventIcon(event)}</span>
              <span className="flex-1 truncate">{eventLabel(event)}</span>
              <span className={`shrink-0 text-[10px] font-semibold ${isHome ? 'text-blue-400' : 'text-orange-400'}`}>
                {isHome ? '🏠' : '✈️'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
