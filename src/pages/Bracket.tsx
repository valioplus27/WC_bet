import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { stageLabel, sortStages, type Match } from '../types/models'
import { formatKickoff, matchStatusBadge } from '../lib/format'
import type { Prediction } from '../types/models'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function outcome(m: Match): 'home' | 'away' | 'draw' | null {
  if (m.home_score === null || m.away_score === null) return null
  if (m.home_score > m.away_score) return 'home'
  if (m.home_score < m.away_score) return 'away'
  return 'draw'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProbBar({
  homeWin,
  draw,
  awayWin,
  homeTeam,
  awayTeam,
}: {
  homeWin: number
  draw: number
  awayWin: number
  homeTeam: string
  awayTeam: string
}) {
  const hw = Math.round(homeWin * 100)
  const d  = Math.round(draw * 100)
  const aw = Math.round(awayWin * 100)

  // Determine favourite and margin
  const maxProb = Math.max(homeWin, draw, awayWin)
  const isToss  = maxProb < 0.40
  let favouriteLabel = ''
  if (!isToss) {
    if (homeWin === maxProb) favouriteLabel = `${homeTeam.split(' ')[0]} favoured ${hw}%`
    else if (awayWin === maxProb) favouriteLabel = `${awayTeam.split(' ')[0]} favoured ${aw}%`
    else favouriteLabel = `Draw likely ${d}%`
  }

  return (
    <div className="mt-3 space-y-1.5">
      {favouriteLabel ? (
        <p className="text-[11px] font-semibold text-slate-600">{favouriteLabel}</p>
      ) : (
        <p className="text-[11px] text-slate-400">Coin flip — very evenly matched</p>
      )}
      <div className="flex h-2.5 overflow-hidden rounded-full">
        <div style={{ width: `${hw}%` }} className="bg-blue-500" title={`${homeTeam} win ${hw}%`} />
        <div style={{ width: `${d}%`  }} className="bg-slate-300" title={`Draw ${d}%`} />
        <div style={{ width: `${aw}%` }} className="bg-orange-400" title={`${awayTeam} win ${aw}%`} />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-400">
        <span className="font-semibold text-blue-600">{hw}%</span>
        <span className="text-slate-400">Draw {d}%</span>
        <span className="font-semibold text-orange-500">{aw}%</span>
      </div>
    </div>
  )
}

function MatchCard({ match, pred }: { match: Match; pred: Prediction | undefined }) {
  const result = outcome(match)
  const hasScore = match.home_score !== null
  const isLive = match.status === 'IN_PLAY' || match.status === 'PAUSED'
  const badge = matchStatusBadge(match.status)

  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm ${
        isLive ? 'border-red-200 ring-1 ring-red-200' : 'border-slate-200'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <time dateTime={match.kickoff_at}>{formatKickoff(match.kickoff_at)}</time>
        {isLive ? (
          <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
        ) : badge ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Home team */}
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm font-semibold ${
              result === 'home' ? 'text-pitch-700' : result !== null ? 'text-slate-400' : 'text-slate-900'
            }`}
          >
            {match.home_team}
          </span>
        </div>

        {/* Score or vs */}
        {hasScore ? (
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-base font-bold tabular-nums ${
              isLive ? 'bg-red-50 text-red-900' : 'bg-slate-100 text-slate-900'
            }`}
          >
            <span>{match.home_score}</span>
            <span className={isLive ? 'text-red-300' : 'text-slate-400'}>–</span>
            <span>{match.away_score}</span>
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 px-3 py-1 text-xs font-medium text-slate-400">vs</div>
        )}

        {/* Away team */}
        <div className="flex items-center justify-end gap-2">
          <span
            className={`truncate text-right text-sm font-semibold ${
              result === 'away' ? 'text-pitch-700' : result !== null ? 'text-slate-400' : 'text-slate-900'
            }`}
          >
            {match.away_team}
          </span>
        </div>
      </div>

      {/* Prediction bar for upcoming matches */}
      {!hasScore && pred && (
        <ProbBar
          homeWin={pred.home_win_prob}
          draw={pred.draw_prob}
          awayWin={pred.away_win_prob}
          homeTeam={match.home_team}
          awayTeam={match.away_team}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reliability diagram (SVG)
// ---------------------------------------------------------------------------

type CalibrationBucket = { mid: number; actualFrac: number; n: number }

function buildCalibrationData(predictions: Prediction[]): CalibrationBucket[] {
  const resolved = predictions.filter((p) => p.actual_outcome !== null)
  if (resolved.length < 5) return []

  // Flatten all (predicted_prob, correct?) pairs across the three outcomes
  const pairs: { pred: number; actual: number }[] = []
  for (const p of resolved) {
    pairs.push({ pred: p.home_win_prob, actual: p.actual_outcome === 'home_win' ? 1 : 0 })
    pairs.push({ pred: p.draw_prob,     actual: p.actual_outcome === 'draw'     ? 1 : 0 })
    pairs.push({ pred: p.away_win_prob, actual: p.actual_outcome === 'away_win' ? 1 : 0 })
  }

  const BINS = 10
  const buckets: { sum: number; count: number; actualSum: number }[] = Array.from({ length: BINS }, () => ({
    sum: 0, count: 0, actualSum: 0,
  }))

  for (const { pred, actual } of pairs) {
    const bin = Math.min(Math.floor(pred * BINS), BINS - 1)
    buckets[bin].sum += pred
    buckets[bin].count++
    buckets[bin].actualSum += actual
  }

  return buckets
    .map((b, i): CalibrationBucket => ({
      mid: (i + 0.5) / BINS,
      actualFrac: b.count > 0 ? b.actualSum / b.count : (i + 0.5) / BINS,
      n: b.count,
    }))
    .filter((b) => b.n >= 3)
}

function ReliabilityDiagram({ predictions }: { predictions: Prediction[] }) {
  const buckets = buildCalibrationData(predictions)
  const resolved = predictions.filter((p) => p.actual_outcome !== null)

  if (resolved.length < 10) {
    return (
      <p className="text-xs text-slate-400">
        Reliability diagram appears once ≥ 10 knockout matches have resolved.
      </p>
    )
  }

  const W = 220, H = 220, PAD = 32

  const toX = (v: number) => PAD + v * (W - PAD * 2)
  const toY = (v: number) => H - PAD - v * (H - PAD * 2)

  return (
    <svg width={W} height={H} className="overflow-visible">
      {/* Axes */}
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#e2e8f0" strokeWidth={1} />
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#e2e8f0" strokeWidth={1} />

      {/* Reference diagonal */}
      <line
        x1={toX(0)} y1={toY(0)}
        x2={toX(1)} y2={toY(1)}
        stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 4"
      />

      {/* Axis labels */}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">Predicted probability</text>
      <text
        x={8} y={H / 2}
        textAnchor="middle" fontSize={9} fill="#94a3b8"
        transform={`rotate(-90, 8, ${H / 2})`}
      >
        Actual fraction
      </text>

      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((v) => (
        <g key={v}>
          <line x1={PAD} y1={toY(v)} x2={W - PAD} y2={toY(v)} stroke="#f1f5f9" strokeWidth={1} />
          <line x1={toX(v)} y1={PAD} x2={toX(v)} y2={H - PAD} stroke="#f1f5f9" strokeWidth={1} />
          <text x={PAD - 3} y={toY(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{Math.round(v * 100)}%</text>
          <text x={toX(v)} y={H - PAD + 10} textAnchor="middle" fontSize={8} fill="#94a3b8">{Math.round(v * 100)}%</text>
        </g>
      ))}

      {/* Bucket dots */}
      {buckets.map((b, i) => (
        <g key={i}>
          <circle
            cx={toX(b.mid)} cy={toY(b.actualFrac)}
            r={Math.min(Math.sqrt(b.n) * 2, 8)}
            fill="#16a34a" opacity={0.7}
          />
          <title>{`Predicted ≈${Math.round(b.mid * 100)}%, Actual ${Math.round(b.actualFrac * 100)}% (n=${b.n})`}</title>
        </g>
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Bracket() {
  const { matches, loading: matchesLoading } = useMatches()
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [predsLoading, setPredsLoading] = useState(true)

  useEffect(() => {
    supabase.from('predictions').select('*').then(({ data }) => {
      setPredictions(data ?? [])
      setPredsLoading(false)
    })
    const ch = supabase
      .channel('bracket-predictions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'predictions' }, () => {
        supabase.from('predictions').select('*').then(({ data }) => setPredictions(data ?? []))
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [])

  const predByMatch = useMemo(() => {
    const m = new Map<number, Prediction>()
    for (const p of predictions) m.set(p.match_id, p)
    return m
  }, [predictions])

  const knockoutMatches = useMemo(
    () => matches.filter((m) => m.stage !== 'GROUP_STAGE'),
    [matches],
  )

  const byStage = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of knockoutMatches) {
      const list = map.get(m.stage) ?? []
      list.push(m)
      map.set(m.stage, list)
    }
    // Sort within each stage by kickoff time
    for (const list of map.values()) list.sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime())
    return map
  }, [knockoutMatches])

  const orderedStages = useMemo(() => sortStages([...byStage.keys()]), [byStage])

  const resolvedPreds = useMemo(() => predictions.filter((p) => p.actual_outcome !== null), [predictions])
  const avgBrier = useMemo(() => {
    if (resolvedPreds.length === 0) return null
    return resolvedPreds.reduce((s, p) => s + (p.brier_score ?? 0), 0) / resolvedPreds.length
  }, [resolvedPreds])
  const avgLogLoss = useMemo(() => {
    if (resolvedPreds.length === 0) return null
    return resolvedPreds.reduce((s, p) => s + (p.log_loss ?? 0), 0) / resolvedPreds.length
  }, [resolvedPreds])

  if (matchesLoading || predsLoading) return <Spinner label="Loading bracket…" />

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Knockout Bracket</h1>
        <p className="text-sm text-slate-500">
          WC 2026 — Round of 32 to the Final. Probability bars (blue = home win, grey = draw, orange = away win)
          are generated by a Poisson model trained on WC 2026 group-stage results.
        </p>
      </div>

      {knockoutMatches.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
          Knockout-stage fixtures haven't been set up yet — check back once the group stage is complete.
        </p>
      )}

      {/* Rounds */}
      {orderedStages.map((stage) => {
        const stageMatches = byStage.get(stage) ?? []
        const cols = stageMatches.length === 1 ? 'sm:grid-cols-1 max-w-sm mx-auto' : 'sm:grid-cols-2'
        return (
          <section key={stage}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
              {stageLabel(stage)}
            </h2>
            <div className={`grid gap-3 ${cols}`}>
              {stageMatches.map((m) => (
                <MatchCard key={m.id} match={m} pred={predByMatch.get(m.id)} />
              ))}
            </div>
          </section>
        )
      })}

      {/* Model calibration card */}
      {predictions.length > 0 && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-base font-semibold text-slate-900">How accurate is the model?</h2>
            <p className="text-xs text-slate-500">
              Probabilities come from a Poisson model (Dixon-Coles) trained on WC 2026 group-stage results.
              Brier score and log-loss measure accuracy on resolved knockouts — lower is better.
              A Brier score below 0.2 and log-loss below 0.6 is considered good for football.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <p className="text-2xl font-bold text-slate-900">{predictions.length}</p>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Knockout matches predicted</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <p className={`text-2xl font-bold ${avgBrier !== null && avgBrier < 0.2 ? 'text-pitch-700' : 'text-slate-900'}`}>
                {avgBrier !== null ? avgBrier.toFixed(3) : '—'}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Brier score</p>
              <p className="text-[9px] text-slate-300">0 = perfect · 0.67 = random</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3">
              <p className={`text-2xl font-bold ${avgLogLoss !== null && avgLogLoss < 0.6 ? 'text-pitch-700' : 'text-slate-900'}`}>
                {avgLogLoss !== null ? avgLogLoss.toFixed(3) : '—'}
              </p>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Log-loss</p>
              <p className="text-[9px] text-slate-300">0 = perfect · 1.1 = random</p>
            </div>
          </div>

          {resolvedPreds.length > 0 && (
            <p className="text-xs text-slate-400">
              Based on <span className="font-semibold text-slate-700">{resolvedPreds.length}</span> resolved knockout match{resolvedPreds.length === 1 ? '' : 'es'}.
              The reliability diagram below compares predicted probabilities to actual outcomes — dots on the dashed line = perfectly calibrated.
            </p>
          )}
          <ReliabilityDiagram predictions={predictions} />
        </section>
      )}
    </div>
  )
}
