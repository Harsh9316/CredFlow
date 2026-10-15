'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'

type SessionUser = {
  id: string
  name: string
  email: string
  role: string
  nbfcName: string
}

const navItems = [
  { 
    section: 'Overview',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' }
    ]
  },
  {
    section: 'Lending',
    items: [
      { name: 'Applications', href: '/applications', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { name: 'Portfolio', href: '/portfolio', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' }
    ]
  },
  {
    section: 'Administration',
    items: [
      { name: 'Settings', href: '/settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
      { name: 'Developers', href: '/developers', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' }
    ]
  }
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => {
        if (data.user) {
          setUser(data.user)
        } else {
          router.push('/')
        }
      })
      .catch(() => {
        router.push('/')
      })
  }, [router])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'NBFC Admin'
      case 'ANALYST': return 'Credit Analyst'
      case 'VIEWER': return 'Read-only Viewer'
      default: return role
    }
  }

  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-icon">CF</div>
        <span className="logo-text">CredFlow</span>
      </div>

      <nav>
        {navItems.map((section) => (
          <div key={section.section} className="nav-section">
            <div className="nav-section-title">{section.section}</div>
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${pathname === item.href || pathname.startsWith(item.href + '/') ? 'active' : ''}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                </svg>
                <span>{item.name}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="user-menu">
        {user && (
          <div className="user-info" onClick={handleLogout} title="Click to logout">
            <div className="user-avatar">
              {user.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="user-details">
              <div className="user-name">{user.name}</div>
              <div className="user-role">{getRoleLabel(user.role)}</div>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{width: 16, height: 16, opacity: 0.5}}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </div>
        )}
      </div>
    </aside>
  )
}
