'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Key = { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
type Endpoint = { id: string; url: string; description: string | null; events: string[]; isActive: boolean; createdAt: string }
type Delivery = { id: string; eventType: string; url: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; createdAt: string }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function DeveloperSettings({ scopes, eventTypes, keys, endpoints, deliveries }: {
  scopes: { id: string; description: string }[]
  eventTypes: string[]
  keys: Key[]
  endpoints: Endpoint[]
  deliveries: Delivery[]
}) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [keyName, setKeyName] = useState('')
  const [keyScopes, setKeyScopes] = useState<string[]>(['applications:read', 'applications:write', 'applications:evaluate'])
  const [hookUrl, setHookUrl] = useState('')
  const [hookEvents, setHookEvents] = useState<string[]>(['*'])

  async function call(url: string, init: RequestInit) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      return data
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {error && <div className="alert alert-danger"><span>{error}</span></div>}
      {notice && <div className="alert alert-success"><span>{notice}</span></div>}
      {secret && (
        <div className="alert alert-warning" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <strong>{secret.label}: copy it now. It will not be shown again.</strong>
          <code className="font-mono" style={{ wordBreak: 'break-all', marginTop: 'var(--space-2)', userSelect: 'all' }}>{secret.value}</code>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--space-2)', alignSelf: 'flex-start' }} onClick={() => setSecret(null)}>Done</button>
        </div>
      )}

      {/* API keys */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">API Keys</h3></div>
        <form
          onSubmit={async e => {
            e.preventDefault()
            const data = await call('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName, scopes: keyScopes }) })
            if (data) {
              setSecret({ label: `API key "${data.name}"`, value: data.key })
              setKeyName('')
              router.refresh()
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="key-name">Name</label>
            <input id="key-name" className="form-input" value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="e.g. ERP integration" required />
          </div>
          <fieldset style={{ border: 'none', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-2)' }}>
            <legend className="form-label">Scopes</legend>
            {scopes.map(s => (
              <label key={s.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', fontSize: '0.875rem' }}>
                <input type="checkbox" checked={keyScopes.includes(s.id)} onChange={() => setKeyScopes(toggle(keyScopes, s.id))} />
                <span><span className="font-mono">{s.id}</span><br /><span className="text-muted text-xs">{s.description}</span></span>
              </label>
            ))}
          </fieldset>
          <button className="btn btn-primary" disabled={busy || !keyName || keyScopes.length === 0} style={{ alignSelf: 'flex-start' }}>Create API key</button>
        </form>

        {keys.length > 0 && (
          <div className="table-container" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} style={k.revokedAt ? { opacity: 0.5 } : undefined}>
                    <td>{k.name}</td>
                    <td className="font-mono text-xs">cf_{k.prefix}_…</td>
                    <td className="text-xs">{k.scopes.join(', ')}</td>
                    <td className="text-xs text-muted">{fmt(k.lastUsedAt)}</td>
                    <td>
                      {k.revokedAt ? <span className="badge badge-gray">Revoked</span> : (
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                          if (!confirm(`Revoke "${k.name}"? Requests using it will start failing immediately.`)) return
                          if (await call(`/api/admin/api-keys/${k.id}`, { method: 'DELETE' })) router.refresh()
                        }}>Revoke</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">Webhooks</h3></div>
        <form
          onSubmit={async e => {
            e.preventDefault()
            const data = await call('/api/admin/webhooks', { method: 'POST', body: JSON.stringify({ url: hookUrl, events: hookEvents }) })
            if (data) {
              setSecret({ label: `Signing secret for ${data.url}`, value: data.secret })
              setHookUrl('')
              router.refresh()
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}
        >
          <div className="form-group">
            <label className="form-label" htmlFor="hook-url">Endpoint URL</label>
            <input id="hook-url" className="form-input" type="url" value={hookUrl} onChange={e => setHookUrl(e.target.value)} placeholder="https://example.com/credflow-webhook" required />
          </div>
          <fieldset style={{ border: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            <legend className="form-label">Events</legend>
            {['*', ...eventTypes].map(t => (
              <label key={t} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', fontSize: '0.875rem' }}>
                <input type="checkbox" checked={hookEvents.includes(t)} onChange={() => setHookEvents(toggle(hookEvents, t))} />
                <span className="font-mono">{t === '*' ? 'all events' : t}</span>
              </label>
            ))}
          </fieldset>
          <button className="btn btn-primary" disabled={busy || !hookUrl || hookEvents.length === 0} style={{ alignSelf: 'flex-start' }}>Add endpoint</button>
        </form>

        {endpoints.length > 0 && (
          <div className="table-container" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>URL</th><th>Events</th><th></th></tr></thead>
              <tbody>
                {endpoints.map(ep => (
                  <tr key={ep.id}>
                    <td className="font-mono text-xs" style={{ wordBreak: 'break-all' }}>{ep.url}</td>
                    <td className="text-xs">{ep.events.join(', ')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                        const r = await call(`/api/admin/webhooks/${ep.id}/test`, { method: 'POST' })
                        if (r) {
                          if (r.delivered) setNotice(`Test event delivered (HTTP ${r.responseStatus})`)
                          else setError(`Test delivery failed: ${r.error ?? 'unknown error'}`)
                          router.refresh()
                        }
                      }}>Send test</button>
                      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                        if (!confirm(`Delete the endpoint ${ep.url}?`)) return
                        if (await call(`/api/admin/webhooks/${ep.id}`, { method: 'DELETE' })) router.refresh()
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deliveries */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">Recent Deliveries</h3></div>
        {deliveries.length === 0 ? <p className="text-muted">No webhook deliveries yet.</p> : (
          <div className="table-container" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Event</th><th>Endpoint</th><th>Status</th><th>Attempts</th><th>Created</th></tr></thead>
              <tbody>
                {deliveries.map(d => (
                  <tr key={d.id}>
                    <td className="font-mono text-xs">{d.eventType}</td>
                    <td className="font-mono text-xs" style={{ wordBreak: 'break-all' }}>{d.url}</td>
                    <td>
                      <span className={`badge ${d.status === 'SUCCEEDED' ? 'badge-success' : d.status === 'FAILED' ? 'badge-danger' : 'badge-warning'}`}>{d.status}</span>
                      {d.lastError && <div className="text-xs text-muted" title={d.lastError}>{d.lastError.slice(0, 60)}</div>}
                    </td>
                    <td>{d.attempts}</td>
                    <td className="text-xs text-muted">{fmt(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
