import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { ScoreInput } from '../components/MatchCard'
import { stageLabel, type Match, type TournamentConfig } from '../types/models'
import { formatKickoff, matchStatusBadge } from '../lib/format'

type Feedback = { kind: 'ok' | 'error'; message: string }

const STATUS_OPTIONS = ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED', 'FINISHED', 'POSTPONED', 'SUSPENDED', 'CANCELLED']

function FeedbackLine({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null
  return (
    <p className={`text-sm ${feedback.kind === 'error' ? 'text-red-600' : 'text-pitch-700'}`} role="status">
      {feedback.message}
    </p>
  )
}

type Tab = { id: string; label: string; icon: string; hint: string }

const TABS: Tab[] = [
  { id: 'sync', label: 'Sync data', icon: '🔄', hint: 'Pull fixtures, live events, and squads from upstream sources.' },
  { id: 'analytics', label: 'Predictions & analytics', icon: '📈', hint: 'StatsBomb ingestion, tactical metrics, and the match-prediction model.' },
  { id: 'results', label: 'Results & settings', icon: '🛠️', hint: 'Hand-correct scores and configure the tournament bet.' },
]

export default function Admin() {
  const [tab, setTab] = useState<string>('sync')

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Admin</h1>
        <p className="text-sm text-slate-500">
          Sync fixtures from football-data.org, correct results by hand, and record the official tournament outcome.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-px">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-pitch-600 text-pitch-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <p className="-mt-3 text-xs text-slate-400">{TABS.find((t) => t.id === tab)?.hint}</p>

      {tab === 'sync' && (
        <div className="space-y-10">
          <SyncSection />
          <LiveSyncSection />
          <SquadSyncSection />
        </div>
      )}

      {tab === 'analytics' && (
        <div className="space-y-10">
          <StatsBombSection />
          <TeamAnalyticsSection />
          <PredictionsSection />
        </div>
      )}

      {tab === 'results' && (
        <div className="space-y-10">
          <MatchResultsSection />
          <TournamentConfigSection />
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Sync — calls the sync-fixtures Edge Function (service role; bypasses RLS to
// upsert matches/standings). Safe to run repeatedly: it upserts on ext_id and
// replaces standings wholesale per group.
// ----------------------------------------------------------------------------
function SyncSection() {
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })

  async function handleSync() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-sync-fixtures`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) },
      )
      const data = (await res.json()) as { matchesSynced?: number; standingsSynced?: number; scorersSynced?: number; error?: string }
      if (!res.ok) {
        setState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` })
        return
      }
      setState({
        kind: 'ok',
        message: `Synced ${data.matchesSynced ?? 0} matches, ${data.standingsSynced ?? 0} standings rows, ${data.scorersSynced ?? 0} scorers.`,
      })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Sync fixtures &amp; results</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          Pulls fixtures, scores, and group standings from football-data.org and writes them to the database — matches
          are matched up by their external ID, so this is safe to run as often as you like (e.g. once a day, or
          whenever you want the latest results).
        </p>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={state.kind === 'loading'}
          className="mt-4 rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === 'loading' ? 'Syncing…' : 'Sync now'}
        </button>
        {state.kind === 'ok' && <p className="mt-3 text-sm text-pitch-700">✓ {state.message}</p>}
        {state.kind === 'error' && (
          <p className="mt-3 text-sm text-red-600">
            {state.message}
            <span className="block text-xs text-red-400">
              If this is the first run, make sure the sync-fixtures function is deployed and FOOTBALL_DATA_API_KEY is set
              (see supabase/functions/sync-fixtures).
            </span>
          </p>
        )}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Live sync — manually triggers sync-live-events to pull goal scorers,
// cards, subs, and in-match stats from API-Football. Requires the
// APIFOOTBALL_API_KEY secret to be set.
// ----------------------------------------------------------------------------
function LiveSyncSection() {
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })

  async function handleSync() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-live-events`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      const data = (await res.json()) as {
        skipped?: boolean; reason?: string; candidates?: number; live?: number
        synced?: number; throttled?: number; resolved?: number; error?: string; hint?: string
      }
      if (!res.ok) {
        setState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` + (data.hint ? ` — ${data.hint}` : '') })
        return
      }
      if (data.skipped) {
        setState({ kind: 'ok', message: `Skipped — ${data.reason ?? 'no live matches'}` })
      } else {
        setState({
          kind: 'ok',
          message: `Synced ${data.synced ?? 0} live matches (${data.throttled ?? 0} throttled, ${data.resolved ?? 0} IDs resolved). ${data.candidates ?? 0} candidates found.`,
        })
      }
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Live match data (API-Football)</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          Pulls goal scorers, cards, substitutions, possession, shots, and corners for currently live matches from
          API-Football. Runs automatically every 2 min via pg_cron (skips if no match is live). Requires{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">APIFOOTBALL_API_KEY</code> to be set as a Supabase secret.
          Free tier: 100 calls/day.
        </p>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={state.kind === 'loading'}
          className="mt-4 rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === 'loading' ? 'Syncing…' : 'Sync now'}
        </button>
        {state.kind === 'ok' && <p className="mt-3 text-sm text-pitch-700">✓ {state.message}</p>}
        {state.kind === 'error' && <p className="mt-3 text-sm text-red-600">{state.message}</p>}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Predictions — runs the Poisson model over all upcoming knockout matches and
// resolves Brier/log-loss for any that have since finished.
// ----------------------------------------------------------------------------
function PredictionsSection() {
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })

  async function handlePredict() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compute-predictions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      const data = (await res.json()) as {
        computed?: number; resolved?: number; teams?: number; leagueAvgGoals?: string
        calibration?: { applied: boolean; temperature: number | null; samples: number; minRequired: number }
        error?: string
      }
      if (!res.ok) { setState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` }); return }
      const cal = data.calibration
      const calNote = cal
        ? cal.applied
          ? ` · Temperature scaling T=${cal.temperature} (${cal.samples} resolved)`
          : ` · Uncalibrated (need ${cal.minRequired - (cal.samples ?? 0)} more resolved predictions)`
        : ''
      setState({
        kind: 'ok',
        message: `Computed ${data.computed ?? 0} predictions, resolved ${data.resolved ?? 0}. ${data.teams ?? 0} teams rated, avg ${data.leagueAvgGoals ?? '—'} goals/team/game.${calNote}`,
      })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Match predictions</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          Runs the Poisson model (Dixon-Coles correction) on group-stage results to generate win/draw/loss
          probabilities for each upcoming knockout match. Also scores any predictions whose match just finished
          (computes Brier score and log-loss). Visible on the Bracket page.
        </p>
        <button
          type="button"
          onClick={() => void handlePredict()}
          disabled={state.kind === 'loading'}
          className="mt-4 rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.kind === 'loading' ? 'Computing…' : 'Run predictions'}
        </button>
        {state.kind === 'ok' && <p className="mt-3 text-sm text-pitch-700">✓ {state.message}</p>}
        {state.kind === 'error' && <p className="mt-3 text-sm text-red-600">{state.message}</p>}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// StatsBomb — batch-ingests WC 2022 event data (shots + passes) from
// StatsBomb's open-data GitHub repo. Used to populate the shots and
// match_events tables for historical analytics. Run in batches of 3 matches
// at a time to stay within the edge function's 60 s timeout.
// ----------------------------------------------------------------------------
function StatsBombSection() {
  const [state, setState] = useState<{
    kind: 'idle' | 'loading' | 'ok' | 'error'
    message?: string
    offset: number
    total: number | null
    hasMore: boolean
  }>({ kind: 'idle', offset: 0, total: null, hasMore: true })

  async function handleIngest() {
    setState((s) => ({ ...s, kind: 'loading' }))
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-statsbomb`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 3, offset: state.offset, competition: 0 }),
        },
      )
      const data = (await res.json()) as {
        competition?: string; totalMatches?: number; shotsIngested?: number
        eventsIngested?: number; skipped?: number; hasMore?: boolean; nextOffset?: number; error?: string
      }
      if (!res.ok) { setState((s) => ({ ...s, kind: 'error', message: data.error ?? `HTTP ${res.status}` })); return }
      setState({
        kind: 'ok',
        offset: data.nextOffset ?? state.offset,
        total: data.totalMatches ?? state.total,
        hasMore: data.hasMore ?? false,
        message: `Batch done: ${data.shotsIngested ?? 0} shots, ${data.eventsIngested ?? 0} pass events ingested (${data.skipped ?? 0} skipped — already loaded).`,
      })
    } catch (err) {
      setState((s) => ({ ...s, kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' }))
    }
  }

  const progress = state.total ? `${state.offset} / ${state.total} matches` : null

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">StatsBomb open data (WC 2022)</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          Ingests shot and pass events for all 64 WC 2022 matches from StatsBomb's open-data repository (CC BY-SA 4.0).
          Processed in batches of 3 matches — click repeatedly until done. Data feeds future shot maps and
          passing-network analysis. Idempotent: already-loaded matches are skipped.
        </p>
        {progress && (
          <p className="mt-2 text-xs text-slate-400">
            Progress: {progress}
            {!state.hasMore && ' — all done ✓'}
          </p>
        )}
        {state.hasMore && (
          <button
            type="button"
            onClick={() => void handleIngest()}
            disabled={state.kind === 'loading'}
            className="mt-4 rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.kind === 'loading' ? 'Loading…' : state.offset === 0 ? 'Start ingestion' : 'Load next batch'}
          </button>
        )}
        {state.kind === 'ok' && <p className="mt-3 text-sm text-pitch-700">✓ {state.message}</p>}
        {state.kind === 'error' && <p className="mt-3 text-sm text-red-600">{state.message}</p>}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Squad sync — pulls all WC 2026 team rosters + coaches from football-data.org
// ----------------------------------------------------------------------------
function SquadSyncSection() {
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })

  async function handleSync() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-squads`,
        { method: 'POST' },
      )
      const data = (await res.json()) as { teams?: number; players?: number; errors?: string[]; error?: string }
      if (!res.ok) { setState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` }); return }
      const errMsg = data.errors?.length ? ` (${data.errors.length} errors)` : ''
      setState({ kind: 'ok', message: `Synced ${data.teams ?? 0} teams, ${data.players ?? 0} players${errMsg}.` })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Squad + Coach Sync</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          Fetches all WC 2026 team squads and head coaches from football-data.org (1 API call).
          Stores in <code className="rounded bg-slate-100 px-1 text-xs">teams</code> and{' '}
          <code className="rounded bg-slate-100 px-1 text-xs">players</code> tables.
          Run once at tournament start; re-run if coaching changes occur.
        </p>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={state.kind === 'loading'}
          className="mt-4 rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.kind === 'loading' ? 'Syncing…' : 'Sync Squads & Coaches'}
        </button>
        {state.kind === 'ok'    && <p className="mt-3 text-sm text-pitch-700">✓ {state.message}</p>}
        {state.kind === 'error' && <p className="mt-3 text-sm text-red-600">{state.message}</p>}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Team analytics — mines StatsBomb WC 2022 events into team_analytics table
// ----------------------------------------------------------------------------
function TeamAnalyticsSection() {
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ kind: 'idle' })

  async function handleCompute() {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compute-team-analytics`,
        { method: 'POST' },
      )
      const data = (await res.json()) as { computed?: number; teams?: string[]; error?: string; message?: string }
      if (!res.ok) { setState({ kind: 'error', message: data.error ?? `HTTP ${res.status}` }); return }
      if (data.error) { setState({ kind: 'error', message: data.error }); return }
      setState({ kind: 'ok', message: `Computed analytics for ${data.computed ?? 0} teams.` })
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Compute Team Analytics</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          Mines the StatsBomb WC 2022 event data (shots + passes) to produce per-team tactical metrics:
          passing volume, completion rate, pressing intensity, xG, passing-network centralization, and chaos index.
          Results appear in the Analytics page under "Tactical Intelligence".
          Requires StatsBomb ingestion to be run first.
        </p>
        <button
          type="button"
          onClick={() => void handleCompute()}
          disabled={state.kind === 'loading'}
          className="mt-4 rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.kind === 'loading' ? 'Computing…' : 'Compute Team Analytics'}
        </button>
        {state.kind === 'ok'    && <p className="mt-3 text-sm text-pitch-700">✓ {state.message}</p>}
        {state.kind === 'error' && <p className="mt-3 text-sm text-red-600">{state.message}</p>}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Match results — manual override. Setting a score and status of FINISHED
// fires recalculate_match_points (see scoring_functions migration), exactly
// like the sync job does — so corrections immediately reflect in points.
// ----------------------------------------------------------------------------
function MatchResultsSection() {
  const { matches, loading, error } = useMatches()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return matches
    return matches.filter((match) =>
      `${match.home_team} ${match.away_team} ${stageLabel(match.stage)} ${match.group_name ?? ''}`.toLowerCase().includes(q),
    )
  }, [matches, query])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Match results</h2>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by team, group, or stage…"
          aria-label="Filter matches"
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
        />
      </div>
      <p className="text-xs text-slate-400">
        Enter a score and mark a match <strong>FINISHED</strong> to (re)calculate everyone's points for it immediately —
        exactly what the sync does automatically once results come in upstream.
      </p>

      {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">Couldn't load matches: {error}</p>}

      {loading ? (
        <Spinner label="Loading matches…" />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          {matches.length === 0 ? 'No matches yet — run a sync to pull the fixture list.' : 'No matches match that filter.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((match) => (
            <AdminMatchRow key={match.id} match={match} />
          ))}
        </ul>
      )}
    </section>
  )
}

function AdminMatchRow({ match }: { match: Match }) {
  const [home, setHome] = useState(match.home_score !== null ? String(match.home_score) : '')
  const [away, setAway] = useState(match.away_score !== null ? String(match.away_score) : '')
  const [status, setStatus] = useState(match.status)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const initialHome = match.home_score !== null ? String(match.home_score) : ''
  const initialAway = match.away_score !== null ? String(match.away_score) : ''
  const dirty = home !== initialHome || away !== initialAway || status !== match.status
  const badge = matchStatusBadge(match.status)

  async function handleSave() {
    setSaving(true)
    setFeedback(null)
    const { error } = await supabase
      .from('matches')
      .update({
        home_score: home === '' ? null : Number(home),
        away_score: away === '' ? null : Number(away),
        status,
      })
      .eq('id', match.id)
    setSaving(false)
    setFeedback(error ? { kind: 'error', message: error.message } : { kind: 'ok', message: 'Saved ✓ — points recalculated.' })
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium text-slate-900">
            {match.home_team} <span className="text-slate-400">v</span> {match.away_team}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            <span>
              {stageLabel(match.stage)}
              {match.group_name ? ` · ${match.group_name}` : ''} · {formatKickoff(match.kickoff_at)}
            </span>
            {badge && <span className={`rounded-full px-1.5 py-0.5 font-medium ${badge.className}`}>{badge.label}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ScoreInput value={home} onChange={setHome} ariaLabel={`${match.home_team} score`} />
          <span className="text-slate-400">–</span>
          <ScoreInput value={away} onChange={setAway} ariaLabel={`${match.away_team} score`} />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label={`${match.home_team} v ${match.away_team} status`}
            className="rounded-md border border-slate-300 px-2 py-2 text-xs shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || saving}
            className="rounded-md bg-pitch-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {feedback && (
        <div className="mt-2">
          <FeedbackLine feedback={feedback} />
        </div>
      )}
    </li>
  )
}

// ----------------------------------------------------------------------------
// Tournament settings & official results — editing lock_at / points config /
// actual_* writes to tournament_config; filling in all four actual_* fields
// fires recalculate_tournament_points (see scoring_functions migration).
// ----------------------------------------------------------------------------
function TournamentConfigSection() {
  const { matches } = useMatches()
  const [config, setConfig] = useState<TournamentConfig | null>(null)
  const [loading, setLoading] = useState(true)

  const teams = useMemo(() => {
    const set = new Set<string>()
    for (const match of matches) {
      set.add(match.home_team)
      set.add(match.away_team)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [matches])

  useEffect(() => {
    let active = true
    async function load() {
      const { data } = await supabase.from('tournament_config').select('*').eq('id', 1).maybeSingle()
      if (active) {
        setConfig(data)
        setLoading(false)
      }
    }
    void load()

    const channel = supabase
      .channel('admin-tournament-config')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_config' }, () => void load())
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [])

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-slate-900">Tournament bet settings &amp; results</h2>
      {loading ? (
        <Spinner label="Loading tournament settings…" />
      ) : !config ? (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          No tournament_config row found — it should have been seeded by the migrations. Check the Supabase SQL editor.
        </p>
      ) : (
        <TournamentConfigForm config={config} teams={teams} />
      )}
    </section>
  )
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function TournamentConfigForm({ config, teams }: { config: TournamentConfig; teams: string[] }) {
  const [lockAt, setLockAt] = useState(() => toLocalInputValue(config.lock_at))
  const [podiumPoints, setPodiumPoints] = useState(String(config.points_podium_correct_position))
  const [scorerPoints, setScorerPoints] = useState(String(config.points_top_scorer))
  const [actualFirst, setActualFirst] = useState(config.actual_first ?? '')
  const [actualSecond, setActualSecond] = useState(config.actual_second ?? '')
  const [actualThird, setActualThird] = useState(config.actual_third ?? '')
  const [actualScorer, setActualScorer] = useState(config.actual_top_scorer ?? '')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFeedback(null)

    const lockAtDate = new Date(lockAt)
    if (Number.isNaN(lockAtDate.getTime())) {
      setSaving(false)
      setFeedback({ kind: 'error', message: 'Enter a valid lock date and time.' })
      return
    }

    const { error } = await supabase
      .from('tournament_config')
      .update({
        lock_at: lockAtDate.toISOString(),
        points_podium_correct_position: Number(podiumPoints),
        points_top_scorer: Number(scorerPoints),
        actual_first: actualFirst.trim() || null,
        actual_second: actualSecond.trim() || null,
        actual_third: actualThird.trim() || null,
        actual_top_scorer: actualScorer.trim() || null,
      })
      .eq('id', 1)

    setSaving(false)
    setFeedback(
      error
        ? { kind: 'error', message: error.message }
        : { kind: 'ok', message: 'Tournament settings saved ✓ — bet points recalculate automatically once all four results are filled in.' },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <label htmlFor="lockAt" className="block text-sm font-semibold text-slate-900">
          Tournament-bet lock time
        </label>
        <p className="mt-0.5 text-xs text-slate-400">
          Podium &amp; top-scorer picks become read-only for everyone at this instant — set it before the opening match
          kicks off.
        </p>
        <input
          id="lockAt"
          type="datetime-local"
          required
          value={lockAt}
          onChange={(event) => setLockAt(event.target.value)}
          className="mt-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="podiumPoints" className="block text-sm font-semibold text-slate-900">
            Points per correct podium spot
          </label>
          <input
            id="podiumPoints"
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            required
            value={podiumPoints}
            onChange={(event) => setPodiumPoints(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
          />
        </div>
        <div>
          <label htmlFor="scorerPoints" className="block text-sm font-semibold text-slate-900">
            Points for correct top scorer
          </label>
          <input
            id="scorerPoints"
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            required
            value={scorerPoints}
            onChange={(event) => setScorerPoints(event.target.value)}
            className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
          />
        </div>
      </div>

      <fieldset className="space-y-3 border-t border-slate-100 pt-4">
        <legend className="text-sm font-semibold text-slate-900">Official tournament results</legend>
        <p className="text-xs text-slate-400">
          Leave these blank until the tournament is over. The moment all four are filled in, every player's tournament
          bet is scored automatically — and the result is revealed on their Tournament bet page and the leaderboard.
        </p>
        <ResultSelect label="🥇 1st place" value={actualFirst} options={teams} onChange={setActualFirst} />
        <ResultSelect label="🥈 2nd place" value={actualSecond} options={teams} onChange={setActualSecond} />
        <ResultSelect label="🥉 3rd place" value={actualThird} options={teams} onChange={setActualThird} />
        <div className="flex items-center justify-between gap-3 text-sm text-slate-700">
          <label htmlFor="actualScorer" className="font-medium">
            ⚽ Top scorer
          </label>
          <input
            id="actualScorer"
            type="text"
            maxLength={80}
            value={actualScorer}
            onChange={(event) => setActualScorer(event.target.value)}
            placeholder="Player's full name"
            className="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
          />
        </div>
      </fieldset>

      <FeedbackLine feedback={feedback} />

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save tournament settings'}
      </button>
    </form>
  )
}

function ResultSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
      >
        <option value="">— not yet known —</option>
        {options.map((team) => (
          <option key={team} value={team}>
            {team}
          </option>
        ))}
      </select>
    </label>
  )
}
