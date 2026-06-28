/**
 * MatchPreview — shown inside upcoming match cards.
 *
 * Displays:
 *   • Each team's recent WC form (last 5 results as coloured badges)
 *   • Group standing position and stats (group stage matches)
 *   • Any previous WC meeting between the same two teams (knockout re-matches)
 *
 * All data comes from the matches/standings already loaded in Schedule — zero
 * extra network requests.
 */
import type { Match, Standing } from '../types/models'
import { stageLabel } from '../types/models'
import { formatKickoff } from '../lib/format'

export type FormResult = {
  opponent: string
  isHome: boolean
  goalsFor: number
  goalsAgainst: number
  result: 'W' | 'D' | 'L'
  kickoff_at: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESULT_STYLES = {
  W: 'bg-pitch-500 text-white',
  D: 'bg-slate-400 text-white',
  L: 'bg-red-400 text-white',
} as const

function FormBadge({ r, title }: { r: FormResult; title: string }) {
  return (
    <abbr
      title={title}
      className={`inline-flex h-6 w-6 cursor-default select-none items-center justify-center rounded-full text-[10px] font-bold no-underline ${RESULT_STYLES[r.result]}`}
    >
      {r.result}
    </abbr>
  )
}

function StandingRow({ s }: { s: Standing }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
      <span className="font-bold tabular-nums text-slate-900">{s.position}</span>
      <span className="truncate">{s.group_name}</span>
      <span className="ml-auto flex gap-2 tabular-nums text-slate-400">
        <span title="Points" className="font-semibold text-slate-700">{s.points} pts</span>
        <span title="Played">{s.played}GP</span>
        <span title="Won" className="text-pitch-600">{s.won}W</span>
        <span title="Drawn">{s.draw}D</span>
        <span title="Lost" className="text-red-400">{s.lost}L</span>
        <span title="Goal difference" className={s.goal_difference > 0 ? 'text-pitch-600' : s.goal_difference < 0 ? 'text-red-400' : ''}>
          {s.goal_difference > 0 ? '+' : ''}{s.goal_difference}
        </span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Props = {
  match: Match
  homeForm: FormResult[]
  awayForm: FormResult[]
  homeStanding: Standing | undefined
  awayStanding: Standing | undefined
  /** Previous WC meeting between these two teams (if any) */
  previousMeeting: Match | undefined
}

export function MatchPreview({ match, homeForm, awayForm, homeStanding, awayStanding, previousMeeting }: Props) {
  const homeTeam = match.home_team
  const awayTeam = match.away_team

  if (homeTeam === 'TBD' && awayTeam === 'TBD') return null

  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
      {/* Form */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { team: homeTeam, form: homeForm, standing: homeStanding, align: 'left' as const },
          { team: awayTeam, form: awayForm, standing: awayStanding, align: 'right' as const },
        ].map(({ team, form, standing, align }) => (
          <div key={team} className={`space-y-2 ${align === 'right' ? 'text-right' : ''}`}>
            {team !== 'TBD' ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {team === homeTeam ? 'Home' : 'Away'} · WC Form
                </p>
                {form.length === 0 ? (
                  <p className="text-xs text-slate-300">No results yet</p>
                ) : (
                  <div className={`flex gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
                    {form.slice(0, 5).map((r, i) => {
                      const score = `${r.goalsFor}–${r.goalsAgainst}`
                      const venue = r.isHome ? 'H' : 'A'
                      return (
                        <FormBadge
                          key={i}
                          r={r}
                          title={`${venue} vs ${r.opponent} ${score} (${formatKickoff(r.kickoff_at)})`}
                        />
                      )
                    })}
                  </div>
                )}
                {/* Most recent form result text */}
                {form.length > 0 && (
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {form.slice(0, 3).map((r, i) => (
                      <span key={i}>
                        {i > 0 && <span className="mx-0.5 text-slate-200">·</span>}
                        <span className={r.result === 'W' ? 'text-pitch-600' : r.result === 'L' ? 'text-red-400' : 'text-slate-500'}>
                          {r.isHome ? '' : '@'}{r.opponent.split(' ').pop()} {r.goalsFor}–{r.goalsAgainst}
                        </span>
                      </span>
                    ))}
                  </p>
                )}
                {standing && <StandingRow s={standing} />}
              </>
            ) : (
              <p className="text-xs text-slate-300">TBD</p>
            )}
          </div>
        ))}
      </div>

      {/* Previous meeting in this WC */}
      {previousMeeting && previousMeeting.home_score !== null && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs">
          <p className="font-semibold text-amber-700">Previous meeting in WC 2026</p>
          <div className="mt-1 flex items-center justify-between gap-2 text-slate-700">
            <span>{previousMeeting.home_team}</span>
            <span className="font-bold tabular-nums">
              {previousMeeting.home_score} – {previousMeeting.away_score}
            </span>
            <span>{previousMeeting.away_team}</span>
          </div>
          <p className="mt-0.5 text-slate-400">
            {stageLabel(previousMeeting.stage)} · {formatKickoff(previousMeeting.kickoff_at)}
          </p>
        </div>
      )}
    </div>
  )
}
