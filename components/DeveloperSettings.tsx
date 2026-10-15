'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, KeyRound, Plus, Send, Trash2, Webhook } from 'lucide-react'
import { Alert, Badge, Card, EmptyState } from '@/components/ui'

type Key = { id: string; name: string; prefix: string; scopes: string[]; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }
type Endpoint = { id: string; url: string; description: string | null; events: string[]; isActive: boolean; createdAt: string }
type Delivery = { id: string; eventType: string; url: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; createdAt: string }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never')

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch {}
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

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
  const [showKeyForm, setShowKeyForm] = useState(false)
  const [showHookForm, setShowHookForm] = useState(false)

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
  const activeKeys = keys.filter(k => !k.revokedAt)

  return (
    <div className="stack">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {secret && (
        <Alert tone="warning" title={`${secret.label}: copy it now`}>
          It won&apos;t be shown again. CredFlow stores only what it needs to verify it.
          <div className="secret">
            <code>{secret.value}</code>
            <CopyButton value={secret.value} />
          </div>
          <button className="btn btn-ghost btn-sm mt-2" onClick={() => setSecret(null)}>I&apos;ve saved it</button>
        </Alert>
      )}

      {/* API keys */}
      <Card
        title="API keys"
        description="Authenticate requests to /api/v1 with Authorization: Bearer cf_…"
        actions={!showKeyForm && <button className="btn btn-secondary btn-sm" onClick={() => setShowKeyForm(true)}><Plus aria-hidden /> Create key</button>}
        flush
      >
        {showKeyForm && (
          <form
            className="card-body fade-in"
            style={{ borderBottom: '1px solid var(--border)' }}
            onSubmit={async e => {
              e.preventDefault()
              const data = await call('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ name: keyName, scopes: keyScopes }) })
              if (data) {
                setSecret({ label: `API key “${data.name}”`, value: data.key })
                setKeyName('')
                setShowKeyForm(false)
                router.refresh()
              }
            }}
          >
            <div className="field" style={{ maxWidth: 420 }}>
              <label className="label" htmlFor="key-name">Name</label>
              <input id="key-name" className="input" value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="ERP integration" required autoFocus />
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 'var(--space-5) 0 0' }}>
              <legend className="label" style={{ marginBottom: 'var(--space-3)' }}>Scopes</legend>
              <div className="choice-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                {scopes.map(s => (
                  <label key={s.id} className={`choice${keyScopes.includes(s.id) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={keyScopes.includes(s.id)} onChange={() => setKeyScopes(toggle(keyScopes, s.id))} />
                    <span className="choice-title mono">{s.id}</span>
                    <span className="choice-desc">{s.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row mt-6" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowKeyForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !keyName || keyScopes.length === 0}>Create key</button>
            </div>
          </form>
        )}

        {keys.length === 0 ? (
          !showKeyForm && <EmptyState icon={<KeyRound size={20} />} title="No API keys">Create a key to start sending applications from your systems.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} style={k.revokedAt ? { opacity: 0.55 } : undefined}>
                    <td className="cell-primary">{k.name}</td>
                    <td className="mono small">cf_{k.prefix}_••••</td>
                    <td className="small" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{k.scopes.join(', ')}</td>
                    <td className="muted small">{when(k.lastUsedAt)}</td>
                    <td className="right">
                      {k.revokedAt ? <Badge>Revoked</Badge> : (
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                          if (!confirm(`Revoke “${k.name}”? Requests using it will fail immediately.`)) return
                          if (await call(`/api/admin/api-keys/${k.id}`, { method: 'DELETE' })) {
                            setNotice(`Revoked “${k.name}”.`)
                            router.refresh()
                          }
                        }}>Revoke</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {activeKeys.length > 0 && <div className="card-foot">{activeKeys.length} active {activeKeys.length === 1 ? 'key' : 'keys'}. Keys are stored as SHA-256 hashes.</div>}
      </Card>

      {/* Webhooks */}
      <Card
        title="Webhooks"
        description="Signed POST requests when applications change"
        actions={!showHookForm && <button className="btn btn-secondary btn-sm" onClick={() => setShowHookForm(true)}><Plus aria-hidden /> Add endpoint</button>}
        flush
      >
        {showHookForm && (
          <form
            className="card-body fade-in"
            style={{ borderBottom: '1px solid var(--border)' }}
            onSubmit={async e => {
              e.preventDefault()
              const data = await call('/api/admin/webhooks', { method: 'POST', body: JSON.stringify({ url: hookUrl, events: hookEvents }) })
              if (data) {
                setSecret({ label: `Signing secret for ${data.url}`, value: data.secret })
                setHookUrl('')
                setShowHookForm(false)
                router.refresh()
              }
            }}
          >
            <div className="field" style={{ maxWidth: 560 }}>
              <label className="label" htmlFor="hook-url">Endpoint URL</label>
              <input id="hook-url" className="input" type="url" value={hookUrl} onChange={e => setHookUrl(e.target.value)} placeholder="https://example.com/credflow-webhook" required autoFocus />
              <span className="hint">Must be https and publicly reachable.</span>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 'var(--space-5) 0 0' }}>
              <legend className="label" style={{ marginBottom: 'var(--space-3)' }}>Events</legend>
              <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2) var(--space-4)' }}>
                {['*', ...eventTypes].map(t => (
                  <label key={t} className="check" style={{ alignItems: 'center' }}>
                    <input type="checkbox" style={{ marginTop: 0 }} checked={hookEvents.includes(t)} onChange={() => setHookEvents(toggle(hookEvents, t))} />
                    <span className={t === '*' ? 'strong' : 'mono small'}>{t === '*' ? 'All events' : t}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row mt-6" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setShowHookForm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy || !hookUrl || hookEvents.length === 0}>Add endpoint</button>
            </div>
          </form>
        )}

        {endpoints.length === 0 ? (
          !showHookForm && <EmptyState icon={<Webhook size={20} />} title="No endpoints">Add an endpoint to be notified when applications are created, evaluated or sanctioned.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Endpoint</th><th>Events</th><th></th></tr></thead>
              <tbody>
                {endpoints.map(ep => (
                  <tr key={ep.id}>
                    <td className="mono small cell-truncate" style={{ maxWidth: 380 }} title={ep.url}>{ep.url}</td>
                    <td className="small">{ep.events.includes('*') ? 'All events' : `${ep.events.length} events`}</td>
                    <td className="right">
                      <span className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
                          const r = await call(`/api/admin/webhooks/${ep.id}/test`, { method: 'POST' })
                          if (r) {
                            if (r.delivered) setNotice(`Test event delivered (HTTP ${r.responseStatus}).`)
                            else setError(`Test delivery failed: ${r.error ?? 'unknown error'}`)
                            router.refresh()
                          }
                        }}><Send aria-hidden /> Test</button>
                        <button className="btn btn-ghost btn-sm" disabled={busy} aria-label={`Delete ${ep.url}`} onClick={async () => {
                          if (!confirm(`Delete the endpoint ${ep.url}?`)) return
                          if (await call(`/api/admin/webhooks/${ep.id}`, { method: 'DELETE' })) router.refresh()
                        }}><Trash2 aria-hidden /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Deliveries */}
      <Card title="Recent deliveries" description="Failed deliveries are retried with backoff for up to 8 attempts" flush>
        {deliveries.length === 0 ? (
          <EmptyState title="No deliveries yet">Deliveries appear here once an endpoint is registered and events occur.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Event</th><th>Endpoint</th><th>Status</th><th className="right">Attempts</th><th>Created</th></tr></thead>
              <tbody>
                {deliveries.map(d => (
                  <tr key={d.id}>
                    <td className="mono small">{d.eventType}</td>
                    <td className="mono small cell-truncate" style={{ maxWidth: 260 }} title={d.url}>{d.url}</td>
                    <td>
                      <span title={d.lastError ?? undefined}>
                        <Badge tone={d.status === 'SUCCEEDED' ? 'success' : d.status === 'FAILED' ? 'danger' : 'warning'} dot>
                          {d.status === 'SUCCEEDED' ? `Delivered${d.responseStatus ? ` · ${d.responseStatus}` : ''}` : d.status === 'FAILED' ? 'Failed' : d.attempts > 0 ? `Retrying · ${d.lastError ?? ''}` : 'Pending'}
                        </Badge>
                      </span>
                    </td>
                    <td className="right num">{d.attempts}</td>
                    <td className="muted small">{when(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
