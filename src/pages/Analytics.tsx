// ============================================================================
// Analytics hub — three-tab browser for Teams, Players, and Coaches.
//
// Teams tab   : All WC2022 StatsBomb-analysed teams with tactical metrics.
//               Click → /team/:slug (TeamPage) for full drill-down including
//               squad, coach, and passing network.
// Players tab : Search WC2026 squad players (sync'd from football-data.org).
//               Click → /player/:name (PlayerPage) for StatsBomb analytics
//               when that player has WC2022 event data.
// Coaches tab : All WC2026 head coaches with nationality and team.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components/Spinner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamAnalytics = {
  team_name: string
  avg_passes_per_match: number | null
  avg_xg_per_match: number | null
  avg_pressures_per_match: number | null
  avg_carries_per_match: number | null
  pass_completion_rate: number | null
  chaos_index: number | null
  matches_in_sample: number
}

type Player = {
  name: string
  team_id: string
  position: string | null
  shirt_number: number | null
  nationality: string | null
}

type Coach = {
  id: string
  name: string
  coach_name: string | null
  coach_nationality: string | null
  crest_url: string | null
}

// ---------------------------------------------------------------------------
// Stat chip
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold tabular-nums text-slate-100">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Teams tab
// ---------------------------------------------------------------------------

function TeamsTab({ teams }: { teams: TeamAnalytics[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'passes' | 'xg' | 'press'>('passes')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = q ? teams.filter((t) => t.team_name.toLowerCase().includes(q)) : [...teams]
    list.sort((a, b) => {
      if (sort === 'name')   return a.team_name.localeCompare(b.team_name)
      if (sort === 'passes') return (b.avg_passes_per_match ?? 0) - (a.avg_passes_per_match ?? 0)
      if (sort === 'xg')     return (b.avg_xg_per_match ?? 0) - (a.avg_xg_per_match ?? 0)
      if (sort === 'press')  return (b.avg_pressures_per_match ?? 0) - (a.avg_pressures_per_match ?? 0)
      return 0
    })
    return list
  }, [teams, query, sort])

  const slugify = (name: string) =>
    name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  if (teams.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-4 px-6 py-16 text-center">
        <p className="text-sm text-slate-400">No team analytics yet.</p>
        <p className="mt-1 text-xs text-slate-500">Run the StatsBomb ingestion from Admin, then Compute Team Analytics.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        Tactical metrics aggregated across StatsBomb open data: WC 2018, WC 2022, Euro 2020, Euro 2024, Copa América 2024. Matches in sample shown per card. Click a team to explore their squad, coach, and passing network.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams…"
          className="w-48 rounded-lg border border-surface-4 px-3 py-1.5 text-sm"
        />
        <div className="flex items-center gap-1 text-xs text-slate-400">
          Sort:
          {(['passes', 'xg', 'press', 'name'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`rounded px-2 py-1 transition ${
                sort === s ? 'bg-pitch-600/20 text-pitch-400' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {s === 'passes' ? 'Passes' : s === 'xg' ? 'xG' : s === 'press' ? 'Pressing' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((t) => (
          <Link
            key={t.team_name}
            to={`/team/${slugify(t.team_name)}`}
            className="group rounded-xl border border-surface-4/70 bg-surface-2 p-4 transition hover:border-pitch-600/50 hover:bg-surface-3"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <p className="font-semibold text-slate-100 group-hover:text-pitch-400 transition">{t.team_name}</p>
              <span className="text-[10px] text-slate-500">{t.matches_in_sample}m WC22</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Pass/g" value={t.avg_passes_per_match?.toFixed(0) ?? '—'} />
              <Stat label="xG/g" value={t.avg_xg_per_match?.toFixed(2) ?? '—'} />
              <Stat label="Press/g" value={t.avg_pressures_per_match?.toFixed(0) ?? '—'} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 border-t border-surface-4/60 pt-2">
              <Stat label="Pass %" value={t.pass_completion_rate != null ? `${Math.round(t.pass_completion_rate * 100)}%` : '—'} />
              <Stat label="Carry/g" value={t.avg_carries_per_match?.toFixed(0) ?? '—'} />
              <Stat label="Chaos" value={t.chaos_index?.toFixed(2) ?? '—'} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Players tab
// ---------------------------------------------------------------------------

const POSITIONS: Record<string, string> = {
  Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Offence: 'FWD',
}

function PlayersTab({ players }: { players: Player[] }) {
  const [query, setQuery] = useState('')
  const [posFilter, setPosFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return players.filter((p) => {
      if (posFilter !== 'all' && p.position !== posFilter) return false
      if (q && !p.name.toLowerCase().includes(q) && !p.team_id.toLowerCase().includes(q)) return false
      return true
    })
  }, [players, query, posFilter])

  const positions = useMemo(() => {
    const set = new Set(players.map((p) => p.position).filter(Boolean) as string[])
    return [...set].sort()
  }, [players])

  if (players.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-4 px-6 py-16 text-center">
        <p className="text-sm text-slate-400">No squad data yet.</p>
        <p className="mt-1 text-xs text-slate-500">Run "Sync Squads & Coaches" from Admin to populate player rosters.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        WC 2026 squads. Players with WC 2022 StatsBomb data show full analytics — click to explore their heatmap, passing network, and shot map.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players or teams…"
          className="w-48 rounded-lg border border-surface-4 px-3 py-1.5 text-sm"
        />
        <select
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value)}
          className="rounded-lg border border-surface-4 px-3 py-1.5 text-sm"
        >
          <option value="all">All positions</option>
          {positions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{filtered.length} players</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-4 bg-surface-2/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Player</th>
              <th className="px-4 py-2.5">Team</th>
              <th className="px-4 py-2.5">Pos</th>
              <th className="px-4 py-2.5">Nation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-4/40">
            {filtered.slice(0, 200).map((p) => (
              <tr key={`${p.team_id}-${p.name}`} className="group transition hover:bg-surface-3">
                <td className="px-4 py-2 tabular-nums text-slate-500">{p.shirt_number ?? '—'}</td>
                <td className="px-4 py-2">
                  <Link
                    to={`/player/${encodeURIComponent(p.name)}`}
                    className="font-medium text-slate-200 group-hover:text-pitch-400 transition"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <Link
                    to={`/team/${p.team_id}`}
                    className="text-slate-400 hover:text-slate-200 transition"
                  >
                    {p.team_id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <span className="rounded bg-surface-4/60 px-1.5 py-0.5 text-[11px] font-semibold text-slate-300">
                    {POSITIONS[p.position ?? ''] ?? p.position ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-400">{p.nationality ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <div className="border-t border-surface-4 bg-surface-2/50 px-4 py-2 text-xs text-slate-500">
            Showing first 200 of {filtered.length} — refine your search to see more.
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Coaches tab
// ---------------------------------------------------------------------------

function CoachesTab({ coaches }: { coaches: Coach[] }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? coaches.filter(
          (c) =>
            (c.coach_name ?? '').toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            (c.coach_nationality ?? '').toLowerCase().includes(q),
        )
      : coaches
  }, [coaches, query])

  if (coaches.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-4 px-6 py-16 text-center">
        <p className="text-sm text-slate-400">No coach data yet.</p>
        <p className="mt-1 text-xs text-slate-500">Run "Sync Squads & Coaches" from Admin.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search coaches or teams…"
        className="w-48 rounded-lg border border-surface-4 px-3 py-1.5 text-sm"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <Link
            key={c.id}
            to={`/team/${c.id}`}
            className="group flex items-center gap-3 rounded-xl border border-surface-4/70 bg-surface-2 p-4 transition hover:border-pitch-600/50 hover:bg-surface-3"
          >
            {c.crest_url ? (
              <img src={c.crest_url} alt={c.name} className="h-10 w-10 rounded object-contain" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-surface-3 text-xl">🏴</div>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-100 group-hover:text-pitch-400 transition">{c.name}</p>
              {c.coach_name ? (
                <p className="truncate text-sm text-slate-400">{c.coach_name}</p>
              ) : (
                <p className="text-sm text-slate-600 italic">No coach data</p>
              )}
              {c.coach_nationality && (
                <p className="text-xs text-slate-500">{c.coach_nationality}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'teams' | 'players' | 'coaches'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'teams',   label: 'Teams',   icon: '🏴' },
  { id: 'players', label: 'Players', icon: '👟' },
  { id: 'coaches', label: 'Coaches', icon: '🎓' },
]

export default function Analytics() {
  const [tab, setTab] = useState<Tab>('teams')
  const [teamAnalytics, setTeamAnalytics] = useState<TeamAnalytics[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [taRes, plRes, coRes] = await Promise.all([
        supabase
          .from('team_analytics')
          .select('team_name,avg_passes_per_match,avg_xg_per_match,avg_pressures_per_match,avg_carries_per_match,pass_completion_rate,chaos_index,matches_in_sample')
          .order('avg_passes_per_match', { ascending: false }),
        supabase
          .from('players')
          .select('name,team_id,position,shirt_number,nationality')
          .order('team_id,shirt_number'),
        supabase
          .from('teams')
          .select('id,name,coach_name,coach_nationality,crest_url')
          .order('name'),
      ])
      setTeamAnalytics((taRes.data ?? []) as TeamAnalytics[])
      setPlayers((plRes.data ?? []) as Player[])
      setCoaches((coRes.data ?? []) as Coach[])
      setLoading(false)
    }
    void load()
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Analytics</h1>
        <p className="text-sm text-slate-400">
          Explore WC 2026 teams, players, and coaches. Team metrics aggregate WC 2018 · WC 2022 · Euro 2020 · Euro 2024 · Copa América 2024 (StatsBomb open data).
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-surface-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id
                ? 'border-pitch-600 text-pitch-400'
                : 'border-transparent text-slate-500 hover:border-slate-600 hover:text-slate-200'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
            {t.id === 'teams' && teamAnalytics.length > 0 && (
              <span className="ml-0.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-slate-400">
                {teamAnalytics.length}
              </span>
            )}
            {t.id === 'players' && players.length > 0 && (
              <span className="ml-0.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-slate-400">
                {players.length}
              </span>
            )}
            {t.id === 'coaches' && coaches.length > 0 && (
              <span className="ml-0.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] text-slate-400">
                {coaches.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Loading analytics…" />
      ) : (
        <>
          {tab === 'teams'   && <TeamsTab   teams={teamAnalytics} />}
          {tab === 'players' && <PlayersTab players={players} />}
          {tab === 'coaches' && <CoachesTab coaches={coaches} />}
        </>
      )}
    </div>
  )
}
