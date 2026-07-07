// ============================================================================
// CoachPage — profile for a national-team head coach.
// Route: /coach/:slug   (slug = team id, since coaches are 1:1 with teams)
//
// Two parts:
//   1. Playing style — derived deterministically from the team's StatsBomb
//      analytics, expressed as percentile ranks against all analysed teams so
//      it needs no hard-coded thresholds.
//   2. Who is this — an optional AI-generated concise bio (coach-bio edge
//      function). Degrades gracefully when ANTHROPIC_API_KEY isn't set.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { slugify } from '../lib/providers/SupabaseAdapter'
import { Spinner } from '../components/Spinner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TeamRow = {
  id: string
  name: string
  coach_name: string | null
  coach_nationality: string | null
  crest_url: string | null
}

type Analytics = {
  team_name: string
  avg_passes_per_match: number | null
  pass_completion_rate: number | null
  avg_pressures_per_match: number | null
  avg_carries_per_match: number | null
  avg_xg_per_match: number | null
  network_centralization: number | null
  chaos_index: number | null
  matches_in_sample: number
}

// ---------------------------------------------------------------------------
// Percentile helpers
// ---------------------------------------------------------------------------

/** Fraction (0–1) of `all` values that are ≤ `v`. */
function percentile(all: number[], v: number): number {
  if (all.length === 0) return 0.5
  const below = all.filter((x) => x <= v).length
  return below / all.length
}

type Trait = { label: string; pct: number; blurb: string }

function buildTraits(mine: Analytics, all: Analytics[]): Trait[] {
  const col = (key: keyof Analytics) =>
    all.map((a) => a[key]).filter((x): x is number => typeof x === 'number')

  const traits: Trait[] = []

  const push = (
    label: string,
    key: keyof Analytics,
    high: string,
    mid: string,
    low: string,
  ) => {
    const v = mine[key]
    if (typeof v !== 'number') return
    const pct = percentile(col(key), v)
    const blurb = pct >= 0.66 ? high : pct <= 0.33 ? low : mid
    traits.push({ label, pct, blurb })
  }

  push('Possession', 'avg_passes_per_match',
    'patient, possession-heavy build-up', 'a balanced share of the ball', 'a direct, low-volume passing game')
  push('Passing accuracy', 'pass_completion_rate',
    'very secure in possession', 'reliable passing', 'a higher-risk, vertical passing style')
  push('Pressing', 'avg_pressures_per_match',
    'an aggressive, high press', 'moderate pressing', 'a compact, reactive block')
  push('Ball carrying', 'avg_carries_per_match',
    'lots of forward carrying', 'occasional dribbling runs', 'quick ball movement over dribbling')
  push('Chance creation', 'avg_xg_per_match',
    'a potent, chance-heavy attack', 'a steady attacking output', 'a cautious, low-chance attack')
  push('Playmaking shape', 'network_centralization',
    'a side built around a key playmaker', 'a fairly even passing spread', 'distribution shared widely across the XI')
  push('Predictability', 'chaos_index',
    'a high-variance, unpredictable team', 'a fairly consistent team', 'a controlled, low-variance team')

  return traits
}

function styleParagraph(coach: string, team: string, traits: Trait[]): string {
  if (traits.length === 0) return ''
  const strong = traits.filter((t) => t.pct >= 0.66).slice(0, 3).map((t) => t.blurb)
  const weak = traits.filter((t) => t.pct <= 0.33).slice(0, 2).map((t) => t.blurb)
  const parts: string[] = []
  const who = coach || `${team}'s coach`
  if (strong.length) parts.push(`Under ${who}, ${team} are defined by ${joinList(strong)}.`)
  if (weak.length)  parts.push(`By contrast, they lean towards ${joinList(weak)}.`)
  if (parts.length === 0) parts.push(`${team} sit around the tournament average across most tactical metrics.`)
  return parts.join(' ')
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

// ---------------------------------------------------------------------------
// Trait bar
// ---------------------------------------------------------------------------

function TraitBar({ trait }: { trait: Trait }) {
  const pct = Math.round(trait.pct * 100)
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-300">{trait.label}</span>
        <span className="tabular-nums text-slate-500">{pct}th pct</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-2 rounded-full bg-pitch-600"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-400">{trait.blurb}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AI bio block
// ---------------------------------------------------------------------------

function CoachBio({ team }: { team: TeamRow }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')

  async function generate() {
    setState('loading')
    setErr('')
    try {
      const { data, error } = await supabase.functions.invoke('coach-bio', {
        body: {
          coach: team.coach_name,
          nationality: team.coach_nationality,
          team: team.name,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setText(data.bio ?? '')
      setState('done')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not generate bio.')
      setState('error')
    }
  }

  if (!team.coach_name) return null

  return (
    <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-100">Who is {team.coach_name}?</h2>
        {state === 'idle' && (
          <button
            type="button"
            onClick={generate}
            className="rounded-lg border border-pitch-600/50 bg-pitch-600/10 px-3 py-1.5 text-xs font-semibold text-pitch-300 transition hover:bg-pitch-600/20"
          >
            ✨ Generate bio
          </button>
        )}
      </div>
      {state === 'loading' && <p className="text-xs text-slate-400">Writing a short bio…</p>}
      {state === 'done' && <p className="text-sm leading-relaxed text-slate-300">{text}</p>}
      {state === 'error' && (
        <p className="text-xs text-amber-400">
          {err.includes('ANTHROPIC_API_KEY')
            ? 'AI bios need an Anthropic API key configured on the server.'
            : err}
        </p>
      )}
      {state === 'idle' && (
        <p className="text-xs text-slate-500">
          A concise, AI-written summary of {team.coach_name}’s background and coaching career.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CoachPage() {
  const { slug } = useParams<{ slug: string }>()
  const [team, setTeam] = useState<TeamRow | null>(null)
  const [mine, setMine] = useState<Analytics | null>(null)
  const [all, setAll] = useState<Analytics[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    Promise.all([
      supabase.from('teams').select('id,name,coach_name,coach_nationality,crest_url').eq('id', slug).maybeSingle(),
      supabase
        .from('team_analytics')
        .select('team_name,avg_passes_per_match,pass_completion_rate,avg_pressures_per_match,avg_carries_per_match,avg_xg_per_match,network_centralization,chaos_index,matches_in_sample'),
    ]).then(([tRes, aRes]) => {
      const t = (tRes.data ?? null) as TeamRow | null
      const analytics = (aRes.data ?? []) as Analytics[]
      setTeam(t)
      setAll(analytics)
      if (t) {
        const match = analytics.find(
          (a) => a.team_name === t.name || slugify(a.team_name) === slug,
        )
        setMine(match ?? null)
      }
      setLoading(false)
    })
  }, [slug])

  const traits = useMemo(
    () => (mine && all.length ? buildTraits(mine, all) : []),
    [mine, all],
  )

  if (loading) return <Spinner label="Loading coach…" />

  if (!team) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link to="/analytics" className="text-xs text-pitch-400 hover:underline">← Back to analytics</Link>
        <div className="rounded-xl border border-surface-4/70 bg-surface-2 px-6 py-10 text-center">
          <p className="text-3xl">🎓</p>
          <p className="mt-3 text-base font-semibold text-slate-100">Coach not found</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
            This team isn’t in the World Cup 2026 database yet.
          </p>
        </div>
      </div>
    )
  }

  const teamPretty = team.name

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/analytics" className="text-xs text-pitch-400 hover:underline">← Analytics</Link>
        <div className="mt-3 flex items-center gap-4">
          {team.crest_url ? (
            <img src={team.crest_url} alt={team.name} className="h-14 w-14 rounded object-contain" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded bg-surface-3 text-2xl">🎓</div>
          )}
          <div>
            <h1 className="text-2xl font-black text-slate-100">
              {team.coach_name ?? 'Head coach not set'}
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">
              Head coach ·{' '}
              <Link to={`/team/${team.id}`} className="text-pitch-400 hover:underline">
                {teamPretty}
              </Link>
              {team.coach_nationality ? ` · ${team.coach_nationality}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* AI bio */}
      <CoachBio team={team} />

      {/* Playing style */}
      <section className="rounded-xl border border-surface-4/70 bg-surface-2 p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Playing style</h2>
        {mine ? (
          <>
            <p className="mb-4 text-sm leading-relaxed text-slate-300">
              {styleParagraph(team.coach_name ?? '', teamPretty, traits)}
            </p>
            <p className="mb-3 text-[11px] text-slate-500">
              Percentiles rank {teamPretty} against all {all.length} teams in our StatsBomb sample
              ({mine.matches_in_sample} matches). Higher = more of that trait.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {traits.map((t) => (
                <TraitBar key={t.label} trait={t} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            We don’t have historical event data for {teamPretty} yet, so a tactical profile isn’t
            available. It will appear once the team features in a tournament we track.
          </p>
        )}
      </section>
    </div>
  )
}
