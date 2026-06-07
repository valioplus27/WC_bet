import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { friendlyAuthError } from '../lib/authErrors'

/**
 * Full-screen takeover shown the instant a "set/reset your password" link
 * lands — wherever it redirects to, since the recovery session could land on
 * any route. Lets the user pick a real password before doing anything else.
 */
export function SetNewPassword() {
  const { dismissPasswordRecovery } = useAuth()
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
    setStatus('saved')
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">⚽ WC 2026 Tulosveto</h1>
          <p className="mt-1 text-sm text-slate-500">Set a password for your account</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {status === 'saved' ? (
            <div className="space-y-3 text-center">
              <p className="text-lg font-semibold text-slate-900">Password saved ✓</p>
              <p className="text-sm text-slate-600">You can sign in with your email and this password any time from now on.</p>
              <button
                type="button"
                onClick={dismissPasswordRecovery}
                className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700"
              >
                Continue to the app
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-sm text-slate-600">
                You followed a password link, so you're signed in for this session. Choose a password below so you
                can sign in directly next time — or skip and keep using magic links.
              </p>
              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700">
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
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700">
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
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-pitch-600 focus:outline-none focus:ring-1 focus:ring-pitch-600"
                />
              </div>
              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={status === 'saving'}
                className="w-full rounded-md bg-pitch-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-pitch-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === 'saving' ? 'Saving…' : 'Save password'}
              </button>
              <p className="text-center text-sm">
                <button
                  type="button"
                  onClick={dismissPasswordRecovery}
                  className="font-medium text-slate-500 hover:text-slate-700 hover:underline"
                >
                  Skip for now
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
