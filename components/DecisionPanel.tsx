'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Cpu, Lock, RotateCcw, ShieldCheck, Undo2, X } from 'lucide-react'
import { Alert, Badge } from '@/components/ui'
import { DECISION, inr } from '@/lib/format'

type Props = {
  applicationId: string
  currentStatus: string
  hasDecision: boolean
  systemDecision?: string
  recommendedAmount?: number
  requestedTenure: number
  defaultRate: number
  userRole: string
  checker?: { pending: boolean; reasons: string[]; makerName: string; canCheck: boolean; blockedReason: string | null } | null
  pendingSanction?: { amount: number; tenure: number; interestRate: number; overrideReason: string | null } | null
}

type Mode = 'idle' | 'approve' | 'reject'

const OUTCOME_MESSAGE: Record<string, string> = {
  SANCTIONED: 'Sanctioned.',
  PENDING_APPROVAL: 'Submitted for checker approval.',
  REJECTED: 'Application rejected.',
  REFERRED: 'Referred for further review.',
  RETURNED: 'Returned to the maker for review.',
}

export default function DecisionPanel({
  applicationId, currentStatus, hasDecision, systemDecision, recommendedAmount, requestedTenure, defaultRate,
  userRole, checker, pendingSanction,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [amount, setAmount] = useState(recommendedAmount ? String(Math.round(recommendedAmount)) : '')
  const [tenure, setTenure] = useState(String(requestedTenure))
  const [rate, setRate] = useState(String(defaultRate))
  const [fee, setFee] = useState('2.0')
  const [conditions, setConditions] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [remarks, setRemarks] = useState('')

  const run = async (label: string, url: string, body?: unknown) => {
    setBusy(label)
    setError('')
    setNotice('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }
      if (data.outcome) {
        setNotice(
          data.outcome === 'PENDING_APPROVAL' && data.checkerReasons?.length
            ? `Submitted for checker approval: ${data.checkerReasons.join('; ')}.`
            : OUTCOME_MESSAGE[data.outcome] ?? 'Done.'
        )
      } else if (data.decision) {
        setNotice(`Engine finished: score ${data.decision.creditScore}, ${DECISION[data.decision.decision]?.label.toLowerCase() ?? data.decision.decision}.`)
      }
      setMode('idle')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const evaluate = () => run('evaluate', `/api/applications/${applicationId}/decide`)
  const decide = (body: Record<string, unknown>) => run(String(body.action), `/api/applications/${applicationId}/process`, body)

  const isTerminal = ['SANCTIONED', 'REJECTED', 'WITHDRAWN'].includes(currentStatus)
  const canAct = ['APPLIED', 'UNDER_REVIEW'].includes(currentStatus)
  const isOverride = (action: 'APPROVE' | 'REJECT') => !!systemDecision && systemDecision !== action

  const header = (
    <div className="card-head">
      <h2 className="card-title">Decision</h2>
      {systemDecision && <span className="small muted">Engine: <strong className="text-2">{DECISION[systemDecision]?.label ?? systemDecision}</strong></span>}
    </div>
  )

  const messages = (
    <>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
    </>
  )

  // ── Checker view ──
  if (currentStatus === 'PENDING_APPROVAL' && checker?.pending) {
    return (
      <section className="card" aria-label="Checker approval">
        <div className="card-head">
          <h2 className="card-title">Checker approval</h2>
          <Badge tone="accent" dot>Awaiting checker</Badge>
        </div>
        <div className="card-body">
          {messages}
          <p className="text-2">
            <strong className="strong">{checker.makerName}</strong> approved
            {pendingSanction && <> <strong className="strong num">{inr(pendingSanction.amount)}</strong> for {pendingSanction.tenure} months at {pendingSanction.interestRate}% p.a.</>}
          </p>
          <div className="section-label mt-4">Second approval required because</div>
          <ul className="reason-list">
            {checker.reasons.map(r => <li key={r} className="reason note"><ShieldCheck aria-hidden />{r}</li>)}
            {pendingSanction?.overrideReason && <li className="reason bad"><RotateCcw aria-hidden />Override reason: {pendingSanction.overrideReason}</li>}
          </ul>

          {checker.canCheck ? (
            <div className="stack-sm mt-6">
              <div className="field">
                <label className="label" htmlFor="checker-remarks">Remarks <span className="muted" style={{ fontWeight: 400 }}>(required to return)</span></label>
                <textarea id="checker-remarks" className="textarea" rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Verified sanction terms against the appraisal" />
              </div>
              <button className="btn btn-success btn-block" disabled={!!busy} onClick={() => decide({ action: 'CONFIRM', remarks: remarks || undefined })}>
                {busy === 'CONFIRM' ? <span className="spinner" aria-hidden /> : <Check aria-hidden />} Confirm sanction
              </button>
              <button className="btn btn-secondary btn-block" disabled={!!busy || !remarks.trim()} onClick={() => decide({ action: 'RETURN', remarks })}>
                {busy === 'RETURN' ? <span className="spinner" aria-hidden /> : <Undo2 aria-hidden />} Return to maker
              </button>
            </div>
          ) : (
            <Alert tone="info" className="mt-6">{checker.blockedReason}</Alert>
          )}
        </div>
      </section>
    )
  }

  // ── Final states ──
  if (isTerminal) {
    return (
      <section className="card" aria-label="Decision">
        {header}
        <div className="card-body">
          <p className="text-2 row"><Lock size={15} aria-hidden /> This application is {currentStatus.toLowerCase()}. No further actions.</p>
        </div>
      </section>
    )
  }

  if (userRole === 'VIEWER') {
    return (
      <section className="card" aria-label="Decision">
        {header}
        <div className="card-body"><p className="text-2 row"><Lock size={15} aria-hidden /> Read-only access. An analyst or admin can act on this application.</p></div>
      </section>
    )
  }

  // ── Maker view ──
  return (
    <section className="card" aria-label="Decision">
      {header}
      <div className="card-body">
        {messages}

        {!hasDecision && canAct && (
          <>
            <p className="text-2">Score this application under your active credit policy. Fraud checks, the bureau overlay and loan sizing all run together.</p>
            <button className="btn btn-primary btn-block mt-4" onClick={evaluate} disabled={!!busy}>
              {busy === 'evaluate' ? <><span className="spinner" aria-hidden /> Running engine…</> : <><Cpu aria-hidden /> Run underwriting engine</>}
            </button>
          </>
        )}

        {hasDecision && canAct && mode === 'idle' && (
          <div className="stack-sm">
            <button className="btn btn-success btn-block" onClick={() => setMode('approve')} disabled={!!busy}>
              <Check aria-hidden /> Approve & sanction
            </button>
            <button className="btn btn-secondary btn-block" onClick={() => decide({ action: 'REFER' })} disabled={!!busy}>
              {busy === 'REFER' ? <span className="spinner" aria-hidden /> : <RotateCcw aria-hidden />} Refer for review
            </button>
            <button
              className="btn btn-danger btn-block"
              disabled={!!busy}
              onClick={() => (isOverride('REJECT') ? setMode('reject') : decide({ action: 'REJECT' }))}
            >
              {busy === 'REJECT' ? <span className="spinner" aria-hidden /> : <X aria-hidden />} Reject
            </button>
            <button className="btn btn-ghost btn-sm" onClick={evaluate} disabled={!!busy} style={{ alignSelf: 'center' }}>
              {busy === 'evaluate' ? <span className="spinner" aria-hidden /> : <Cpu aria-hidden />} Re-run engine
            </button>
          </div>
        )}

        {mode !== 'idle' && (
          <form
            className="stack-sm fade-in"
            style={{ gap: 'var(--space-4)' }}
            onSubmit={e => {
              e.preventDefault()
              if (mode === 'approve') {
                decide({
                  action: 'APPROVE',
                  sanctionedAmount: amount,
                  sanctionedTenure: tenure,
                  interestRate: rate,
                  processingFee: fee,
                  conditions,
                  overrideReason: isOverride('APPROVE') ? overrideReason : undefined,
                })
              } else {
                decide({ action: 'REJECT', overrideReason })
              }
            }}
          >
            <div className="strong">{mode === 'approve' ? 'Sanction terms' : 'Reject against recommendation'}</div>

            {isOverride(mode === 'approve' ? 'APPROVE' : 'REJECT') && (
              <Alert tone="warning" title={`Overriding the engine's ${DECISION[systemDecision!]?.label.toLowerCase()} recommendation`}>
                <div className="field mt-2">
                  <label className="sr-only" htmlFor="override-reason">Reason for override</label>
                  <textarea id="override-reason" className="textarea" rows={2} required value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Reason for override (required, recorded in the audit trail)" />
                </div>
              </Alert>
            )}

            {mode === 'approve' && (
              <>
                <div className="field">
                  <label className="label" htmlFor="amount">Sanctioned amount</label>
                  <div className="input-affix">
                    <span>₹</span>
                    <input id="amount" className="input has-prefix num" type="number" min={1} required value={amount} onChange={e => setAmount(e.target.value)} />
                  </div>
                  {amount && <span className="hint">{inr(Number(amount))}{recommendedAmount ? ` · engine recommended ${inr(recommendedAmount)}` : ''}</span>}
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
                  <div className="field">
                    <label className="label" htmlFor="tenure">Tenure</label>
                    <div className="input-affix"><input id="tenure" className="input num" type="number" min={1} required value={tenure} onChange={e => setTenure(e.target.value)} style={{ paddingRight: 34 }} /><span>mo</span></div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="rate">Rate</label>
                    <div className="input-affix"><input id="rate" className="input num" type="number" step="0.1" required value={rate} onChange={e => setRate(e.target.value)} style={{ paddingRight: 28 }} /><span>%</span></div>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="fee">Fee</label>
                    <div className="input-affix"><input id="fee" className="input num" type="number" step="0.1" value={fee} onChange={e => setFee(e.target.value)} style={{ paddingRight: 28 }} /><span>%</span></div>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="conditions">Conditions <span className="muted" style={{ fontWeight: 400 }}>(one per line)</span></label>
                  <textarea id="conditions" className="textarea" rows={3} value={conditions} onChange={e => setConditions(e.target.value)} placeholder={'Post-dated cheques for 3 EMIs\nQuarterly stock statements'} />
                </div>
              </>
            )}

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('idle')} disabled={!!busy}>Cancel</button>
              <button type="submit" className={mode === 'approve' ? 'btn btn-success' : 'btn btn-danger'} disabled={!!busy}>
                {busy ? <span className="spinner" aria-hidden /> : mode === 'approve' ? <Check aria-hidden /> : <X aria-hidden />}
                {mode === 'approve' ? 'Confirm sanction' : 'Confirm rejection'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
