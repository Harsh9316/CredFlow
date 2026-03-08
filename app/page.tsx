'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card animate-fadeIn">
        <div className="login-header">
          <div className="login-logo">CF</div>
          <h1 className="login-title">CredFlow</h1>
          <p className="login-subtitle">NBFC Credit Underwriting Platform</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="alert alert-danger mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              placeholder="admin@credflow.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>Enterprise-grade credit decisioning for NBFCs</p>
        </div>

        <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)', fontSize: '0.75rem' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Demo Credentials:</p>
          <p style={{ color: 'var(--text-secondary)' }}>
            <strong>Admin:</strong> admin@credflow.io / Admin@123<br/>
            <strong>Analyst:</strong> analyst@credflow.io / Analyst@123<br/>
            <strong>Viewer:</strong> viewer@credflow.io / Viewer@123
          </p>
        </div>
      </div>
    </div>
  )
}
