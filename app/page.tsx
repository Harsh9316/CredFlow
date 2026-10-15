'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, CheckCircle2, FileCheck2, GitBranch, ShieldCheck } from 'lucide-react'
import { Alert } from '@/components/ui'

const DEMO_ACCOUNTS = [
  { label: 'Admin · checker', email: 'admin@credflow.io', password: 'Admin@123' },
  { label: 'Credit analyst', email: 'analyst@credflow.io', password: 'Analyst@123' },
  { label: 'Viewer', email: 'viewer@credflow.io', password: 'Viewer@123' },
  { label: 'Second NBFC admin', email: 'admin@smegrowth.in', password: 'Admin@123' },
]

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const signIn = async (credentials: { email: string; password: string }) => {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Sign-in failed')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <span className="brand-mark" style={{ background: '#6d6af7', color: '#fff' }} aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17l5-5 4 4 7-8" />
              <path d="M15 8h5v5" />
            </svg>
          </span>
          <span className="brand-name" style={{ color: '#fff' }}>CredFlow</span>
        </div>

        <div>
          <h1 className="auth-headline">Credit decisions your analysts, auditors and regulators can follow.</h1>
          <p className="auth-sub">
            Open-source underwriting for NBFCs. Fraud checks, a cash-flow scorecard and loan sizing, all run under your own
            versioned credit policy.
          </p>
          <ul className="auth-points">
            <li><FileCheck2 aria-hidden /> Every recommendation comes with its score breakdown and reasons</li>
            <li><GitBranch aria-hidden /> Policy as code: every decision is linked to the exact policy version</li>
            <li><ShieldCheck aria-hidden /> Maker-checker sanctions and an append-only audit trail</li>
          </ul>
        </div>

        <div className="auth-preview" aria-hidden>
          <div className="between">
            <span className="auth-preview-label">FFC-2026-0017 · Shakti Auto Components</span>
            <span className="badge" style={{ background: 'rgba(71,205,137,.14)', borderColor: 'rgba(71,205,137,.3)', color: '#6ee7a8' }}>Approve</span>
          </div>
          <div className="between" style={{ marginTop: 14 }}>
            <span style={{ fontSize: 30, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>82<span style={{ fontSize: 14, color: '#8e93ab', fontWeight: 500 }}> / 100</span></span>
            <span style={{ textAlign: 'right' }}>
              <span className="auth-preview-label" style={{ display: 'block' }}>Recommended</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>₹35.0 L · 36 mo</span>
            </span>
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 6, fontSize: 13, color: '#c9cde0' }}>
            <span className="row"><CheckCircle2 size={14} color="#6ee7a8" aria-hidden /> Strong EMI coverage ratio (≥2x)</span>
            <span className="row"><CheckCircle2 size={14} color="#6ee7a8" aria-hidden /> Secured by property worth ₹80.0 L</span>
            <span className="row"><CheckCircle2 size={14} color="#6ee7a8" aria-hidden /> GSTIN active · PAN verified</span>
          </div>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          <h2 style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em' }}>Sign in</h2>
          <p className="muted mt-1">Use your NBFC work account.</p>

          <form
            className="stack-sm mt-6"
            style={{ gap: 'var(--space-4)' }}
            onSubmit={e => {
              e.preventDefault()
              signIn({ email, password })
            }}
          >
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@nbfc.in" required />
            </div>
            <div className="field">
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" className="btn btn-primary btn-lg btn-block mt-2" disabled={loading}>
              {loading ? <><span className="spinner" aria-hidden /> Signing in…</> : <>Sign in <ArrowRight aria-hidden /></>}
            </button>
          </form>

          {process.env.NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS === 'true' && (
            <div className="demo-accounts">
              <div className="small strong">Demo accounts</div>
              <div className="small muted">Seeded data only. Select one to sign in.</div>
              <div className="demo-list">
                {DEMO_ACCOUNTS.map(a => (
                  <button key={a.email} type="button" className="demo-btn" disabled={loading} onClick={() => {
                    setEmail(a.email)
                    setPassword(a.password)
                    signIn(a)
                  }}>
                    <strong>{a.label}</strong>
                    <span>{a.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
