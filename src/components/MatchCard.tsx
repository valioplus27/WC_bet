import { useId, useState, type FormEvent } from 'react'
import type { Bet, Match } from '../types/models'
import { isLocked, stageLabel } from '../types/models'
import { formatKickoff, matchStatusBadge } from '../lib/format'

function statusBadge(match: Match, locked: boolean): { label: string; className: string } | null {
  return matchStatusBadge(match.status) ?? (locked ? { label: 'Awaiting kickoff sync', className: 'bg-slate-100 text-slate-500' } : null)
}

/** Two-digit score box — also reused by the admin's manual result-override form. */
export function ScoreInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  ariaLabel: string
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={99}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => {
        const next = event.target.value
        if (next === '' || /^\d{0,2}$/.test(next)) onChange(next)
      }}
      placeholder="–"
      className="h-10 w-12 rounded-md border border-slate-300 text-center text-lg font-semibold tabular-nums shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
    />
  )
}

function PointsPill({ points }: { points: number }) {
  const className =
    points >= 3 ? 'bg-pitch-50 text-pitch-700' : points >= 1 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>+{points} pt{points === 1 ? '' : 's'}</span>
}

function BetSummary({ bet, match }: { bet: Bet | null; match: Match }) {
  if (!bet) {
    return <p className="text-xs text-slate-400">You didn't place a prediction before this one locked.</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span>
        Your prediction:{' '}
        <span className="font-semibold tabular-nums text-slate-900">
          {bet.predicted_home}–{bet.predicted_away}
        </span>
      </span>
      {bet.points_awarded !== null ? (
        <PointsPill points={bet.points_awarded} />
      ) : match.status === 'FINISHED' ? null : (
        <span className="text-slate-400">Points pending final result</span>
      )}
    </div>
  )
}

type Props = {
  match: Match
  myBet: Bet | null
  onSave: (matchId: number, predictedHome: number, predictedAway: number) => Promise<string | null>
}

export function MatchCard({ match, myBet, onSave }: Props) {
  const formId = useId()
  const locked = isLocked(match.kickoff_at)
  const [home, setHome] = useState(myBet ? String(myBet.predicted_home) : '')
  const [away, setAway] = useState(myBet ? String(myBet.predicted_away) : '')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  const badge = statusBadge(match, locked)
  const hasResult = match.home_score !== null && match.away_score !== null
  const canSubmit = home !== '' && away !== '' && !saving

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setFeedback(null)
    const errorMessage = await onSave(match.id, Number(home), Number(away))
    setSaving(false)
    setFeedback(
      errorMessage ? { kind: 'error', message: errorMessage } : { kind: 'ok', message: 'Prediction saved ✓' },
    )
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {stageLabel(match.stage)}
          {match.group_name ? ` · ${match.group_name}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {badge && <span className={`rounded-full px-2 py-0.5 font-medium ${badge.className}`}>{badge.label}</span>}
          <time dateTime={match.kickoff_at}>{formatKickoff(match.kickoff_at)}</time>
        </div>
      </header>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="truncate text-right text-sm font-semibold text-slate-900 sm:text-base">{match.home_team}</p>

        {hasResult ? (
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-lg font-bold tabular-nums text-slate-900">
            <span>{match.home_score}</span>
            <span className="text-slate-400">–</span>
            <span>{match.away_score}</span>
          </div>
        ) : locked ? (
          <div className="rounded-lg bg-slate-50 px-4 py-1.5 text-sm text-slate-400">vs</div>
        ) : (
          <form id={formId} onSubmit={handleSubmit} className="flex items-center gap-1.5">
            <ScoreInput value={home} onChange={setHome} ariaLabel={`${match.home_team} predicted score`} />
            <span className="text-slate-400">–</span>
            <ScoreInput value={away} onChange={setAway} ariaLabel={`${match.away_team} predicted score`} />
          </form>
        )}

        <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{match.away_team}</p>
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        {locked ? (
          <BetSummary bet={myBet} match={match} />
        ) : (
          <>
            <p className="text-xs text-slate-400">Locks at kickoff, shown above — no edits after that.</p>
            <button
              type="submit"
              form={formId}
              disabled={!canSubmit}
              className="rounded-md bg-pitch-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : myBet ? 'Update prediction' : 'Save prediction'}
            </button>
          </>
        )}
      </footer>

      {feedback && (
        <p className={`mt-2 text-xs ${feedback.kind === 'error' ? 'text-red-600' : 'text-pitch-700'}`} role="status">
          {feedback.message}
        </p>
      )}
    </article>
  )
}
