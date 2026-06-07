import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { isLocked, picksMatch, type TournamentBet as TournamentBetRow, type TournamentConfig } from '../types/models'
import { formatDateTime } from '../lib/format'

type Picks = {
  pick_first: string
  pick_second: string
  pick_third: string
  pick_top_scorer: string
}

export default function TournamentBet() {
  const { session } = useAuth()
  const userId = session?.user.id
  const { matches } = useMatches()
  const [config, setConfig] = useState<TournamentConfig | null>(null)
  const [myBet, setMyBet] = useState<TournamentBetRow | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const { data: configData } = await supabase.from('tournament_config').select('*').eq('id', 1).maybeSingle()
    setConfig(configData)
    if (userId) {
      const { data: betData } = await supabase.from('tournament_bets').select('*').eq('user_id', userId).maybeSingle()
      setMyBet(betData)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // The admin records official results by editing tournament_config — refresh
  // so "your podium pick was right!" appears the moment that happens.
  useEffect(() => {
    const channel = supabase
      .channel('tournament-config-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_config' }, () => void loadData())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadData])

  const teams = useMemo(() => {
    const set = new Set<string>()
    for (const match of matches) {
      set.add(match.home_team)
      set.add(match.away_team)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [matches])

  const handleSave = useCallback(
    async (picks: Picks): Promise<string | null> => {
      if (!userId) return 'You need to be signed in to bet.'
      const { data, error } = await supabase
        .from('tournament_bets')
        .upsert({ user_id: userId, ...picks }, { onConflict: 'user_id' })
        .select()
        .single()

      if (error) {
        if (error.code === '23514') return 'Pick three different countries for the podium.'
        if (error.code === '42501' || /row-level security/i.test(error.message)) {
          return 'Tournament bets are locked — the cutoff has passed.'
        }
        return error.message
      }
      setMyBet(data)
      return null
    },
    [userId],
  )

  if (loading) return <Spinner label="Loading tournament bet…" />
  if (!config) {
    return <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">Tournament configuration hasn't been set up yet — ask an admin.</p>
  }

  const locked = isLocked(config.lock_at)

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Tournament bet</h1>
        <p className="text-sm text-slate-500">
          Pick the podium and the Golden Boot winner — once, before the tournament starts. No edits after lock.
        </p>
      </div>

      <div className={`rounded-lg border px-4 py-2.5 text-sm ${locked ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-pitch-200 bg-pitch-50 text-pitch-800'}`}>
        {locked ? (
          <>🔒 Locked since <strong>{formatDateTime(config.lock_at)}</strong> — picks are final.</>
        ) : (
          <>⏳ Locks at <strong>{formatDateTime(config.lock_at)}</strong> — you can change your picks until then.</>
        )}
      </div>

      <PointsLegend config={config} />

      {locked ? (
        <LockedView bet={myBet} config={config} />
      ) : teams.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Team list isn't available yet — once fixtures are synced, the podium pickers will populate here.
        </p>
      ) : (
        <TournamentBetForm teams={teams} initialBet={myBet} onSave={handleSave} />
      )}
    </div>
  )
}

function PointsLegend({ config }: { config: TournamentConfig }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <dt className="text-slate-500">Per podium country, correct position</dt>
        <dd className="text-base font-semibold text-slate-900">{config.points_podium_correct_position} pts</dd>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <dt className="text-slate-500">Correct top scorer</dt>
        <dd className="text-base font-semibold text-slate-900">{config.points_top_scorer} pts</dd>
      </div>
    </dl>
  )
}

function TournamentBetForm({
  teams,
  initialBet,
  onSave,
}: {
  teams: string[]
  initialBet: TournamentBetRow | null
  onSave: (picks: Picks) => Promise<string | null>
}) {
  const [first, setFirst] = useState(initialBet?.pick_first ?? '')
  const [second, setSecond] = useState(initialBet?.pick_second ?? '')
  const [third, setThird] = useState(initialBet?.pick_third ?? '')
  const [scorer, setScorer] = useState(initialBet?.pick_top_scorer ?? '')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  function handleFirstChange(value: string) {
    setFirst(value)
    if (second === value) setSecond('')
    if (third === value) setThird('')
  }
  function handleSecondChange(value: string) {
    setSecond(value)
    if (third === value) setThird('')
  }

  const canSubmit = Boolean(first && second && third && scorer.trim()) && !saving

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setFeedback(null)
    const error = await onSave({
      pick_first: first,
      pick_second: second,
      pick_third: third,
      pick_top_scorer: scorer.trim(),
    })
    setSaving(false)
    setFeedback(error ? { kind: 'error', message: error } : { kind: 'ok', message: 'Tournament bet saved ✓' })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">Podium — pick the top 3 finishers</legend>
        <PodiumSelect label="🥇 1st place" value={first} options={teams} onChange={handleFirstChange} />
        <PodiumSelect label="🥈 2nd place" value={second} options={teams.filter((team) => team !== first)} onChange={handleSecondChange} />
        <PodiumSelect label="🥉 3rd place" value={third} options={teams.filter((team) => team !== first && team !== second)} onChange={setThird} />
      </fieldset>

      <div>
        <label htmlFor="topScorer" className="block text-sm font-semibold text-slate-900">
          ⚽ Top scorer (Golden Boot)
        </label>
        <input
          id="topScorer"
          type="text"
          required
          maxLength={80}
          value={scorer}
          onChange={(event) => setScorer(event.target.value)}
          placeholder="Player's full name, e.g. Kylian Mbappé"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
        />
        <p className="mt-1 text-xs text-slate-400">Spelling/capitalization don't have to be perfect — matching ignores case and extra spaces.</p>
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.kind === 'error' ? 'text-red-600' : 'text-pitch-700'}`} role="status">
          {feedback.message}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving…' : initialBet ? 'Update tournament bet' : 'Save tournament bet'}
      </button>
    </form>
  )
}

function PodiumSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
      <span className="font-medium">{label}</span>
      <select
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-48 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
      >
        <option value="" disabled>
          Select a country…
        </option>
        {options.map((team) => (
          <option key={team} value={team}>
            {team}
          </option>
        ))}
      </select>
    </label>
  )
}

function LockedView({ bet, config }: { bet: TournamentBetRow | null; config: TournamentConfig }) {
  if (!bet) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
        You didn't place a tournament bet before the lock — it's not possible to add one now.
      </p>
    )
  }

  const resultsKnown = Boolean(config.actual_first && config.actual_second && config.actual_third && config.actual_top_scorer)

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <PickRow label="🥇 1st place" pick={bet.pick_first} actual={config.actual_first} resultsKnown={resultsKnown} />
      <PickRow label="🥈 2nd place" pick={bet.pick_second} actual={config.actual_second} resultsKnown={resultsKnown} />
      <PickRow label="🥉 3rd place" pick={bet.pick_third} actual={config.actual_third} resultsKnown={resultsKnown} />
      <PickRow label="⚽ Top scorer" pick={bet.pick_top_scorer} actual={config.actual_top_scorer} resultsKnown={resultsKnown} />

      <div className="border-t border-slate-100 pt-3 text-sm">
        {bet.points_awarded !== null ? (
          <p className="font-semibold text-slate-900">
            Total: <span className="text-pitch-700">{bet.points_awarded} points</span>
          </p>
        ) : (
          <p className="text-slate-400">Points will be revealed once the admin records the final tournament results.</p>
        )}
      </div>
    </div>
  )
}

function PickRow({ label, pick, actual, resultsKnown }: { label: string; pick: string; actual: string | null; resultsKnown: boolean }) {
  const correct = resultsKnown && picksMatch(pick, actual)
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-semibold text-slate-900">{pick}</span>
        {resultsKnown && <Indicator correct={correct} />}
      </span>
    </div>
  )
}

function Indicator({ correct }: { correct: boolean }): ReactNode {
  return correct ? (
    <span className="rounded-full bg-pitch-50 px-2 py-0.5 text-xs font-semibold text-pitch-700">✓ correct</span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-400">✗ incorrect</span>
  )
}
