import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const navItems = [
  { to: '/', label: 'Schedule', end: true },
  { to: '/tournament-bet', label: 'Tournament bet', end: false },
  { to: '/standings', label: 'Standings', end: false },
  { to: '/leaderboard', label: 'Leaderboard', end: false },
  { to: '/scorers', label: 'Top Scorers', end: false },
]

function navLinkClasses(isActive: boolean) {
  return `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-pitch-50 text-pitch-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/sign-in', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/" className="text-base font-bold text-slate-900">
            ⚽ WC 2026 Tulosveto
          </NavLink>

          <nav className="flex flex-wrap items-center gap-1">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navLinkClasses(isActive)}>
                {item.label}
              </NavLink>
            ))}
            {profile?.is_admin && (
              <NavLink to="/admin" className={({ isActive }) => navLinkClasses(isActive)}>
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              Hi, <span className="font-medium text-slate-900">{profile?.display_name ?? '…'}</span>
            </span>
            <button type="button" onClick={handleSignOut} className="font-medium text-slate-500 transition hover:text-slate-900">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
