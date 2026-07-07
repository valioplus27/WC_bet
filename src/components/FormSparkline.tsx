// Small SVG dot-row showing form: W (green), D (amber), L (red).
// Oldest on left, most recent on right.

import type { FormWindow } from '../lib/providers/types'

const DOT = 9
const GAP = 4
const H   = 20

const COLOR: Record<string, string> = { W: '#22c55e', D: '#f59e0b', L: '#ef4444' }

export function FormSparkline({ form, maxDots = 10 }: { form: FormWindow; maxDots?: number }) {
  const letters = [...form.records]
    .reverse()                          // oldest → newest
    .slice(-maxDots)
    .map((r) => r.result)

  if (letters.length === 0) {
    return <span className="text-xs text-slate-400">—</span>
  }

  const w = letters.length * (DOT + GAP) - GAP

  return (
    <svg
      width={w}
      height={H}
      viewBox={`0 0 ${w} ${H}`}
      aria-label={`Form: ${letters.join(' ')}`}
    >
      {letters.map((r, i) => {
        const cx = i * (DOT + GAP) + DOT / 2
        return (
          <g key={i}>
            <circle cx={cx} cy={H / 2} r={DOT / 2} fill={COLOR[r]} />
            <text
              x={cx}
              y={H / 2 + 3.5}
              textAnchor="middle"
              fontSize={6}
              fontWeight="bold"
              fill="white"
            >
              {r}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// Compact text-only badges — for tight spaces like the team page header
export function FormBadges({ form, n }: { form: FormWindow; n: number }) {
  const letters = [...form.records].reverse().slice(-n).map((r) => r.result)
  const cls: Record<string, string> = {
    W: 'bg-green-600 text-white',
    D: 'bg-amber-400 text-white',
    L: 'bg-red-950/600 text-white',
  }
  return (
    <span className="flex items-center gap-0.5">
      {letters.map((r, i) => (
        <span key={i} className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${cls[r]}`}>
          {r}
        </span>
      ))}
      {letters.length === 0 && <span className="text-xs text-slate-400">—</span>}
    </span>
  )
}
