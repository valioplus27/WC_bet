// ============================================================================
// Calendar — Flashscore-style date browser.
//
// Primary navigation: prev/next day arrows + date-picker jump.
// Matches grouped by stage → group. Click any row → match detail.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react'
import { provider } from '../lib/providers'
import { MatchRow } from '../components/MatchRow'
import { Spinner } from '../components/Spinner'
import { stageLabel } from '../types/models'
import type { Match } from '../lib/providers/types'

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatHeader(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day:     'numeric',
    month:   'long',
    year:    'numeric',
  }).format(new Date(`${dateStr}T12:00:00Z`))
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DayNav({
  date,
  onPrev,
  onNext,
  onToday,
  onDateChange,
}: {
  date: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onDateChange: (d: string) => void
}) {
  const isToday = date === todayUTC()
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous day"
          className="rounded-lg border border-surface-4 bg-surface-2 px-3 py-1.5 text-sm font-medium text-slate-400 hover:border-slate-600 hover:bg-surface-1"
        >
          ←
        </button>
        <div className="flex-1 text-center">
          <p className="text-base font-bold text-slate-100">{formatHeader(date)}</p>
          {!isToday && (
            <button type="button" onClick={onToday} className="text-xs text-pitch-400 hover:underline">
              Today
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next day"
          className="rounded-lg border border-surface-4 bg-surface-2 px-3 py-1.5 text-sm font-medium text-slate-400 hover:border-slate-600 hover:bg-surface-1"
        >
          →
        </button>
      </div>
      <input
        type="date"
        value={date}
        onChange={(e) => { if (e.target.value) onDateChange(e.target.value) }}
        className="block w-full rounded-lg border border-surface-4 bg-surface-2 px-3 py-2 text-sm text-slate-300 focus:border-pitch-500 focus:outline-none focus:ring-1 focus:ring-pitch-500"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Calendar() {
  const [date, setDate]       = useState(todayUTC)
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    const data = await provider.getFixturesByDate(d)
    setMatches(data)
    setLoading(false)
  }, [])

  useEffect(() => { void load(date) }, [date, load])

  // Group by "Stage — Group" label, preserving kickoff order within each group
  const groups = useMemo<Array<[string, Match[]]>>(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      const key = m.groupName
        ? `${stageLabel(m.stage)} — ${m.groupName}`
        : stageLabel(m.stage)
      const list = map.get(key) ?? []
      list.push(m)
      map.set(key, list)
    }
    return [...map.entries()]
  }, [matches])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Match calendar</h1>
        <p className="text-sm text-slate-500">Browse every match day. Click a match for full stats and events.</p>
      </div>

      <DayNav
        date={date}
        onPrev={() => setDate((d) => shiftDate(d, -1))}
        onNext={() => setDate((d) => shiftDate(d, +1))}
        onToday={() => setDate(todayUTC())}
        onDateChange={setDate}
      />

      {loading ? (
        <Spinner label="Loading…" />
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-600 bg-surface-2 px-4 py-12 text-center">
          <p className="text-sm font-semibold text-slate-500">No matches on this date.</p>
          <p className="mt-1 text-xs text-slate-400">
            WC 2026 runs 11 Jun – 19 Jul 2026 (UTC). Use the arrows to navigate to a match day.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([label, groupMatches]) => (
            <section key={label}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {label}
              </p>
              <div className="space-y-2">
                {groupMatches.map((m) => (
                  <MatchRow key={m.id} match={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
