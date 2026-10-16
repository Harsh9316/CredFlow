'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Landmark, RefreshCw, ShieldCheck } from 'lucide-react'
import { Alert, Badge, Card } from '@/components/ui'
import { dateTime, inr } from '@/lib/format'

export type ConsentView = {
  id: string
  kind: string
  provider: string
  status: string
  consentUrl: string | null
  fiTypes: string[]
  mobile: string | null
  sessionStatus: string | null
  method: string | null
  reference: string | null
  error: string | null
  dataReceived: boolean
  bank: { months?: number; accounts?: number; avgMonthlyInflow?: number; bounceCount?: number; internalTransfersExcluded?: number } | null
  gst: { periodsFiled?: number; annualisedTurnover?: number; missingPeriods?: string[] } | null
  createdAt: string
  completedAt: string | null
}

type Props = {
  applicationId: string
  canAct: boolean
  bankProvider: string
  bureauProvider: string
  defaultMobile: string
  hasGstin: boolean
  consents: ConsentView[]
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'accent' | 'neutral'> = {
  PENDING: 'warning',
  ACTIVE: 'accent',
  REJECTED: 'danger',
  REVOKED: 'danger',
  EXPIRED: 'neutral',
  FAILED: 'danger',
  PAUSED: 'neutral',
  CREATING: 'neutral',
}

function statusLabel(c: ConsentView): { text: string; tone: 'success' | 'warning' | 'danger' | 'accent' | 'neutral' } {
  if (c.kind === 'BUREAU') return { text: 'Recorded', tone: 'success' }
  if (c.dataReceived) return { text: c.error ? 'No usable data' : 'Data received', tone: c.error ? 'warning' : 'success' }
  if (c.status === 'PENDING') return { text: 'Awaiting borrower', tone: 'warning' }
  if (c.status === 'ACTIVE') return { text: c.sessionStatus === 'FAILED' || c.sessionStatus === 'EXPIRED' ? 'Fetch failed' : 'Fetching data', tone: c.sessionStatus === 'FAILED' ? 'danger' : 'accent' }
  return { text: c.status.charAt(0) + c.status.slice(1).toLowerCase(), tone: STATUS_TONE[c.status] ?? 'neutral' }
}

export default function DataConsentsPanel({ applicationId, canAct, bankProvider, bureauProvider, defaultMobile, hasGstin, consents }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [form, setForm] = useState<'none' | 'aa' | 'bureau'>('none')
  const [mobile, setMobile] = useState(defaultMobile.replace(/\D/g, '').slice(-10))
  const [includeGst, setIncludeGst] = useState(hasGstin)
  const [method, setMethod] = useState<'DIGITAL' | 'PHYSICAL'>('DIGITAL')
  const [reference, setReference] = useState('')

  const aa = consents.filter(c => c.kind === 'ACCOUNT_AGGREGATOR')
  const bureau = consents.filter(c => c.kind === 'BUREAU')
  const mock = bankProvider === 'mock'

  const post = async (label: string, url: string, body?: unknown) => {
    setBusy(label)
    setError('')
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return null
      }
      setForm('none')
      router.refresh()
      return data
    } catch {
      setError('Could not reach the server. Please try again.')
      return null
    } finally {
      setBusy(null)
    }
  }

  const copy = async (c: ConsentView) => {
    if (!c.consentUrl) return
    try {
      await navigator.clipboard.writeText(c.consentUrl)
      setCopied(c.id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Copy failed; select the link and copy it manually.')
    }
  }

  return (
    <Card
      title="Bank, GST & bureau data"
      description="Borrower-consented data. Only derived figures are stored, never raw transactions."
    >
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {/* Account Aggregator */}
      <div className="between">
        <span className="strong row"><Landmark size={16} aria-hidden /> Account Aggregator</span>
        {bankProvider === 'none'
          ? <Badge>Not configured</Badge>
          : <span className="small muted">via {bankProvider}</span>}
      </div>

      {aa.length === 0 && <p className="small text-2 mt-2">No bank or GST data requested yet.</p>}
      <ul className="stack-sm mt-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {aa.map(c => {
          const s = statusLabel(c)
          return (
            <li key={c.id} className="tile" style={{ padding: 'var(--space-4)' }}>
              <div className="between">
                <span className="small">
                  {c.fiTypes.includes('GSTR1_3B') ? 'Bank statements + GST returns' : 'Bank statements'}
                  {c.mobile && <span className="muted"> · {c.mobile}</span>}
                </span>
                <Badge tone={s.tone} dot>{s.text}</Badge>
              </div>
              {c.bank && (
                <div className="small text-2 mt-2">
                  {c.bank.months} months from {c.bank.accounts} account(s) · avg. inflow <span className="num">{inr(c.bank.avgMonthlyInflow ?? 0)}</span>
                  {' · '}{c.bank.bounceCount ?? 0} returned payment(s){(c.bank.internalTransfersExcluded ?? 0) > 0 && ` · ${c.bank.internalTransfersExcluded} own-account transfers excluded`}
                </div>
              )}
              {c.gst && (
                <div className="small text-2 mt-1">
                  GST: {c.gst.periodsFiled} returns · annualised turnover <span className="num">{inr(c.gst.annualisedTurnover ?? 0)}</span>
                  {(c.gst.missingPeriods?.length ?? 0) > 0 && <span className="tone-warning"> · {c.gst.missingPeriods!.length} period(s) not filed</span>}
                </div>
              )}
              {c.error && !c.dataReceived && <div className="small tone-danger mt-1">{c.error}</div>}
              {c.consentUrl && (
                <div className="mt-2">
                  <div className="small muted">Send this link to the borrower to approve in their Account Aggregator app:</div>
                  <div className="row mt-1" style={{ gap: 'var(--space-2)' }}>
                    <input className="input mono small" readOnly value={c.consentUrl} onFocus={e => e.currentTarget.select()} aria-label="Consent link" />
                    <button className="btn btn-ghost btn-sm" onClick={() => copy(c)} aria-label="Copy consent link">
                      <Copy aria-hidden /> {copied === c.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
              {canAct && !c.dataReceived && !['REJECTED', 'REVOKED', 'EXPIRED', 'FAILED'].includes(c.status) && (
                <button
                  className="btn btn-secondary btn-sm mt-3"
                  disabled={!!busy}
                  onClick={() => post(`sync:${c.id}`, `/api/applications/${applicationId}/data-consents/${c.id}/sync`)}
                >
                  {busy === `sync:${c.id}` ? <span className="spinner" aria-hidden /> : <RefreshCw aria-hidden />} Check status
                </button>
              )}
              <div className="small muted mt-2">Requested {dateTime(c.createdAt)}</div>
            </li>
          )
        })}
      </ul>

      {canAct && bankProvider !== 'none' && (form === 'aa' ? (
        <form
          className="stack-sm mt-4"
          onSubmit={e => {
            e.preventDefault()
            post('aa', `/api/applications/${applicationId}/data-consents`, { mobile, includeGst })
          }}
        >
          <div className="field">
            <label className="label" htmlFor="aa-mobile">Borrower&apos;s mobile (registered with their bank)</label>
            <input id="aa-mobile" className="input" inputMode="numeric" value={mobile} onChange={e => setMobile(e.target.value)} placeholder="98XXXXXXXX" required autoFocus />
            {mock && <span className="hint">Mock provider: a number ending in 0000 simulates the borrower rejecting.</span>}
          </div>
          <label className="row small">
            <input type="checkbox" checked={includeGst} onChange={e => setIncludeGst(e.target.checked)} /> Also request GST returns (GSTR-1/3B)
          </label>
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={!!busy}>{busy === 'aa' ? <span className="spinner" aria-hidden /> : null} Create consent request</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm('none')}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-secondary btn-sm mt-4" onClick={() => setForm('aa')} disabled={!!busy}>Request bank data</button>
      ))}

      {/* Bureau consent */}
      <div className="between mt-6">
        <span className="strong row"><ShieldCheck size={16} aria-hidden /> Bureau consent</span>
        {bureauProvider === 'none' ? <Badge>No bureau configured</Badge> : <span className="small muted">via {bureauProvider}</span>}
      </div>
      {bureau.length === 0
        ? <p className="small text-2 mt-2">No consent recorded. Underwriting skips the bureau pull until there is one.</p>
        : (
          <p className="small text-2 mt-2">
            {bureau[0].method === 'DIGITAL' ? 'Digital' : 'Physical'} consent, ref <span className="mono">{bureau[0].reference}</span>, given {dateTime(bureau[0].completedAt ?? bureau[0].createdAt)}
          </p>
        )}
      {canAct && (form === 'bureau' ? (
        <form
          className="stack-sm mt-3"
          onSubmit={e => {
            e.preventDefault()
            post('bureau', `/api/applications/${applicationId}/bureau-consent`, { method, reference })
          }}
        >
          <div className="field">
            <label className="label" htmlFor="bureau-method">How was consent given?</label>
            <select id="bureau-method" className="select" value={method} onChange={e => setMethod(e.target.value as 'DIGITAL' | 'PHYSICAL')}>
              <option value="DIGITAL">Digitally (OTP, e-sign, click-wrap)</option>
              <option value="PHYSICAL">Signed form</option>
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="bureau-ref">Consent reference</label>
            <input id="bureau-ref" className="input" value={reference} onChange={e => setReference(e.target.value)} placeholder="e-sign id or form number" required />
          </div>
          <div className="row">
            <button className="btn btn-primary btn-sm" disabled={!!busy || !reference.trim()}>{busy === 'bureau' ? <span className="spinner" aria-hidden /> : null} Record consent</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm('none')}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-secondary btn-sm mt-3" onClick={() => setForm('bureau')} disabled={!!busy}>
          {bureau.length ? 'Record a new consent' : 'Record bureau consent'}
        </button>
      ))}
    </Card>
  )
}
