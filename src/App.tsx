import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { FullPageSpinner } from './components/Spinner'
import { SetNewPassword } from './components/SetNewPassword'
import Layout from './components/Layout'
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from './components/RouteGuards'
import SignIn from './pages/SignIn'
import Schedule from './pages/Schedule'
import TournamentBet from './pages/TournamentBet'
import Standings from './pages/Standings'
import Leaderboard from './pages/Leaderboard'
import Admin from './pages/Admin'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

/**
 * Gates the whole route tree on session-wide states no per-route guard can
 * see: the initial session check, a password-recovery link landing, and a
 * signed-in user who has never set a password. The first two can redirect to
 * any path and the third can be true on any page, so all three have to be
 * caught here rather than on one specific route.
 */
function AppRoutes() {
  const { loading, passwordRecovery, needsPasswordSetup } = useAuth()

  if (loading) return <FullPageSpinner />
  if (passwordRecovery) return <SetNewPassword mode="recovery" />
  if (needsPasswordSetup) return <SetNewPassword mode="setup" />

  return (
    <Routes>
      <Route
        path="/sign-in"
        element={
          <RedirectIfAuthed>
            <SignIn />
          </RedirectIfAuthed>
        }
      />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Schedule />} />
        <Route path="tournament-bet" element={<TournamentBet />} />
        <Route path="standings" element={<Standings />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route
          path="admin"
          element={
            <RequireAdmin>
              <Admin />
            </RequireAdmin>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
