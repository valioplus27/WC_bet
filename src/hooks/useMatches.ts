import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Match } from '../types/models'

/**
 * All matches, kept fresh via a realtime subscription so scores/status flip
 * to "live"/"final" for everyone the moment the sync job (or an admin fix)
 * writes them — without anyone needing to refresh the page.
 *
 * Each hook instance gets a unique channel name to avoid the Supabase
 * "cannot add callbacks after subscribe()" error when multiple components
 * mount simultaneously and all call useMatches().
 */
export function useMatches() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Stable unique ID for this hook instance — avoids channel name collisions.
  const channelName = useRef(`matches-${Math.random().toString(36).slice(2)}`)

  const refetch = useCallback(async () => {
    const { data, error: fetchError } = await supabase.from('matches').select('*').order('kickoff_at', { ascending: true })
    if (fetchError) setError(fetchError.message)
    else {
      setMatches(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refetch()

    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        void refetch()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refetch])

  return { matches, loading, error, refetch }
}
