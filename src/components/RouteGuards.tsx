import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { FullPageSpinner } from './Spinner'

/** Only render children once a session exists; otherwise send to /sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!session) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

/** Only render children for admins; otherwise send everyone else home. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!profile?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

/** Signed-in users shouldn't see the sign-in page — bounce them home. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}
