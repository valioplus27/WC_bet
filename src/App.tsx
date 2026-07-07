import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { FullPageSpinner } from './components/Spinner'
import { SetNewPassword } from './components/SetNewPassword'
import Layout from './components/Layout'
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from './components/RouteGuards'
import { ErrorBoundary } from './components/ErrorBoundary'
import SignIn from './pages/SignIn'
import Schedule from './pages/Schedule'
import TournamentBet from './pages/TournamentBet'
import Standings from './pages/Standings'
import Leaderboard from './pages/Leaderboard'
import Admin from './pages/Admin'
import Scorers from './pages/Scorers'
import Stats from './pages/Stats'
import Bracket from './pages/Bracket'
import MatchAnalysis from './pages/MatchAnalysis'
import Calendar from './pages/Calendar'
import MatchDetail from './pages/MatchDetail'
import TeamPage from './pages/TeamPage'
import PlayerPage from './pages/PlayerPage'

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
  const { loading, passwordRecovery, needsPasswordSetup, session, profile } = useAuth()

  if (loading) return <FullPageSpinner />
  // Session exists but profile not yet loaded — brief window after magic-link
  // sign-in while the profile fetch is in flight. Keep the spinner up so the
  // user doesn't land in the app with profile=null and bypass password setup.
  if (session && !profile) return <FullPageSpinner />
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
            <ErrorBoundary>
              <Layout />
            </ErrorBoundary>
          </RequireAuth>
        }
      >
        <Route index element={<Schedule />} />
        <Route path="tournament-bet" element={<TournamentBet />} />
        <Route path="standings" element={<Standings />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="scorers" element={<Scorers />} />
        <Route path="stats" element={<Stats />} />
        <Route path="bracket" element={<Bracket />} />
        <Route path="analysis" element={<MatchAnalysis />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="match/:id" element={<MatchDetail />} />
        <Route path="team/:slug" element={<TeamPage />} />
        <Route path="player/:name" element={<PlayerPage />} />
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
