'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BookOpen, Briefcase, ChevronsUpDown, Code2, FileText, LayoutDashboard, LogOut, Menu,
  Monitor, Moon, Plus, SlidersHorizontal, Sun, X,
} from 'lucide-react'
import { ROLE_LABEL, initials } from '@/lib/format'
import { LogoIcon } from '@/components/Logo'

type User = { name: string; email: string; role: string; nbfcName: string }
type Theme = 'system' | 'light' | 'dark'

const NAV = [
  {
    label: 'Lending',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/applications', label: 'Applications', icon: FileText, countKey: 'awaitingChecker' as const },
      { href: '/portfolio', label: 'Portfolio', icon: Briefcase },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/settings', label: 'Credit policy', icon: SlidersHorizontal },
      { href: '/developers', label: 'Developers', icon: Code2, adminOnly: true },
    ],
  },
]

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    if (theme === 'system') localStorage.removeItem('credrail-theme')
    else localStorage.setItem('credrail-theme', theme)
  } catch {}
}

export default function AppShell({ user, awaitingChecker, children }: { user: User; awaitingChecker: number; children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('system')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Read the saved choice once mounted; the inline script in the root layout already applied it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme((document.documentElement.dataset.theme as Theme) || 'system')
  }, [])

  useEffect(() => {
    // Close the mobile drawer on navigation
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menuOpen])

  const counts = { awaitingChecker }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
    router.refresh()
  }

  const chooseTheme = (t: Theme) => {
    setTheme(t)
    applyTheme(t)
  }

  return (
    <div className="shell" data-nav-open={navOpen}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <LogoIcon size={32} />
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">credrail</div>
            <div className="brand-org" title={user.nbfcName}>{user.nbfcName}</div>
          </div>
        </div>

        <div style={{ padding: '0 var(--space-3) var(--space-3)' }}>
          <Link href="/applications/new" className="btn btn-primary btn-block">
            <Plus aria-hidden /> New application
          </Link>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(group => (
            <div key={group.label} className="nav-group">
              <div className="nav-group-label">{group.label}</div>
              {group.items
                .filter(item => !('adminOnly' in item && item.adminOnly) || user.role === 'ADMIN')
                .map(item => {
                  const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/')) ||
                    (item.href === '/applications' && pathname.startsWith('/applications'))
                  const Icon = item.icon
                  const count = 'countKey' in item && item.countKey ? counts[item.countKey] : 0
                  return (
                    <Link key={item.href} href={item.href} className={`nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                      <Icon aria-hidden />
                      {item.label}
                      {count > 0 && <span className="nav-count" title={`${count} awaiting checker`}>{count}</span>}
                    </Link>
                  )
                })}
            </div>
          ))}
          <div className="nav-group">
            <div className="nav-group-label">Resources</div>
            <a href="/docs/api" target="_blank" rel="noreferrer" className="nav-link">
              <BookOpen aria-hidden /> API reference
            </a>
          </div>
        </nav>

        <div className="sidebar-footer" ref={menuRef} style={{ position: 'relative' }}>
          {menuOpen && (
            <div className="menu fade-in" role="menu">
              <div style={{ padding: '6px 12px 8px' }}>
                <div className="small muted">Signed in as</div>
                <div className="small strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
              </div>
              <div className="menu-sep" />
              <div className="small muted" style={{ padding: '6px 12px 2px' }}>Theme</div>
              {([
                ['system', 'System', Monitor],
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon],
              ] as const).map(([value, label, Icon]) => (
                <button key={value} className="menu-item" role="menuitemradio" aria-checked={theme === value} onClick={() => chooseTheme(value)}>
                  <Icon aria-hidden /> {label}
                  {theme === value && <span className="tone-accent" style={{ marginLeft: 'auto' }}>●</span>}
                </button>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" onClick={logout}>
                <LogOut aria-hidden /> Sign out
              </button>
            </div>
          )}
          <button className="user-chip" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <span className="avatar" aria-hidden>{initials(user.name)}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="user-name" style={{ display: 'block' }}>{user.name}</span>
              <span className="user-role">{ROLE_LABEL[user.role] ?? user.role}</span>
            </span>
            <ChevronsUpDown aria-hidden size={16} className="muted" />
          </button>
        </div>
      </aside>

      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden />}

      <div className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setNavOpen(o => !o)} aria-label={navOpen ? 'Close menu' : 'Open menu'}>
            {navOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
          <LogoIcon size={32} />
          <span className="brand-name">credrail</span>
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
