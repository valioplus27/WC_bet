// ============================================================================
// PredictionEngine — advanced prediction visualizations for match cards.
//
// ScoreHeatmap:  N×N matrix of Dixon-Coles exact-score probabilities.
// OverUnderCurve: Cumulative P(total goals > x.5) for x = 0…7.
// Both computed from lambda_home / lambda_away stored per prediction.
// ============================================================================

import { useMemo } from 'react'

const MAX_G = 8
const DC_RHO = -0.10

// ---------------------------------------------------------------------------
// Maths (mirrors edge function)
// ---------------------------------------------------------------------------

function poissonPMF(lambda: number, k: number): number {
  if (k < 0 || k > MAX_G || lambda <= 0) return 0
  let lp = -lambda + k * Math.log(lambda)
  for (let i = 1; i <= k; i++) lp -= Math.log(i)
  return Math.exp(lp)
}

function dcAdj(h: number, a: number, lh: number, la: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * DC_RHO
  if (h === 0 && a === 1) return 1 + lh * DC_RHO
  if (h === 1 && a === 0) return 1 + la * DC_RHO
  if (h === 1 && a === 1) return 1 - DC_RHO
  return 1
}

/** Returns an (N+1)×(N+1) matrix of exact-score probabilities. */
function buildScoreMatrix(lh: number, la: number, N = 6): number[][] {
  const M: number[][] = []
  let total = 0
  for (let h = 0; h <= N; h++) {
    M[h] = []
    for (let a = 0; a <= N; a++) {
      const p = poissonPMF(lh, h) * poissonPMF(la, a) * dcAdj(h, a, lh, la)
      M[h][a] = p
      total += p
    }
  }
  // Renormalise (truncation error)
  if (total > 0) for (let h = 0; h <= N; h++) for (let a = 0; a <= N; a++) M[h][a] /= total
  return M
}

/** Returns P(total goals > x.5) for x = 0..7. */
function buildOverUnder(lh: number, la: number): { line: number; over: number; under: number }[] {
  const lines = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]
  const matrix = buildScoreMatrix(lh, la)
  return lines.map((line) => {
    let over = 0
    for (let h = 0; h < matrix.length; h++)
      for (let a = 0; a < matrix[h].length; a++)
        if (h + a > line) over += matrix[h][a]
    const clamp = (v: number) => Math.max(0, Math.min(1, v))
    over = clamp(over)
    return { line, over, under: 1 - over }
  })
}

// ---------------------------------------------------------------------------
// Score heatmap
// ---------------------------------------------------------------------------

function pctLabel(p: number): string {
  if (p < 0.005) return ''
  if (p < 0.10)  return `${Math.round(p * 100)}%`
  return `${Math.round(p * 100)}%`
}

function cellColor(p: number, maxP: number): string {
  if (maxP === 0 || p === 0) return 'transparent'
  const t = p / maxP
  // Violet gradient: low = dark surface, high = bright violet
  const r = Math.round(20 + t * 100)
  const g = Math.round(10 + t * 10)
  const b = Math.round(60 + t * 180)
  const a = Math.min(0.15 + t * 0.8, 1)
  return `rgba(${r},${g},${b},${a.toFixed(2)})`
}

export function ScoreHeatmap({
  lambdaHome, lambdaAway, homeTeam, awayTeam,
}: {
  lambdaHome: number; lambdaAway: number
  homeTeam: string; awayTeam: string
}) {
  const N = 6
  const matrix = useMemo(() => buildScoreMatrix(lambdaHome, lambdaAway, N), [lambdaHome, lambdaAway])
  const maxP = useMemo(() => Math.max(...matrix.flatMap((row) => row)), [matrix])

  const homeShort = homeTeam.split(' ').slice(-1)[0]
  const awayShort = awayTeam.split(' ').slice(-1)[0]

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Exact score — {homeShort} home · {awayShort} away
      </p>
      <div className="overflow-x-auto">
        <table className="text-[10px] tabular-nums">
          <thead>
            <tr>
              <th className="w-8 text-right pr-1 font-normal text-slate-500">H\A</th>
              {Array.from({ length: N + 1 }, (_, a) => (
                <th key={a} className="w-9 text-center font-semibold text-slate-300">{a}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, h) => (
              <tr key={h}>
                <td className="pr-1 text-right font-semibold text-slate-300">{h}</td>
                {row.map((p, a) => {
                  const isHomeWin = h > a
                  const isDraw    = h === a
                  const color = cellColor(p, maxP)
                  return (
                    <td
                      key={a}
                      title={`${h}–${a}: ${(p * 100).toFixed(1)}%`}
                      style={{ backgroundColor: color }}
                      className={`h-8 w-9 text-center rounded-sm text-[9px] font-semibold transition
                        ${isHomeWin ? 'text-violet-200' : isDraw ? 'text-slate-300' : 'text-orange-200'}`}
                    >
                      {pctLabel(p)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-4 text-[9px] text-slate-500">
        <span><span className="text-violet-300">■</span> {homeShort} win</span>
        <span><span className="text-slate-400">■</span> Draw</span>
        <span><span className="text-orange-300">■</span> {awayShort} win</span>
        <span className="ml-auto">Darker = higher probability</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Over/under curve
// ---------------------------------------------------------------------------

export function OverUnderCurve({
  lambdaHome, lambdaAway,
}: {
  lambdaHome: number; lambdaAway: number
}) {
  const data = useMemo(() => buildOverUnder(lambdaHome, lambdaAway), [lambdaHome, lambdaAway])

  const W = 300, H = 120, PAD = { t: 10, r: 8, b: 30, l: 36 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b
  const xStep = innerW / (data.length - 1)
  const toY = (v: number) => PAD.t + innerH * (1 - v)

  const overPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${PAD.l + i * xStep} ${toY(d.over)}`).join(' ')
  const underPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${PAD.l + i * xStep} ${toY(d.under)}`).join(' ')

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Over / Under curve
      </p>
      <svg width={W} height={H} className="overflow-visible">
        {/* Grid */}
        {[0.25, 0.50, 0.75].map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)} stroke="#3a1d80" strokeWidth={0.5} />
            <text x={PAD.l - 3} y={toY(v) + 3} textAnchor="end" fontSize={8} fill="#6b5ba0">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {/* Axes */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#3a1d80" strokeWidth={1} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#3a1d80" strokeWidth={1} />
        {/* X labels */}
        {data.map((d, i) => (
          <text key={i} x={PAD.l + i * xStep} y={H - PAD.b + 12} textAnchor="middle" fontSize={8} fill="#6b5ba0">
            {d.line}
          </text>
        ))}
        <text x={W / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="#6b5ba0">Total goals line</text>
        {/* Over line (violet) */}
        <path d={overPath} fill="none" stroke="#8b5cf6" strokeWidth={2} />
        {/* Under line (orange) */}
        <path d={underPath} fill="none" stroke="#fb923c" strokeWidth={2} />
        {/* Dots + tooltips */}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={PAD.l + i * xStep} cy={toY(d.over)} r={3} fill="#8b5cf6">
              <title>Over {d.line}: {(d.over * 100).toFixed(1)}%</title>
            </circle>
            <circle cx={PAD.l + i * xStep} cy={toY(d.under)} r={3} fill="#fb923c">
              <title>Under {d.line}: {(d.under * 100).toFixed(1)}%</title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 text-[9px] text-slate-500">
        <span><span className="text-violet-400">—</span> Over</span>
        <span><span className="text-orange-400">—</span> Under</span>
        <span className="ml-auto text-slate-600">2.5 line: {(data.find(d => d.line === 2.5)?.over ?? 0 * 100).toFixed(0)}% over</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Monte Carlo tournament simulator
// ---------------------------------------------------------------------------

export type SimMatch = {
  matchId: number
  homeTeam: string
  awayTeam: string
  homeWinP: number   // P(home wins in 90min; in KO, draw goes to pens 50/50)
  drawP: number
  awayWinP: number
  stage: string
  kickoffAt: string
  homeScore: number | null
  awayScore: number | null
  status: string
}

export type SimResult = {
  team: string
  /** Survival probability by stage */
  byStage: Record<string, number>   // e.g. {'LAST_32':1.0,'LAST_16':0.68,...,'FINAL':0.14,'champion':0.07}
}

function sampleWinner(m: SimMatch): string {
  const r = Math.random()
  // In knockout rounds there's no draw (ET+pens) — redistribute draw prob 50/50
  const homeFinalP = m.homeWinP + m.drawP * 0.5
  return r < homeFinalP ? m.homeTeam : m.awayTeam
}

const STAGE_ORDER = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'THIRD_PLACE', 'FINAL']

/**
 * Runs N Monte Carlo simulations of the remaining knockout bracket.
 * Returns per-team survival probabilities at each stage.
 */
export function runMonteCarlo(matches: SimMatch[], N = 10_000): SimResult[] {
  const teams = new Set<string>()
  for (const m of matches) {
    if (m.homeTeam !== 'TBD') teams.add(m.homeTeam)
    if (m.awayTeam !== 'TBD') teams.add(m.awayTeam)
  }

  const counts: Map<string, Record<string, number>> = new Map()
  for (const t of teams) counts.set(t, Object.fromEntries([...STAGE_ORDER, 'champion'].map((s) => [s, 0])))

  // Sort matches by stage order then kickoff
  const stageRank = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i]))
  const sorted = [...matches].sort((a, b) => {
    const sd = (stageRank[a.stage] ?? 99) - (stageRank[b.stage] ?? 99)
    return sd !== 0 ? sd : new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime()
  })

  // Group matches into rounds
  const rounds = new Map<string, SimMatch[]>()
  for (const m of sorted) {
    const list = rounds.get(m.stage) ?? []
    list.push(m)
    rounds.set(m.stage, list)
  }

  // Count teams in LAST_32 as their entry stage
  const last32 = rounds.get('LAST_32') ?? []
  for (const m of last32) {
    if (m.homeTeam !== 'TBD') counts.get(m.homeTeam)!['LAST_32']++
    if (m.awayTeam !== 'TBD') counts.get(m.awayTeam)!['LAST_32']++
  }

  for (let sim = 0; sim < N; sim++) {
    // For already-finished matches, use the actual result
    const winners = new Map<number, string>()
    for (const m of sorted) {
      if (m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null) {
        winners.set(m.matchId, (m.homeScore ?? 0) > (m.awayScore ?? 0) ? m.homeTeam : m.awayTeam)
      }
    }

    // Simulate each round in order, pairing matches as the bracket progresses
    let currentWinners: string[] = []

    for (const stage of STAGE_ORDER) {
      const stageMatches = rounds.get(stage)
      if (!stageMatches) continue

      const stageWinners: string[] = []

      for (const m of stageMatches) {
        let homeTeam = m.homeTeam
        let awayTeam = m.awayTeam

        if (m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null) {
          const w = m.homeScore > m.awayScore ? m.homeTeam : m.awayTeam
          winners.set(m.matchId, w)
          stageWinners.push(w)
          const c = counts.get(w)
          if (c) c[stage] = (c[stage] ?? 0)
          continue
        }

        if (homeTeam === 'TBD' && currentWinners.length >= 2) {
          homeTeam = currentWinners.shift()!
          awayTeam = currentWinners.shift()!
        }

        if (homeTeam === 'TBD' || awayTeam === 'TBD') continue

        const simM = { ...m, homeTeam, awayTeam }
        const winner = sampleWinner(simM)
        winners.set(m.matchId, winner)
        stageWinners.push(winner)
        const c = counts.get(winner)
        if (c) c[stage] = (c[stage] ?? 0) + 1
      }

      currentWinners = stageWinners

      if (stage === 'FINAL' && stageWinners.length === 1) {
        const champion = stageWinners[0]
        const c = counts.get(champion)
        if (c) c['champion'] = (c['champion'] ?? 0) + 1
      }
    }
  }

  const results: SimResult[] = []
  for (const [team, stageCounts] of counts) {
    const byStage: Record<string, number> = {}
    for (const [s, c] of Object.entries(stageCounts)) {
      byStage[s] = Math.round((c / N) * 1000) / 1000
    }
    results.push({ team, byStage })
  }
  return results.sort((a, b) => (b.byStage['champion'] ?? 0) - (a.byStage['champion'] ?? 0))
}

// ---------------------------------------------------------------------------
// Monte Carlo display component
// ---------------------------------------------------------------------------

type MonteCarloProps = {
  simResults: SimResult[]
  myTeam?: string   // optionally highlight
}

const STAGE_LABELS: Record<string, string> = {
  LAST_32: 'R32', LAST_16: 'R16', QUARTER_FINALS: 'QF', SEMI_FINALS: 'SF',
  FINAL: 'Final', champion: '🏆',
}

export function MonteCarloTable({ simResults, myTeam }: MonteCarloProps) {
  if (simResults.length === 0) return null
  const stages = STAGE_ORDER.filter((s) => simResults.some((r) => (r.byStage[s] ?? 0) > 0))
  stages.push('champion')

  const top = simResults.slice(0, 20)

  return (
    <div className="space-y-2 overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-left border-b border-surface-4">
            <th className="py-1.5 pr-3 font-semibold text-slate-300">Team</th>
            {stages.map((s) => (
              <th key={s} className="py-1.5 px-2 text-center font-semibold text-slate-400 text-[10px]">
                {STAGE_LABELS[s] ?? s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-4/30">
          {top.map((r) => {
            const isMe = r.team === myTeam
            return (
              <tr key={r.team} className={`${isMe ? 'bg-pitch-600/10' : 'hover:bg-surface-3'} transition`}>
                <td className={`py-1.5 pr-3 truncate max-w-[120px] font-medium ${isMe ? 'text-pitch-400' : 'text-slate-200'}`}>
                  {r.team}
                </td>
                {stages.map((s) => {
                  const p = r.byStage[s] ?? 0
                  const pct = Math.round(p * 100)
                  const bg = pct > 0 ? `rgba(124,58,237,${Math.min(p * 1.5, 0.6).toFixed(2)})` : 'transparent'
                  return (
                    <td key={s} className="py-1.5 px-2 text-center" style={{ backgroundColor: bg }}>
                      {pct > 0 ? `${pct}%` : <span className="text-slate-600">—</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-600">Based on 10,000 simulations · Poisson-Dixon/Coles model</p>
    </div>
  )
}
