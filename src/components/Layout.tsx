import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

type NavItem = { to: string; label: string; icon: string; end: boolean }

// Primary items stay visible on the main bar — the things people reach for
// every matchday. Everything else lives behind "More" so the header doesn't
// turn into a wall of links.
const primaryItems: NavItem[] = [
  { to: '/calendar', label: 'Calendar', icon: '📅', end: false },
  { to: '/', label: 'My bets', icon: '🎯', end: true },
  { to: '/standings', label: 'Standings', icon: '📊', end: false },
  { to: '/bracket', label: 'Bracket', icon: '🏆', end: false },
]

const moreItems: NavItem[] = [
  { to: '/leaderboard', label: 'Leaderboard', icon: '🥇', end: false },
  { to: '/tournament-bet', label: 'Tournament bet', icon: '🏅', end: false },
  { to: '/scorers', label: 'Top Scorers', icon: '⚽', end: false },
  { to: '/stats', label: 'Analytics', icon: '📈', end: false },
]

const allNavItems = [...primaryItems, ...moreItems]

function navLinkClasses(isActive: boolean) {
  return `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-pitch-50 text-pitch-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`
}

function MoreMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const isActiveGroup = moreItems.some((item) => location.pathname === item.to)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  return (
    <div ref={ref} className="relative hidden lg:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isActiveGroup || open ? 'bg-pitch-50 text-pitch-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        More
        <span className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
          {moreItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-pitch-50 text-pitch-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function MobileMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100"
      >
        {open ? (
          <span className="text-lg leading-none">✕</span>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
          </span>
        )}
      </button>

      {open && (
        <nav className="absolute inset-x-0 top-full z-20 border-b border-slate-200 bg-white px-4 py-3 shadow-lg">
          <div className="grid grid-cols-2 gap-1">
            {allNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-pitch-50 text-pitch-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
            {isAdmin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-pitch-50 text-pitch-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                <span aria-hidden="true">⚙️</span>
                Admin
              </NavLink>
            )}
          </div>
        </nav>
      )}
    </div>
  )
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
        <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <MobileMenu isAdmin={!!profile?.is_admin} />
            <NavLink to="/" className="whitespace-nowrap text-base font-bold text-slate-900">
              ⚽ WC 2026 Tulosveto
            </NavLink>
          </div>

          <nav className="hidden items-center gap-1 lg:flex">
            {primaryItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => navLinkClasses(isActive)}>
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
            <MoreMenu />
            {profile?.is_admin && (
              <NavLink to="/admin" className={({ isActive }) => navLinkClasses(isActive)}>
                <span aria-hidden="true">⚙️</span>
                Admin
              </NavLink>
            )}
          </nav>

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
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
