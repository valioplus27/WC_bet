import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useMatches } from '../hooks/useMatches'
import { MatchCard } from '../components/MatchCard'
import { Spinner } from '../components/Spinner'
import { isLocked, type Bet, type MatchEventLive, type MatchStats, type Prediction, type Profile, type Reaction, type Standing } from '../types/models'
import type { FormResult } from '../components/MatchPreview'

export default function Schedule() {
  const { session } = useAuth()
  const userId = session?.user.id
  const { matches, loading: matchesLoading, error: matchesError } = useMatches()
  const [myBets, setMyBets] = useState<Bet[]>([])
  const [betsLoading, setBetsLoading] = useState(true)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [lockedBets, setLockedBets] = useState<Bet[]>([])
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [liveEvents, setLiveEvents] = useState<MatchEventLive[]>([])
  const [matchStats, setMatchStats] = useState<MatchStats[]>([])
  const [standings, setStandings] = useState<Standing[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])

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

  const loadProfiles = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*')
    if (!error) setProfiles(data ?? [])
    setProfilesLoading(false)
  }, [])

  useEffect(() => {
    void loadProfiles()
    const channel = supabase
      .channel('schedule-profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void loadProfiles())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadProfiles])

  // Bulk-load bets + reactions for all locked matches (RLS reveals them post-kickoff).
  // This drives the per-card pick distribution bar without N+1 fetches.
  const loadLockedData = useCallback(async () => {
    const lockedIds = matches.filter((m) => isLocked(m.kickoff_at)).map((m) => m.id)
    if (lockedIds.length === 0) return
    const [betsRes, reactionsRes, eventsRes, statsRes] = await Promise.all([
      supabase.from('bets').select('*').in('match_id', lockedIds),
      supabase.from('reactions').select('*').in('match_id', lockedIds),
      supabase.from('match_events_live').select('*').in('match_id', lockedIds),
      supabase.from('match_stats').select('*').in('match_id', lockedIds),
    ])
    if (!betsRes.error) setLockedBets(betsRes.data ?? [])
    if (!reactionsRes.error) setReactions(reactionsRes.data ?? [])
    if (!eventsRes.error) setLiveEvents(eventsRes.data ?? [])
    if (!statsRes.error) setMatchStats(statsRes.data ?? [])
  }, [matches])

  useEffect(() => {
    void loadLockedData()
    const channel = supabase
      .channel('schedule-locked-data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, () => void loadLockedData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'match_events_live' }, () => void loadLockedData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_stats' }, () => void loadLockedData())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [loadLockedData])

  // Load model predictions (only exist for knockout-stage upcoming matches)
  useEffect(() => {
    supabase.from('predictions').select('*').then(({ data }) => setPredictions(data ?? []))
  }, [])

  // Standings — used by the pre-match preview to show group positions
  useEffect(() => {
    supabase.from('standings').select('*').then(({ data }) => setStandings(data ?? []))
    const channel = supabase
      .channel('schedule-standings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standings' }, () => {
        supabase.from('standings').select('*').then(({ data }) => setStandings(data ?? []))
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  // Team form: last 5 completed WC matches per team, most recent first
  const teamFormMap = useMemo(() => {
    const map = new Map<string, FormResult[]>()
    const finished = matches
      .filter((m) => m.status === 'FINISHED' && m.home_score !== null && m.away_score !== null)
      .sort((a, b) => new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime())

    for (const m of finished) {
      const hs = m.home_score!
      const as_ = m.away_score!

      const homeResult: 'W' | 'D' | 'L' = hs > as_ ? 'W' : hs === as_ ? 'D' : 'L'
      const awayResult: 'W' | 'D' | 'L' = as_ > hs ? 'W' : as_ === hs ? 'D' : 'L'

      const homeForm = map.get(m.home_team) ?? []
      homeForm.push({ opponent: m.away_team, isHome: true, goalsFor: hs, goalsAgainst: as_, result: homeResult, kickoff_at: m.kickoff_at })
      map.set(m.home_team, homeForm)

      const awayForm = map.get(m.away_team) ?? []
      awayForm.push({ opponent: m.home_team, isHome: false, goalsFor: as_, goalsAgainst: hs, result: awayResult, kickoff_at: m.kickoff_at })
      map.set(m.away_team, awayForm)
    }
    // Cap at 5
    for (const [team, form] of map) map.set(team, form.slice(0, 5))
    return map
  }, [matches])

  // Standing lookup by team name
  const standingsByTeam = useMemo(() => {
    const map = new Map<string, Standing>()
    for (const s of standings) map.set(s.team_name, s)
    return map
  }, [standings])

  // All finished WC meetings between two teams (may be >1 if they meet in group then knockout)
  const previousMeetingsMap = useMemo(() => {
    const finished = matches.filter((m) => m.status === 'FINISHED')
    const map = new Map<string, typeof finished>()
    for (const m of finished) {
      const key1 = `${m.home_team}|${m.away_team}`
      const key2 = `${m.away_team}|${m.home_team}`
      for (const key of [key1, key2]) {
        const list = map.get(key) ?? []
        if (!list.find((x) => x.id === m.id)) list.push(m)
        map.set(key, list)
      }
    }
    return map
  }, [matches])

  const predictionByMatchId = useMemo(() => {
    const map = new Map<number, Prediction>()
    for (const p of predictions) map.set(p.match_id, p)
    return map
  }, [predictions])

  const betByMatchId = useMemo(() => {
    const map = new Map<number, Bet>()
    for (const bet of myBets) map.set(bet.match_id, bet)
    return map
  }, [myBets])

  const lockedBetsByMatch = useMemo(() => {
    const map = new Map<number, Bet[]>()
    for (const bet of lockedBets) {
      const list = map.get(bet.match_id) ?? []
      list.push(bet)
      map.set(bet.match_id, list)
    }
    return map
  }, [lockedBets])

  const reactionsByMatch = useMemo(() => {
    const map = new Map<number, Reaction[]>()
    for (const r of reactions) {
      const list = map.get(r.match_id) ?? []
      list.push(r)
      map.set(r.match_id, list)
    }
    return map
  }, [reactions])

  const liveEventsByMatch = useMemo(() => {
    const map = new Map<number, MatchEventLive[]>()
    for (const e of liveEvents) {
      const list = map.get(e.match_id) ?? []
      list.push(e)
      map.set(e.match_id, list)
    }
    return map
  }, [liveEvents])

  const matchStatsByMatch = useMemo(() => {
    const map = new Map<number, MatchStats>()
    for (const s of matchStats) map.set(s.match_id, s)
    return map
  }, [matchStats])

  const { upcoming, pastByDate } = useMemo(() => {
    const upcoming = matches.filter((match) => !isLocked(match.kickoff_at))
    const past = matches.filter((match) => isLocked(match.kickoff_at))
      .sort((a, b) => new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime())
    // Group past matches by calendar date (local)
    const groups = new Map<string, typeof past>()
    for (const m of past) {
      const label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(m.kickoff_at))
      const list = groups.get(label) ?? []
      list.push(m)
      groups.set(label, list)
    }
    return { upcoming, pastByDate: [...groups.entries()] }
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

  const onReactionToggle = useCallback(
    async (matchId: number, emoji: string) => {
      if (!userId) return
      const existing = reactions.find((r) => r.match_id === matchId && r.user_id === userId)
      if (existing?.emoji === emoji) {
        await supabase.from('reactions').delete().eq('user_id', userId).eq('match_id', matchId)
      } else {
        await supabase.from('reactions').upsert({ user_id: userId, match_id: matchId, emoji })
      }
      void loadLockedData()
    },
    [userId, reactions, loadLockedData],
  )

  if (matchesLoading || betsLoading || profilesLoading) return <Spinner label="Loading schedule…" />

  if (matchesError) {
    return <p className="rounded-md bg-red-950/60 px-4 py-3 text-sm text-red-400">Couldn't load matches: {matchesError}</p>
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
      <ScoringLegend />

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
              <MatchCard
                key={match.id}
                match={match}
                myBet={betByMatchId.get(match.id) ?? null}
                onSave={handleSave}
                profiles={profiles}
                allBetsForMatch={[]}
                reactions={[]}
                myUserId={userId}
                onReactionToggle={onReactionToggle}
                homeForm={teamFormMap.get(match.home_team) ?? []}
                awayForm={teamFormMap.get(match.away_team) ?? []}
                homeStanding={standingsByTeam.get(match.home_team)}
                awayStanding={standingsByTeam.get(match.away_team)}
                previousMeetings={previousMeetingsMap.get(`${match.home_team}|${match.away_team}`)}
                prediction={predictionByMatchId.get(match.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-6">
        <SectionHeading title="Past — results" hint="Your prediction and points earned, revealed once each match kicks off." />
        {pastByDate.length === 0 ? (
          <EmptyState>No matches have kicked off yet.</EmptyState>
        ) : (
          pastByDate.map(([date, dayMatches]) => (
            <div key={date}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">{date}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {dayMatches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    myBet={betByMatchId.get(match.id) ?? null}
                    onSave={handleSave}
                    profiles={profiles}
                    allBetsForMatch={lockedBetsByMatch.get(match.id) ?? []}
                    reactions={reactionsByMatch.get(match.id) ?? []}
                    myUserId={userId}
                    onReactionToggle={onReactionToggle}
                    homeForm={[]}
                    awayForm={[]}
                    homeStanding={undefined}
                    awayStanding={undefined}
                    previousMeetings={[]}
                    liveEvents={liveEventsByMatch.get(match.id)}
                    matchStats={matchStatsByMatch.get(match.id) ?? null}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function ScoringLegend() {
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">
        <span className="font-semibold text-slate-300">How match points work —</span> nail the exact final score for
        the most points; get the winner (or draw) right and you still bank something even when the score's off.
      </p>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-surface-4/70 bg-surface-2 px-3 py-2">
          <dt className="text-slate-500">Exact score</dt>
          <dd className="text-base font-semibold text-pitch-400">3 pts</dd>
        </div>
        <div className="rounded-lg border border-surface-4/70 bg-surface-2 px-3 py-2">
          <dt className="text-slate-500">
            Right outcome <span className="font-normal text-slate-400">— win, draw or loss</span>
          </dt>
          <dd className="text-base font-semibold text-amber-400">1 pt</dd>
        </div>
        <div className="rounded-lg border border-surface-4/70 bg-surface-2 px-3 py-2">
          <dt className="text-slate-500">Wrong outcome</dt>
          <dd className="text-base font-semibold text-slate-400">0 pts</dd>
        </div>
      </dl>
    </div>
  )
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-bold text-slate-100">{title}</h2>
      <p className="text-sm text-slate-500">{hint}</p>
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-600 bg-surface-2 px-4 py-8 text-center text-sm text-slate-500">{children}</p>
}
