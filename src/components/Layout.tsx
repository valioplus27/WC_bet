import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

// ---------------------------------------------------------------------------
// Nav structure
// ---------------------------------------------------------------------------

type NavItem = { to: string; label: string; icon: string; end?: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: '/calendar',       label: 'Calendar',     icon: '📅', end: false },
  { to: '/',               label: 'My bets',      icon: '🎯', end: true  },
  { to: '/standings',      label: 'Standings',    icon: '📊', end: false },
  { to: '/bracket',        label: 'Bracket',      icon: '🏆', end: false },
  { to: '/leaderboard',    label: 'Leaderboard',  icon: '🥇', end: false },
  { to: '/analytics',      label: 'Analytics',    icon: '📈', end: false },
  { to: '/tournament-bet', label: 'Tournament',   icon: '🏅', end: false },
  { to: '/scorers',        label: 'Top Scorers',  icon: '⚽', end: false },
  { to: '/upset-radar',   label: 'Upset Radar',  icon: '⚡', end: false },
]

// ---------------------------------------------------------------------------
// Sidebar link
// ---------------------------------------------------------------------------

function SideNavLink({
  item,
  collapsed,
  onClick,
}: {
  item: NavItem
  collapsed: boolean
  onClick?: () => void
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-pitch-600/20 text-pitch-400 ring-1 ring-pitch-600/30'
            : 'text-slate-400 hover:bg-surface-3 hover:text-slate-100'
        } ${collapsed ? 'justify-center px-2' : ''}`
      }
    >
      <span className="text-base leading-none" aria-hidden="true">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  )
}

// ---------------------------------------------------------------------------
// Desktop sidebar (persistent)
// ---------------------------------------------------------------------------

function DesktopSidebar({
  collapsed,
  onToggle,
  isAdmin,
}: {
  collapsed: boolean
  onToggle: () => void
  isAdmin: boolean
}) {
  return (
    <aside
      className={`hidden lg:flex flex-col shrink-0 border-r border-surface-4 bg-surface-0 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand + collapse toggle */}
      <div className={`flex items-center border-b border-surface-4 px-3 py-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <span className="text-sm font-bold text-slate-100 truncate">⚽ WC 2026 Tulosveto</span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-surface-3 hover:text-slate-100"
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => (
          <SideNavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
        {isAdmin && (
          <SideNavLink
            item={{ to: '/admin', label: 'Admin', icon: '⚙️', end: false }}
            collapsed={collapsed}
          />
        )}
      </nav>

      {/* Bottom section — intentionally empty for now */}
      <div className="border-t border-surface-4 p-2" />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Mobile drawer
// ---------------------------------------------------------------------------

function MobileDrawer({
  open,
  onClose,
  isAdmin,
}: {
  open: boolean
  onClose: () => void
  isAdmin: boolean
}) {
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)

  // Close on route change
  useEffect(() => { onClose() }, [location.pathname])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-200 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      {/* Drawer */}
      <div
        ref={ref}
        className={`fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-surface-4 bg-surface-0 transition-transform duration-200 lg:hidden ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-surface-4 px-4 py-4">
          <span className="text-sm font-bold text-slate-100">⚽ WC 2026 Tulosveto</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-surface-3 hover:text-slate-100"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.map((item) => (
            <SideNavLink key={item.to} item={item} collapsed={false} onClick={onClose} />
          ))}
          {isAdmin && (
            <SideNavLink
              item={{ to: '/admin', label: 'Admin', icon: '⚙️' }}
              collapsed={false}
              onClick={onClose}
            />
          )}
        </nav>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Top bar (mobile only — hamburger + title + user)
// ---------------------------------------------------------------------------

function TopBar({
  onMenuOpen,
  onSignOut,
}: {
  onMenuOpen: () => void
  onSignOut: () => void
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-surface-4 bg-surface-0/90 px-4 py-3 backdrop-blur lg:hidden">
      <button
        type="button"
        onClick={onMenuOpen}
        aria-label="Open menu"
        className="flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-surface-3 hover:text-slate-100"
      >
        <span className="flex flex-col gap-1.5">
          <span className="block h-0.5 w-5 bg-current" />
          <span className="block h-0.5 w-5 bg-current" />
          <span className="block h-0.5 w-5 bg-current" />
        </span>
      </button>

      <span className="text-sm font-bold text-slate-100">⚽ WC 2026</span>

      <button
        type="button"
        onClick={onSignOut}
        className="text-xs font-medium text-slate-500 hover:text-slate-200"
      >
        Sign out
      </button>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Desktop top bar (user + sign out, sits above content area)
// ---------------------------------------------------------------------------

function DesktopTopBar({
  displayName,
  onSignOut,
}: {
  displayName?: string
  onSignOut: () => void
}) {
  return (
    <div className="hidden h-14 shrink-0 items-center justify-end gap-4 border-b border-surface-4 px-6 lg:flex">
      <span className="text-sm text-slate-400">
        Hi, <span className="font-semibold text-slate-200">{displayName}</span>
      </span>
      <button
        type="button"
        onClick={onSignOut}
        className="text-sm font-medium text-slate-500 transition hover:text-slate-200"
      >
        Sign out
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed'

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true',
  )
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleToggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/sign-in', { replace: true })
  }

  const displayName = profile?.display_name ?? '…'
  const isAdmin = !!profile?.is_admin

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      {/* Desktop sidebar */}
      <DesktopSidebar collapsed={collapsed} onToggle={handleToggleCollapse} isAdmin={isAdmin} />

      {/* Mobile drawer */}
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} isAdmin={isAdmin} />

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <TopBar
          onMenuOpen={() => setDrawerOpen(true)}
          onSignOut={handleSignOut}
        />

        {/* Desktop top bar */}
        <DesktopTopBar displayName={displayName} onSignOut={handleSignOut} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
