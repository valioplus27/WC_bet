// ============================================================================
// MatchDetail — full match view: live score, squad lists, event timeline,
// in-match stats, model probability, pre-match H2H form.
//
// Route: /match/:id  (numeric DB row id)
//
// Live matches auto-refresh every 30 s via a polling interval that fires only
// when status === 'live' | 'paused'. Supabase realtime covers score/status
// changes between polls.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { provider } from '../lib/providers'
import { Spinner } from '../components/Spinner'
import { ProbabilityBar } from '../components/ProbabilityBar'
import { FormBadges } from '../components/FormSparkline'
import { formatKickoff } from '../lib/format'
import { stageLabel } from '../types/models'
import type { MatchDetail as Detail, TeamDetail } from '../lib/providers/types'
import type { Prediction, Bet } from '../types/models'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type Player = {
  id: number
  team_id: string
  name: string
  position: string | null
  shirt_number: number | null
  nationality: string | null
}

// ---------------------------------------------------------------------------
// Squad list
// ---------------------------------------------------------------------------

const POSITION_ORDER = ['Goalkeeper', 'Defence', 'Midfield', 'Offence']

function SquadList({ players, color }: { players: Player[]; color: 'blue' | 'orange' }) {
  if (players.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Squad not synced — run <strong>Sync Squads</strong> in Admin to populate.
      </p>
    )
  }

  const byPos = new Map<string, Player[]>()
  for (const p of players) {
    const pos = p.position ?? 'Unknown'
    const list = byPos.get(pos) ?? []
    list.push(p)
    byPos.set(pos, list)
  }

  const posGroups = [...POSITION_ORDER, 'Unknown']
    .map((pos) => ({ pos, players: byPos.get(pos) ?? [] }))
    .filter((g) => g.players.length > 0)

  const colorCls = color === 'blue' ? 'text-blue-400' : 'text-orange-500'

  return (
    <div className="space-y-3">
      {posGroups.map(({ pos, players: group }) => (
        <div key={pos}>
          <p className={`mb-1.5 text-[10px] font-bold uppercase tracking-wider ${colorCls}`}>{pos}</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {group.map((p) => (
              <Link
                key={p.id}
                to={`/player/${encodeURIComponent(p.name)}`}
                className="flex items-center gap-1.5 rounded-md bg-surface-1 px-2 py-1.5 text-xs hover:bg-surface-3 transition-colors"
              >
                {p.shirt_number != null && (
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] text-slate-400">{p.shirt_number}</span>
                )}
                <span className="truncate font-medium text-slate-200">{p.name}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event timeline
// ---------------------------------------------------------------------------

function eventIcon(type: Detail['events'][0]['type'], detail?: string): string {
  if (type === 'goal')     return '⚽'
  if (type === 'own_goal') return '⚽'
  if (type === 'penalty')  return '⚽'
  if (type === 'card') {
    const d = (detail ?? '').toLowerCase()
    if (d.includes('red')) return '🟥'
    return '🟨'
  }
  if (type === 'substitution') return '🔄'
  if (type === 'var') return '📺'
  return '•'
}

function EventTimeline({ match }: { match: Detail }) {
  const { events, homeTeam, awayTeam } = match
  if (events.length === 0) return null

  return (
    <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Match events</h2>
      <div className="relative space-y-0">
        {events.map((ev, i) => {
          const isHome  = ev.side === 'home'
          const minute  = ev.extraMinute ? `${ev.minute}+${ev.extraMinute}'` : `${ev.minute}'`
          const suffix  = ev.type === 'own_goal' ? ' OG' : ev.type === 'penalty' ? ' (pen)' : ''
          const label   = [ev.player, suffix.trim() || undefined].filter(Boolean).join(' ')
          const assist  = ev.type === 'substitution'
            ? ev.assist && `→ ${ev.assist}`
            : ev.assist && `(${ev.assist})`

          return (
            <div
              key={i}
              className={`flex items-center gap-3 border-b border-surface-4/30 py-2 text-sm last:border-0 ${isHome ? 'flex-row' : 'flex-row-reverse'}`}
            >
              <span className="w-12 shrink-0 text-center font-mono text-[11px] text-slate-400">{minute}</span>
              <span className="text-base">{eventIcon(ev.type, ev.detail)}</span>
              <div className={`flex-1 ${isHome ? 'text-left' : 'text-right'}`}>
                <span className="font-medium text-slate-100">{label}</span>
                {assist && <span className="ml-1.5 text-xs text-slate-400">{assist}</span>}
              </div>
              <span className={`w-14 shrink-0 text-[10px] font-semibold ${isHome ? 'text-blue-400' : 'text-right text-orange-400'}`}>
                {isHome ? homeTeam.name : awayTeam.name}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Stats panel
// ---------------------------------------------------------------------------

function StatBar({ label, home, away }: { label: string; home: number; away: number }) {
  const total = home + away
  const hp = total > 0 ? Math.round((home / total) * 100) : 50
  return (
    <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center gap-2 text-xs">
      <span className="text-right tabular-nums font-semibold text-blue-400">{home}</span>
      <div className="space-y-0.5">
        <div className="relative h-1.5 overflow-hidden rounded-full bg-orange-100">
          <div style={{ width: `${hp}%` }} className="absolute inset-y-0 left-0 rounded-full bg-blue-400" />
        </div>
        <p className="text-center text-[10px] text-slate-400">{label}</p>
      </div>
      <span className="tabular-nums font-semibold text-orange-500">{away}</span>
    </div>
  )
}

function StatsPanel({ match }: { match: Detail }) {
  const s = match.stats
  if (!s) {
    // Only show this section when the match is live or recent — no stats yet is normal for scheduled matches
    const isLiveOrRecent = match.status === 'live' || match.status === 'paused' || match.status === 'finished'
    if (!isLiveOrRecent) return null
    return (
      <section className="rounded-xl border border-dashed border-surface-4/50 bg-surface-2/50 px-4 py-3">
        <p className="text-xs text-slate-500">Live stats will appear here once data is synced.</p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
      <h2 className="mb-3 text-sm font-semibold text-slate-100">Match statistics</h2>
      <div className="mb-3 flex justify-between text-[10px] font-semibold uppercase tracking-wide">
        <span className="text-blue-400 max-w-24 truncate">{match.homeTeam.name}</span>
        <span className="text-slate-400">Stats</span>
        <span className="text-orange-400 max-w-24 truncate text-right">{match.awayTeam.name}</span>
      </div>
      <div className="space-y-3">
        {s.possession && (
          <div className="space-y-0.5">
            <div className="flex h-2.5 overflow-hidden rounded-full">
              <div style={{ width: `${s.possession.home}%` }} className="bg-blue-500" />
              <div style={{ width: `${s.possession.away}%` }} className="bg-orange-400" />
            </div>
            <div className="flex justify-between text-[10px] tabular-nums">
              <span className="font-semibold text-blue-400">{s.possession.home}%</span>
              <span className="text-slate-400">Possession</span>
              <span className="font-semibold text-orange-500">{s.possession.away}%</span>
            </div>
          </div>
        )}
        {s.shots           && <StatBar label="Total shots"  home={s.shots.home}          away={s.shots.away} />}
        {s.shotsOnTarget   && <StatBar label="On target"    home={s.shotsOnTarget.home}   away={s.shotsOnTarget.away} />}
        {s.corners         && <StatBar label="Corners"      home={s.corners.home}         away={s.corners.away} />}
        {s.fouls           && <StatBar label="Fouls"        home={s.fouls.home}           away={s.fouls.away} />}
        {s.offsides        && <StatBar label="Offsides"     home={s.offsides.home}        away={s.offsides.away} />}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pre-match H2H form comparison
// ---------------------------------------------------------------------------

function MetricRow({ label, home, away }: { label: string; home: string; away: string }) {
  return (
    <tr className="border-b border-surface-4/30 text-xs text-slate-300">
      <td className="py-1.5 pr-3 text-right tabular-nums font-semibold text-blue-400">{home}</td>
      <td className="py-1.5 px-3 text-center text-[10px] text-slate-400">{label}</td>
      <td className="py-1.5 pl-3 tabular-nums font-semibold text-orange-500">{away}</td>
    </tr>
  )
}

function FormPanel({ homeTeam, awayTeam, homeDetail, awayDetail }: {
  homeTeam: string
  awayTeam: string
  homeDetail: TeamDetail
  awayDetail: TeamDetail
}) {
  const hf = homeDetail.form5
  const af = awayDetail.form5
  const fmt = (n: number) => n.toFixed(2)

  return (
    <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
      <h2 className="mb-3 text-sm font-semibold text-slate-100">
        Pre-match form <span className="font-normal text-slate-400">(last {Math.max(hf.sampleSize, af.sampleSize)} WC matches)</span>
      </h2>

      <div className="mb-3 grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="mb-1 font-semibold text-blue-400">{homeTeam}</p>
          <FormBadges form={hf} n={5} />
          {hf.sampleSize === 0 && <p className="mt-1 text-slate-400">No finished matches yet</p>}
        </div>
        <div>
          <p className="mb-1 font-semibold text-orange-500">{awayTeam}</p>
          <FormBadges form={af} n={5} />
          {af.sampleSize === 0 && <p className="mt-1 text-slate-400">No finished matches yet</p>}
        </div>
      </div>

      {(hf.sampleSize > 0 || af.sampleSize > 0) && (
        <table className="w-full">
          <tbody>
            <MetricRow label="W / D / L"           home={`${hf.wins}/${hf.draws}/${hf.losses}`}       away={`${af.wins}/${af.draws}/${af.losses}`} />
            <MetricRow label="Avg goals for"        home={fmt(hf.avgGoalsFor)}                         away={fmt(af.avgGoalsFor)} />
            <MetricRow label="Avg goals against"    home={fmt(hf.avgGoalsAgainst)}                     away={fmt(af.avgGoalsAgainst)} />
            <MetricRow label="Median goals for"     home={String(hf.medianGoalsFor)}                   away={String(af.medianGoalsFor)} />
          </tbody>
        </table>
      )}

      <p className="mt-3 text-[10px] text-slate-400">
        WC 2026 data only — thin early in the tournament; shrinkage toward historical average applied in the model.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MatchDetailPage() {
  const { id }      = useParams<{ id: string }>()
  const { session } = useAuth()
  const userId      = session?.user.id

  const [match,        setMatch]        = useState<Detail | null>(null)
  const [prediction,   setPrediction]   = useState<Prediction | null>(null)
  const [myBet,        setMyBet]        = useState<Bet | null>(null)
  const [homeDetail,   setHomeDetail]   = useState<TeamDetail | null>(null)
  const [awayDetail,   setAwayDetail]   = useState<TeamDetail | null>(null)
  const [homePlayers,  setHomePlayers]  = useState<Player[]>([])
  const [awayPlayers,  setAwayPlayers]  = useState<Player[]>([])
  const [loading,      setLoading]      = useState(true)
  const [notFound,     setNotFound]     = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)

  // Generation counter so stale responses from concurrent loads are dropped.
  const loadGen = useRef(0)

  const load = useCallback(async () => {
    if (!id) return
    const gen = ++loadGen.current

    const detail = await provider.getMatch(id)
    if (loadGen.current !== gen) return
    if (!detail) { setNotFound(true); setLoading(false); return }
    setMatch(detail)

    const [predRes, betRes, hd, ad, hpRes, apRes] = await Promise.all([
      supabase.from('predictions').select('*').eq('match_id', Number(id)).maybeSingle(),
      userId
        ? supabase.from('bets').select('*').eq('match_id', Number(id)).eq('user_id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
      provider.getTeam(detail.homeTeam.id),
      provider.getTeam(detail.awayTeam.id),
      supabase
        .from('players')
        .select('id,team_id,name,position,shirt_number,nationality')
        .eq('team_id', detail.homeTeam.id)
        .order('shirt_number', { ascending: true }),
      supabase
        .from('players')
        .select('id,team_id,name,position,shirt_number,nationality')
        .eq('team_id', detail.awayTeam.id)
        .order('shirt_number', { ascending: true }),
    ])

    if (loadGen.current !== gen) return
    setPrediction((predRes as any).data ?? null)
    setMyBet((betRes as any).data ?? null)
    setHomeDetail(hd)
    setAwayDetail(ad)
    setHomePlayers(((hpRes as any).data ?? []) as Player[])
    setAwayPlayers(((apRes as any).data ?? []) as Player[])
    setLastUpdated(new Date())
    setLoading(false)
  }, [id, userId])

  useEffect(() => { void load() }, [load])

  // 30-second polling when live — effect re-fires when status changes
  const matchStatus = match?.status
  useEffect(() => {
    if (matchStatus !== 'live' && matchStatus !== 'paused') return
    const interval = setInterval(() => { void load() }, 30_000)
    return () => clearInterval(interval)
  }, [matchStatus, load])

  if (loading)   return <Spinner label="Loading match…" />
  if (notFound || !match) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <p className="text-sm text-red-600">Match not found.</p>
        <Link to="/calendar" className="text-sm text-pitch-400 hover:underline">← Back to calendar</Link>
      </div>
    )
  }

  const hasScore = match.homeScore !== undefined && match.awayScore !== undefined
  const isLive   = match.status === 'live' || match.status === 'paused'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <Link to="/calendar" className="text-xs text-pitch-400 hover:underline">← Calendar</Link>
        {isLive && lastUpdated && (
          <p className="text-[10px] text-slate-400">
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · refreshes every 30s
          </p>
        )}
      </div>

      {/* Match header */}
      <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-6 shadow-none">
        <p className="mb-3 text-center text-xs text-slate-400">
          {stageLabel(match.stage)}
          {match.groupName ? ` · ${match.groupName}` : ''}
          {' · '}{formatKickoff(match.kickoffAt)}
        </p>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Link to={`/team/${match.homeTeam.id}`} className="text-right font-bold text-slate-100 hover:text-pitch-400 sm:text-lg">
            {match.homeTeam.name}
          </Link>

          <div className="flex flex-col items-center gap-1">
            {hasScore ? (
              <span className={`text-3xl font-black tabular-nums ${isLive ? 'text-red-400' : 'text-slate-100'}`}>
                {match.homeScore} – {match.awayScore}
              </span>
            ) : (
              <span className="text-2xl font-bold text-slate-300">vs</span>
            )}
            {isLive && (
              <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                LIVE
              </span>
            )}
            {match.status === 'finished' && (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-slate-500">Final</span>
            )}
          </div>

          <Link to={`/team/${match.awayTeam.id}`} className="font-bold text-slate-100 hover:text-pitch-400 sm:text-lg">
            {match.awayTeam.name}
          </Link>
        </div>

        {/* Model probability */}
        {prediction && (
          <div className="mt-5 border-t border-surface-4/40 pt-4">
            <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Model prediction · Poisson{prediction.actual_outcome ? ' · resolved' : ''}
            </p>
            <ProbabilityBar
              homeWin={prediction.home_win_prob}
              draw={prediction.draw_prob}
              awayWin={prediction.away_win_prob}
              homeLabel={match.homeTeam.name}
              awayLabel={match.awayTeam.name}
            />
            {myBet && (
              <p className="mt-2 text-center text-xs text-slate-500">
                Your prediction:{' '}
                <span className="font-semibold text-slate-100">
                  {myBet.predicted_home}–{myBet.predicted_away}
                </span>
                {myBet.points_awarded !== null && (
                  <span className={`ml-2 font-semibold ${myBet.points_awarded >= 3 ? 'text-pitch-400' : myBet.points_awarded > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                    +{myBet.points_awarded} pt{myBet.points_awarded === 1 ? '' : 's'}
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Squad lists */}
      <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5 shadow-none">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Squads</h2>
          <span className="text-[10px] text-slate-400">Click a name for analytics</span>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold text-blue-400">{match.homeTeam.name}</p>
            <SquadList players={homePlayers} color="blue" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-orange-500">{match.awayTeam.name}</p>
            <SquadList players={awayPlayers} color="orange" />
          </div>
        </div>
      </section>

      {/* Pre-match form comparison */}
      {homeDetail && awayDetail && (
        <FormPanel
          homeTeam={match.homeTeam.name}
          awayTeam={match.awayTeam.name}
          homeDetail={homeDetail}
          awayDetail={awayDetail}
        />
      )}

      {/* Event timeline */}
      <EventTimeline match={match} />

      {/* Match stats */}
      <StatsPanel match={match} />
    </div>
  )
}
