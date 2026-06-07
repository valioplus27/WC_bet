import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useMatches } from '../hooks/useMatches'
import { MatchCard } from '../components/MatchCard'
import { Spinner } from '../components/Spinner'
import { isLocked, type Bet } from '../types/models'

export default function Schedule() {
  const { session } = useAuth()
  const userId = session?.user.id
  const { matches, loading: matchesLoading, error: matchesError } = useMatches()
  const [myBets, setMyBets] = useState<Bet[]>([])
  const [betsLoading, setBetsLoading] = useState(true)

  const loadMyBets = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase.from('bets').select('*').eq('user_id', userId)
    if (!error) setMyBets(data ?? [])
    setBetsLoading(false)
  }, [userId])

  useEffect(() => {
    void loadMyBets()
  }, [loadMyBets])

  // Refresh "my bets" whenever a match changes — that's when points_awarded
  // gets (re)computed by the recalculate_match_points trigger.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('schedule-my-bets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter: `user_id=eq.${userId}` }, () => {
        void loadMyBets()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, loadMyBets])

  const betByMatchId = useMemo(() => {
    const map = new Map<number, Bet>()
    for (const bet of myBets) map.set(bet.match_id, bet)
    return map
  }, [myBets])

  const { upcoming, past } = useMemo(() => {
    const upcoming = matches.filter((match) => !isLocked(match.kickoff_at))
    const past = matches.filter((match) => isLocked(match.kickoff_at)).reverse()
    return { upcoming, past }
  }, [matches])

  const handleSave = useCallback(
    async (matchId: number, predictedHome: number, predictedAway: number): Promise<string | null> => {
      if (!userId) return 'You need to be signed in to bet.'
      const { data, error } = await supabase
        .from('bets')
        .upsert(
          { user_id: userId, match_id: matchId, predicted_home: predictedHome, predicted_away: predictedAway },
          { onConflict: 'user_id,match_id' },
        )
        .select()
        .single()

      if (error) {
        // RLS rejects the write once kickoff has passed — translate that into
        // a friendly message instead of a raw Postgres error.
        if (error.code === '42501' || /row-level security/i.test(error.message)) {
          return 'This match has already kicked off — predictions are locked.'
        }
        return error.message
      }

      setMyBets((prev) => {
        const next = prev.filter((bet) => bet.match_id !== matchId)
        next.push(data)
        return next
      })
      return null
    },
    [userId],
  )

  if (matchesLoading || betsLoading) return <Spinner label="Loading schedule…" />

  if (matchesError) {
    return <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">Couldn't load matches: {matchesError}</p>
  }

  if (matches.length === 0) {
    return (
      <EmptyState>
        No fixtures yet — once an admin runs the data sync, matches will show up here for you to predict.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Upcoming — place your bets"
          hint="Predict the exact final score. Locks the instant kickoff happens."
        />
        {upcoming.length === 0 ? (
          <EmptyState>No upcoming matches scheduled right now — check back after the next sync.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((match) => (
              <MatchCard key={match.id} match={match} myBet={betByMatchId.get(match.id) ?? null} onSave={handleSave} />
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading title="Past — locked" hint="Your prediction and points earned, revealed once each match kicks off." />
        {past.length === 0 ? (
          <EmptyState>No matches have kicked off yet.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {past.map((match) => (
              <MatchCard key={match.id} match={match} myBet={betByMatchId.get(match.id) ?? null} onSave={handleSave} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">{children}</p>
}
