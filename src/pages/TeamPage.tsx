// ============================================================================
// TeamPage — team profile with squad, form metrics, fixtures, and results.
// Route: /team/:slug
// ============================================================================
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { provider } from '../lib/providers'
import { Spinner } from '../components/Spinner'
import { FormSparkline, FormBadges } from '../components/FormSparkline'
import { MatchRow } from '../components/MatchRow'
import { formatKickoff } from '../lib/format'
import type { FormWindow, TeamDetail } from '../lib/providers/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Player = {
  id: number
  name: string
  position: string | null
  shirt_number: number | null
  nationality: string | null
}

type TeamInfo = {
  coach_name: string | null
  coach_nationality: string | null
  tla: string | null
}

// ---------------------------------------------------------------------------
// Rolling form card
// ---------------------------------------------------------------------------

function MetricPair({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-surface-4/40 bg-surface-1 px-3 py-2.5 text-center">
      <p className="text-lg font-bold tabular-nums text-slate-100">{value}</p>
      {sub && <p className="text-[10px] tabular-nums text-slate-400">{sub}</p>}
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  )
}

function FormCard({ form, title }: { form: FormWindow; title: string }) {
  const { sampleSize, windowSize, wins, draws, losses, avgGoalsFor, avgGoalsAgainst, medianGoalsFor, medianGoalsAgainst, formRating } = form
  const thinSample = sampleSize < windowSize

  return (
    <div className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {thinSample && (
          <span className="rounded-full bg-amber-950/50 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            n={sampleSize} of {windowSize}
          </span>
        )}
      </div>

      {sampleSize === 0 ? (
        <p className="text-xs text-slate-400">No finished matches yet.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <FormSparkline form={form} maxDots={windowSize} />
            <div className="flex items-center gap-1 text-sm">
              <span className="font-semibold text-green-400">{wins}W</span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-amber-600">{draws}D</span>
              <span className="text-slate-300">·</span>
              <span className="font-semibold text-red-500">{losses}L</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricPair label="Avg goals for"     value={avgGoalsFor.toFixed(2)}      sub={`med ${medianGoalsFor}`} />
            <MetricPair label="Avg goals against" value={avgGoalsAgainst.toFixed(2)}  sub={`med ${medianGoalsAgainst}`} />
            <MetricPair label="Form rating"        value={`${Math.round(formRating * 100)}%`} sub="W=1 D=.33 L=0" />
            <MetricPair
              label="Goal diff"
              value={(avgGoalsFor - avgGoalsAgainst >= 0 ? '+' : '') + (avgGoalsFor - avgGoalsAgainst).toFixed(2)}
            />
          </div>

          {thinSample && (
            <p className="mt-3 text-[10px] text-slate-400">
              Based on {sampleSize} WC 2026 match{sampleSize === 1 ? '' : 'es'} — metrics stabilise as the tournament progresses.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Squad section
// ---------------------------------------------------------------------------

const POSITION_ORDER = ['Goalkeeper', 'Defence', 'Midfield', 'Offence']

function SquadSection({ players, teamInfo, teamSlug }: { players: Player[]; teamInfo: TeamInfo | null; teamSlug: string }) {
  if (players.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-surface-4 bg-surface-2 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Squad</h2>
        <p className="text-xs text-slate-400">
          Not synced yet — run <strong>Sync Squads</strong> in Admin to load the registered squad.
        </p>
      </section>
    )
  }

  const byPos = new Map<string, Player[]>()
  for (const p of players) {
    const pos = p.position ?? 'Unknown'
    const list = byPos.get(pos) ?? []
    list.push(p)
    byPos.set(pos, list)
  }

  const groups = [...POSITION_ORDER, 'Unknown']
    .map((pos) => ({ pos, players: byPos.get(pos) ?? [] }))
    .filter((g) => g.players.length > 0)

  return (
    <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Squad</h2>
          <p className="text-[10px] text-slate-400">{players.length} players · tap a name for analytics</p>
        </div>
        {teamInfo?.coach_name && (
          <Link to={`/coach/${teamSlug}`} className="group text-right">
            <p className="text-[10px] text-slate-400">Head coach</p>
            <p className="text-xs font-semibold text-slate-300 group-hover:text-pitch-400 transition">{teamInfo.coach_name} →</p>
            {teamInfo.coach_nationality && (
              <p className="text-[10px] text-slate-400">{teamInfo.coach_nationality}</p>
            )}
          </Link>
        )}
      </div>

      <div className="space-y-4">
        {groups.map(({ pos, players: group }) => (
          <div key={pos}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{pos}</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {group.map((p) => (
                <Link
                  key={p.id}
                  to={`/player/${encodeURIComponent(p.name)}`}
                  className="flex items-center gap-1.5 rounded-md bg-surface-1 px-2.5 py-1.5 text-xs hover:bg-surface-3 transition-colors"
                >
                  {p.shirt_number != null && (
                    <span className="w-5 shrink-0 text-right font-mono text-[10px] text-slate-400">{p.shirt_number}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-200">{p.name}</p>
                    {p.nationality && (
                      <p className="truncate text-[10px] text-slate-400">{p.nationality}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Recent match row
// ---------------------------------------------------------------------------

function RecentMatchRow({ match, teamName }: { match: TeamDetail['recent'][0]; teamName: string }) {
  const isHome   = match.homeTeam.name === teamName
  const opponent = isHome ? match.awayTeam.name : match.homeTeam.name
  const gf       = isHome ? match.homeScore : match.awayScore
  const ga       = isHome ? match.awayScore : match.homeScore
  const result   = gf !== undefined && ga !== undefined
    ? gf > ga ? 'W' : gf === ga ? 'D' : 'L'
    : null
  const cls: Record<string, string> = { W: 'text-green-400', D: 'text-amber-400', L: 'text-red-400' }

  return (
    <Link
      to={`/match/${match.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-surface-4/40 bg-surface-2 px-3 py-2.5 text-sm hover:border-surface-4"
    >
      <span className={`w-4 shrink-0 font-bold ${result ? cls[result] : 'text-slate-400'}`}>{result ?? '?'}</span>
      <span className="flex-1 truncate text-slate-300">
        {isHome ? '🏠' : '✈️'} vs {opponent}
      </span>
      {gf !== undefined && ga !== undefined && (
        <span className="shrink-0 font-semibold tabular-nums text-slate-100">{gf}–{ga}</span>
      )}
      <span className="shrink-0 text-[10px] text-slate-400">{formatKickoff(match.kickoffAt)}</span>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TeamPage() {
  const { slug } = useParams<{ slug: string }>()

  const [detail,    setDetail]    = useState<TeamDetail | null>(null)
  const [players,   setPlayers]   = useState<Player[]>([])
  const [teamInfo,  setTeamInfo]  = useState<TeamInfo | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [notFound,  setNotFound]  = useState(false)

  useEffect(() => {
    if (!slug) return
    setLoading(true)

    Promise.all([
      provider.getTeam(slug),
      supabase
        .from('players')
        .select('id,name,position,shirt_number,nationality')
        .eq('team_id', slug)
        .order('shirt_number', { ascending: true }),
      supabase
        .from('teams')
        .select('coach_name,coach_nationality,tla')
        .eq('id', slug)
        .maybeSingle(),
    ]).then(([d, pRes, tRes]) => {
      if (!d) { setNotFound(true) }
      else { setDetail(d) }
      setPlayers(((pRes as any).data ?? []) as Player[])
      setTeamInfo(((tRes as any).data ?? null) as TeamInfo | null)
      setLoading(false)
    })
  }, [slug])

  if (loading)   return <Spinner label="Loading team…" />
  if (notFound || !detail) {
    const prettyName = (slug ?? '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link to="/analytics" className="text-xs text-pitch-400 hover:underline">← Back to analytics</Link>
        <div className="rounded-xl border border-surface-4/70 bg-surface-2 px-6 py-10 text-center">
          <p className="text-3xl">🌍</p>
          <p className="mt-3 text-base font-semibold text-slate-100">
            {prettyName || 'This team'} isn’t in World Cup 2026
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
            We only track the 48 nations that qualified for the tournament. This team either didn’t
            qualify, or its data hasn’t been loaded yet.
          </p>
          <Link
            to="/standings"
            className="mt-5 inline-block rounded-lg border border-surface-4 bg-surface-3 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-surface-4/60"
          >
            Browse qualified teams →
          </Link>
        </div>
      </div>
    )
  }

  const { team, form5, form10, upcoming, recent } = detail

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <Link to="/calendar" className="text-xs text-pitch-400 hover:underline">← Calendar</Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-2xl font-black text-slate-100">{team.name}</h1>
          {teamInfo?.tla && (
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-xs font-mono text-slate-500">{teamInfo.tla}</span>
          )}
          <FormBadges form={form5} n={5} />
        </div>
        <p className="mt-1 text-xs text-slate-400">FIFA World Cup 2026 · WC stats only</p>
      </div>

      {/* Squad */}
      <SquadSection players={players} teamInfo={teamInfo} teamSlug={slug ?? ''} />

      {/* Rolling form — last 5 */}
      <FormCard form={form5} title="Form — last 5 matches" />

      {/* Rolling form — last 10 */}
      <FormCard form={form10} title="Form — last 10 matches" />

      {/* Upcoming fixtures */}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-100">Upcoming fixtures</h2>
          {upcoming.map((m) => (
            <MatchRow key={m.id} match={m} />
          ))}
        </section>
      )}

      {/* Recent results */}
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-100">Recent results</h2>
          {recent.map((m) => (
            <RecentMatchRow key={m.id} match={m} teamName={team.name} />
          ))}
        </section>
      )}

      {recent.length === 0 && upcoming.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-600 bg-surface-2 px-4 py-10 text-center text-sm text-slate-400">
          No matches found for this team.
        </p>
      )}
    </div>
  )
}
