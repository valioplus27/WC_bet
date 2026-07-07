import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { friendlyAuthError } from '../lib/authErrors'

type Mode = 'recovery' | 'setup'

const COPY: Record<Mode, { subtitle: string; intro: string; allowSkip: boolean }> = {
  recovery: {
    subtitle: 'Set a password for your account',
    intro:
      "You followed a password link, so you're signed in for this session. Choose a password below so you can " +
      'sign in directly next time — or skip and keep using magic links.',
    allowSkip: true,
  },
  setup: {
    subtitle: 'One last step — choose a password',
    intro:
      "You're signed in via your magic-link email. Set a password now so next time you can sign in directly with " +
      "your email and password, with nothing to wait on.",
    allowSkip: false,
  },
}

/**
 * Full-screen takeover for the two moments the app needs a password before
 * anything else can happen:
 *  - "recovery": a "set/reset your password" link landed (could be on any
 *    route — see useAuth's passwordRecovery). Skippable; their session is
 *    valid either way.
 *  - "setup": a signed-in user has never set a password (useAuth's
 *    needsPasswordSetup, true for fresh magic-link sign-ups). Not skippable —
 *    this is what makes "every account gets a password" actually hold.
 * Both converge on the same updateUser call; profiles.has_password (kept
 * accurate by a database trigger — see the profiles_has_password migration)
 * flips to true the moment it succeeds, which clears needsPasswordSetup
 * automatically and lets this overlay close itself without any extra wiring.
 */
export function SetNewPassword({ mode }: { mode: Mode }) {
  const { session, dismissPasswordRecovery, refreshProfile, signOut } = useAuth()
  const copy = COPY[mode]
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError("Passwords don't match.")
      return
    }
    setStatus('saving')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(friendlyAuthError(updateError.message))
      setStatus('idle')
      return
    }
    // Don't rely solely on the DB trigger — write has_password directly so the
    // profile state clears needsPasswordSetup on the very next refresh.
    if (session?.user.id) {
      await supabase.from('profiles').update({ has_password: true }).eq('id', session.user.id)
    }
    // Refresh the React profile so needsPasswordSetup (= !has_password) becomes
    // false immediately. In setup mode the App will auto-exit the overlay;
    // in recovery mode we still show the success screen so the user can dismiss.
    await refreshProfile()
    setStatus('saved')
  }

  // Called when the user explicitly clicks "Continue to the app".
  // Refreshes profile one more time (safety net) then clears the recovery flag.
  const handleContinue = async () => {
    await refreshProfile()
    dismissPasswordRecovery()
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-100">⚽ WC 2026 Tulosveto</h1>
          <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
        </div>

        <div className="rounded-xl border border-surface-4 bg-surface-2 p-6 shadow-none">
          {status === 'saved' ? (
            <div className="space-y-3 text-center">
              <p className="text-lg font-semibold text-slate-100">Password saved ✓</p>
              <p className="text-sm text-slate-400">You can sign in with your email and this password any time from now on.</p>
              {/*
                Always safe to call: in "recovery" mode it's the only thing that
                clears passwordRecovery (so it must be explicit); in "setup" mode
                needsPasswordSetup has already cleared itself reactively (the
                profile refetch picked up has_password = true), so this is just
                a no-op that gets out of the way.
              */}
              <button
                type="button"
                onClick={() => void handleContinue()}
                className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-none transition hover:bg-pitch-700"
              >
                Continue to the app
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-slate-400">{copy.intro}</p>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-slate-300">
                  New password
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  className="mt-1 w-full rounded-md border border-slate-600 px-3 py-2 text-sm shadow-none focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-300">
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Type it again"
                  className="mt-1 w-full rounded-md border border-slate-600 px-3 py-2 text-sm shadow-none focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
                />
              </div>
              {error && (
                <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-400">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={status === 'saving'}
                className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-none transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'saving' ? 'Saving…' : 'Save password'}
              </button>
              {copy.allowSkip && (
                <p className="text-center text-sm">
                  <button
                    type="button"
                    onClick={dismissPasswordRecovery}
                    className="font-medium text-slate-500 hover:text-slate-300 hover:underline"
                  >
                    Skip for now
                  </button>
                </p>
              )}
              {!copy.allowSkip && (
                <p className="text-center text-sm">
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="font-medium text-slate-400 hover:text-slate-400 hover:underline"
                  >
                    Sign out instead
                  </button>
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
