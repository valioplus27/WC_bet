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
  W: 'bg-green-600 text-white',
  D: 'bg-slate-500 text-white',
  L: 'bg-red-500 text-white',
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
    <div className="flex items-center gap-2 rounded-lg bg-surface-1 px-2.5 py-1.5 text-xs text-slate-400">
      <span className="font-bold tabular-nums text-slate-100">{s.position}</span>
      <span className="truncate">{s.group_name}</span>
      <span className="ml-auto flex gap-2 tabular-nums text-slate-400">
        <span title="Points" className="font-semibold text-slate-300">{s.points} pts</span>
        <span title="Played">{s.played}GP</span>
        <span title="Won" className="text-green-400">{s.won}W</span>
        <span title="Drawn">{s.draw}D</span>
        <span title="Lost" className="text-red-400">{s.lost}L</span>
        <span title="Goal difference" className={s.goal_difference > 0 ? 'text-green-400' : s.goal_difference < 0 ? 'text-red-400' : ''}>
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
  /** All finished WC 2026 meetings between these teams (may be empty) */
  previousMeetings?: Match[]
}

function H2HSection({ homeTeam, awayTeam, meetings }: { homeTeam: string; awayTeam: string; meetings: Match[] }) {
  if (meetings.length === 0) return null

  let homeWins = 0, draws = 0, awayWins = 0, homeGoals = 0, awayGoals = 0
  for (const m of meetings) {
    if (m.home_score === null || m.away_score === null) continue
    // Normalise: figure out home vs away relative to the UPCOMING match
    const flip = m.home_team === awayTeam
    const hg = flip ? m.away_score : m.home_score
    const ag = flip ? m.home_score : m.away_score
    homeGoals += hg; awayGoals += ag
    if (hg > ag) homeWins++
    else if (hg < ag) awayWins++
    else draws++
  }

  const shortHome = homeTeam.split(' ').slice(-1)[0]
  const shortAway = awayTeam.split(' ').slice(-1)[0]

  return (
    <div className="rounded-lg border border-surface-4 bg-surface-1 px-3 py-2.5 text-xs">
      <p className="mb-2 font-semibold uppercase tracking-wide text-slate-400">
        Head-to-head · WC 2026
      </p>
      {/* Win/draw/loss bar */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="w-16 text-right font-semibold text-slate-200">{shortHome}</span>
        <div className="flex flex-1 overflow-hidden rounded-full">
          {homeWins > 0 && (
            <div
              style={{ width: `${(homeWins / meetings.length) * 100}%` }}
              className="bg-blue-500 text-center text-[10px] font-bold leading-4 text-white"
            >{homeWins}</div>
          )}
          {draws > 0 && (
            <div
              style={{ width: `${(draws / meetings.length) * 100}%` }}
              className="bg-slate-500 text-center text-[10px] font-bold leading-4 text-white"
            >{draws}</div>
          )}
          {awayWins > 0 && (
            <div
              style={{ width: `${(awayWins / meetings.length) * 100}%` }}
              className="bg-orange-500 text-center text-[10px] font-bold leading-4 text-white"
            >{awayWins}</div>
          )}
        </div>
        <span className="w-16 font-semibold text-slate-200">{shortAway}</span>
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span className="text-blue-400">{homeWins}W · {homeGoals}G</span>
        <span>{draws} draw{draws !== 1 ? 's' : ''}</span>
        <span className="text-orange-400">{awayGoals}G · {awayWins}W</span>
      </div>

      {/* Individual meetings */}
      <div className="mt-2 space-y-1 border-t border-surface-4/40 pt-2">
        {meetings.map((m) => {
          if (m.home_score === null || m.away_score === null) return null
          const flip = m.home_team === awayTeam
          const displayHome = flip ? m.away_team : m.home_team
          const displayAway = flip ? m.home_team : m.away_team
          const hg = flip ? m.away_score : m.home_score
          const ag = flip ? m.home_score : m.away_score
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 text-slate-400">
              <span className="truncate text-[10px]">
                {stageLabel(m.stage)}
                {m.group_name ? ` · ${m.group_name}` : ''}
              </span>
              <span className="font-bold tabular-nums text-slate-200">
                {displayHome.split(' ').slice(-1)[0]} {hg}–{ag} {displayAway.split(' ').slice(-1)[0]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function MatchPreview({ match, homeForm, awayForm, homeStanding, awayStanding, previousMeetings = [] }: Props) {
  const homeTeam = match.home_team
  const awayTeam = match.away_team

  if (homeTeam === 'TBD' && awayTeam === 'TBD') return null

  return (
    <div className="mt-4 space-y-4 border-t border-surface-4/40 pt-4">
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
                {form.length > 0 && (
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {form.slice(0, 3).map((r, i) => (
                      <span key={i}>
                        {i > 0 && <span className="mx-0.5 text-slate-200">·</span>}
                        <span className={r.result === 'W' ? 'text-green-400' : r.result === 'L' ? 'text-red-400' : 'text-slate-500'}>
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

      {/* H2H section */}
      <H2HSection homeTeam={homeTeam} awayTeam={awayTeam} meetings={previousMeetings.filter((m) => m.home_score !== null)} />
    </div>
  )
}
