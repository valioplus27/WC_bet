// ============================================================================
// Upset Radar — fixtures ranked by crowd-vs-model divergence.
//
// For each upcoming match with both a model prediction and user picks:
//   Crowd pick = majority predicted outcome (from bets)
//   Model favourite = outcome with highest probability
//   Divergence score = |crowd_favourite_pct - model_prob| for the crowd's choice
//
// High divergence = crowd is very confident but model disagrees (upset risk)
// or crowd is hedging on a match the model considers decided.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMatches } from '../hooks/useMatches'
import { Spinner } from '../components/Spinner'
import { isLocked, stageLabel, type Bet, type Prediction } from '../types/models'
import { formatKickoff } from '../lib/format'

type MatchInsight = {
  matchId: number
  homeTeam: string
  awayTeam: string
  stage: string
  kickoffAt: string
  // Model
  modelFavourite: 'home' | 'draw' | 'away'
  modelFavProb: number
  homeWinP: number
  drawP: number
  awayWinP: number
  // Crowd
  crowdFavourite: 'home' | 'draw' | 'away'
  crowdFavPct: number
  totalPicks: number
  homePickPct: number
  drawPickPct: number
  awayPickPct: number
  // Divergence
  divergence: number        // 0–1, higher = more disagreement
  isUpsetRisk: boolean      // crowd likes team model doesn't
}

function ProbBar({ left, mid, right }: {
  left: number; mid: number; right: number
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex h-2.5 overflow-hidden rounded-full">
        <div style={{ width: `${left * 100}%` }} className="bg-blue-500" />
        <div style={{ width: `${mid * 100}%` }} className="bg-slate-500" />
        <div style={{ width: `${right * 100}%` }} className="bg-orange-400" />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
        <span className="text-blue-400">{Math.round(left * 100)}%</span>
        <span>Draw {Math.round(mid * 100)}%</span>
        <span className="text-orange-400">{Math.round(right * 100)}%</span>
      </div>
    </div>
  )
}

function DivergenceMeter({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score > 0.35 ? 'bg-red-500' : score > 0.20 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-4/50">
        <div style={{ width: `${Math.min(pct, 100)}%` }} className={`h-full rounded-full ${color} transition-all`} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${score > 0.35 ? 'text-red-400' : score > 0.20 ? 'text-amber-400' : 'text-green-400'}`}>
        {pct}%
      </span>
    </div>
  )
}

export default function UpsetRadar() {
  const { matches } = useMatches()
  const [bets, setBets] = useState<Bet[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('bets').select('*'),
      supabase.from('predictions').select('*'),
    ]).then(([betsRes, predsRes]) => {
      setBets(betsRes.data ?? [])
      setPredictions(predsRes.data ?? [])
      setLoading(false)
    })
  }, [])

  const predByMatch = useMemo(() => {
    const m = new Map<number, Prediction>()
    for (const p of predictions) m.set(p.match_id, p)
    return m
  }, [predictions])

  const betsByMatch = useMemo(() => {
    const m = new Map<number, Bet[]>()
    for (const b of bets) {
      const list = m.get(b.match_id) ?? []
      list.push(b)
      m.set(b.match_id, list)
    }
    return m
  }, [bets])

  const insights = useMemo((): MatchInsight[] => {
    const upcoming = matches.filter((m) => !isLocked(m.kickoff_at) && m.home_team !== 'TBD')
    const result: MatchInsight[] = []

    for (const m of upcoming) {
      const pred = predByMatch.get(m.id)
      if (!pred) continue

      const matchBets = betsByMatch.get(m.id) ?? []
      if (matchBets.length < 3) continue  // not enough crowd data

      // Crowd distribution
      let homeCount = 0, drawCount = 0, awayCount = 0
      for (const b of matchBets) {
        if (b.predicted_home > b.predicted_away)       homeCount++
        else if (b.predicted_home === b.predicted_away) drawCount++
        else                                            awayCount++
      }
      const total = matchBets.length
      const homePickPct = homeCount / total
      const drawPickPct = drawCount / total
      const awayPickPct = awayCount / total

      let crowdFavourite: 'home' | 'draw' | 'away' = 'home'
      let crowdFavPct = homePickPct
      if (drawPickPct > crowdFavPct) { crowdFavourite = 'draw'; crowdFavPct = drawPickPct }
      if (awayPickPct > crowdFavPct) { crowdFavourite = 'away'; crowdFavPct = awayPickPct }

      // Model favourite
      let modelFavourite: 'home' | 'draw' | 'away' = 'home'
      let modelFavProb = pred.home_win_prob
      if (pred.draw_prob > modelFavProb)     { modelFavourite = 'draw'; modelFavProb = pred.draw_prob }
      if (pred.away_win_prob > modelFavProb) { modelFavourite = 'away'; modelFavProb = pred.away_win_prob }

      // Divergence: how much does crowd confidence in their favourite differ from model's probability for that outcome?
      const modelProbForCrowdFav = crowdFavourite === 'home' ? pred.home_win_prob
        : crowdFavourite === 'draw' ? pred.draw_prob : pred.away_win_prob
      const divergence = Math.abs(crowdFavPct - modelProbForCrowdFav)

      result.push({
        matchId: m.id,
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        stage: m.stage,
        kickoffAt: m.kickoff_at,
        modelFavourite,
        modelFavProb,
        homeWinP: pred.home_win_prob,
        drawP: pred.draw_prob,
        awayWinP: pred.away_win_prob,
        crowdFavourite,
        crowdFavPct,
        totalPicks: total,
        homePickPct,
        drawPickPct,
        awayPickPct,
        divergence,
        isUpsetRisk: crowdFavourite !== modelFavourite,
      })
    }

    return result.sort((a, b) => b.divergence - a.divergence)
  }, [matches, predByMatch, betsByMatch])

  if (loading) return <Spinner label="Loading radar…" />

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-slate-100">Upset Radar</h1>
        <p className="text-sm text-slate-500">
          Fixtures where crowd picks diverge from the model's probabilities — ranked by divergence.
          High divergence = crowd is confident the model disagrees with.
        </p>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-4 px-6 py-16 text-center">
          <p className="text-sm text-slate-400">No divergent fixtures yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Needs upcoming matches with both model predictions and at least 3 user picks.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
            <span><span className="text-red-400 font-semibold">High divergence</span> — crowd vs. model strongly disagree</span>
            <span><span className="text-amber-400 font-semibold">Medium</span> — some disagreement</span>
            <span><span className="text-green-400 font-semibold">Low</span> — crowd and model roughly agree</span>
          </div>

          {insights.map((ins) => (
            <div
              key={ins.matchId}
              className={`rounded-xl border bg-surface-2 p-5 ${ins.isUpsetRisk ? 'border-red-800/50' : 'border-surface-4'}`}
            >
              {/* Header */}
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-slate-500">{stageLabel(ins.stage)} · {formatKickoff(ins.kickoffAt)}</p>
                  <p className="mt-0.5 text-base font-bold text-slate-100">
                    {ins.homeTeam} <span className="text-slate-500">vs</span> {ins.awayTeam}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {ins.isUpsetRisk && (
                    <span className="rounded-full bg-red-950/60 px-2 py-0.5 text-[10px] font-bold uppercase text-red-400">
                      ⚡ upset risk
                    </span>
                  )}
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500">Divergence</p>
                    <DivergenceMeter score={ins.divergence} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Model probabilities */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Model  ·  favourite: <span className="text-pitch-400">
                      {ins.modelFavourite === 'home' ? ins.homeTeam.split(' ').slice(-1)[0]
                        : ins.modelFavourite === 'away' ? ins.awayTeam.split(' ').slice(-1)[0]
                        : 'Draw'} {Math.round(ins.modelFavProb * 100)}%
                    </span>
                  </p>
                  <ProbBar
                    left={ins.homeWinP} mid={ins.drawP} right={ins.awayWinP}
                  />
                </div>

                {/* Crowd picks */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Crowd ({ins.totalPicks} picks)  ·  favourite: <span className="text-amber-400">
                      {ins.crowdFavourite === 'home' ? ins.homeTeam.split(' ').slice(-1)[0]
                        : ins.crowdFavourite === 'away' ? ins.awayTeam.split(' ').slice(-1)[0]
                        : 'Draw'} {Math.round(ins.crowdFavPct * 100)}%
                    </span>
                  </p>
                  <ProbBar
                    left={ins.homePickPct} mid={ins.drawPickPct} right={ins.awayPickPct}
                  />
                </div>
              </div>

              {ins.isUpsetRisk && (
                <p className="mt-3 text-xs text-red-400/80">
                  Crowd backs <strong>{ins.crowdFavourite === 'home' ? ins.homeTeam : ins.awayTeam}</strong> ({Math.round(ins.crowdFavPct * 100)}%)
                  but model gives them only {Math.round((ins.crowdFavourite === 'home' ? ins.homeWinP : ins.awayWinP) * 100)}%.
                  If the crowd is right, this is an upset.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
