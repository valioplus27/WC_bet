// Lazy-loading LLM narrative widget. Calls the match-narrative edge function
// on demand (button press) so we never auto-fire Anthropic API calls.
import { useState } from 'react'
import type { Match, Prediction } from '../types/models'

type FormResult = { result: 'W' | 'D' | 'L' }

type Props = {
  match: Match
  pred?: Prediction
  homeForm: FormResult[]
  awayForm: FormResult[]
  mode: 'pre' | 'post'
  homeXG?: number
  awayXG?: number
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

export function MatchNarrative({ match, pred, homeForm, awayForm, mode, homeXG, awayXG }: Props) {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasScore = match.home_score !== null && match.away_score !== null

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const stats = mode === 'pre' ? {
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        stage: match.stage,
        homeWinPct: Math.round((pred?.home_win_prob ?? 0.4) * 100),
        drawPct: Math.round((pred?.draw_prob ?? 0.2) * 100),
        awayWinPct: Math.round((pred?.away_win_prob ?? 0.4) * 100),
        homeForm: homeForm.slice(0, 5).map((r) => r.result).join(' '),
        awayForm: awayForm.slice(0, 5).map((r) => r.result).join(' '),
        expectedGoals: pred?.lambda_home != null && pred?.lambda_away != null
          ? pred.lambda_home + pred.lambda_away : undefined,
      } : {
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        stage: match.stage,
        homeScore: match.home_score!,
        awayScore: match.away_score!,
        homeXG: homeXG,
        awayXG: awayXG,
        preMatchHomeWinPct: pred ? Math.round(pred.home_win_prob * 100) : undefined,
        preMatchAwayWinPct: pred ? Math.round(pred.away_win_prob * 100) : undefined,
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/match-narrative`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: mode, stats }),
      })
      const data = await res.json() as { narrative?: string; error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setText(data.narrative ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    }
    setLoading(false)
  }

  const canGenerate = mode === 'pre' ? (pred != null) : hasScore

  if (!canGenerate) return null

  return (
    <div className="mt-3 border-t border-surface-4/40 pt-3">
      {text ? (
        <div className="rounded-lg bg-pitch-600/10 border border-pitch-600/20 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-pitch-400">
              {mode === 'pre' ? '⚡ Pre-match preview' : '📊 Post-match analysis'} · AI
            </span>
            <span className="text-[9px] text-slate-600">· from model stats only</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
          <button
            type="button"
            onClick={() => setText(null)}
            className="mt-1.5 text-[10px] text-slate-600 hover:text-slate-400"
          >
            Regenerate
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="text-[11px] font-semibold text-pitch-400 hover:text-pitch-300 disabled:opacity-50 transition"
        >
          {loading
            ? '✦ Generating…'
            : mode === 'pre'
              ? '✦ AI pre-match preview'
              : '✦ AI post-match analysis'}
        </button>
      )}
      {error && (
        <p className="mt-1 text-[10px] text-red-400">
          {error.includes('ANTHROPIC_API_KEY')
            ? 'Add ANTHROPIC_API_KEY secret to Supabase to enable AI narratives.'
            : error}
        </p>
      )}
    </div>
  )
}
