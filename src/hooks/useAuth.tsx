import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types/models'

type AuthContextValue = {
  /** Supabase auth session, or null when signed out. */
  session: Session | null
  /** The signed-in user's row in `public.profiles` (display name, admin flag). */
  profile: Profile | null
  /** True until the initial session check has resolved. */
  loading: boolean
  /**
   * True from the moment a password-recovery link lands until it's resolved —
   * the app shows a "choose a new password" takeover instead of its normal
   * routes for the whole session, since the recovery link could land on any page.
   */
  passwordRecovery: boolean
  /** Leave recovery mode without changing the password (their recovery session stays valid either way). */
  dismissPasswordRecovery: () => void
  /**
   * True for any signed-in user whose profile row says they've never set a
   * password (profiles.has_password, kept accurate server-side by a trigger on
   * auth.users — see the profiles_has_password migration). Magic-link sign-ups
   * start this way; the app walks them through setting one so every account
   * ends up with one and future sign-ins can skip the email round-trip. There's
   * no dismiss — it clears itself the instant updateUser({ password }) succeeds
   * and the refreshed profile comes back with has_password = true.
   */
  needsPasswordSetup: boolean
  /** Re-fetch the profile row, e.g. after the user renames themselves. */
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) {
    console.error('Failed to load profile', error)
    return null
  }
  return data
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    let active = true

    async function applySession(nextSession: Session | null) {
      if (!active) return
      setSession(nextSession)
      setProfile(nextSession ? await fetchProfile(nextSession.user.id) : null)
      if (active) setLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session))

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Fired when the user lands here via a "reset your password" email link —
      // they're now signed in through a recovery token and should set a real
      // password before doing anything else, regardless of which page they hit.
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT') setPasswordRecovery(false)
      void applySession(nextSession)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const refreshProfile = async () => {
    if (session) setProfile(await fetchProfile(session.user.id))
  }

  const dismissPasswordRecovery = () => setPasswordRecovery(false)

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const needsPasswordSetup = Boolean(session && profile && !profile.has_password)

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        passwordRecovery,
        dismissPasswordRecovery,
        needsPasswordSetup,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>')
  return ctx
}
