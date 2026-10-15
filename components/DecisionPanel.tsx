'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type DecisionPanelProps = {
  applicationId: string
  currentStatus: string
  hasDecision: boolean
  systemDecision?: string
  recommendedAmount?: number
  userRole: string
  checker?: { pending: boolean; reasons: string[]; makerName: string; canCheck: boolean; blockedReason: string | null } | null
  pendingSanction?: { amount: number; tenure: number; interestRate: number; overrideReason: string | null } | null
}

const formatINR = (n: number) => `₹${(n / 100000).toFixed(1)}L`

export default function DecisionPanel({ 
  applicationId, 
  currentStatus, 
  hasDecision, 
  systemDecision,
  recommendedAmount,
  userRole,
  checker,
  pendingSanction,
}: DecisionPanelProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState('')
  const [showApprovalForm, setShowApprovalForm] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Approval form fields
  const [sanctionedAmount, setSanctionedAmount] = useState(recommendedAmount?.toString() || '')
  const [sanctionedTenure, setSanctionedTenure] = useState('')
  const [interestRate, setInterestRate] = useState('14.0')
  const [processingFee, setProcessingFee] = useState('2.0')
  const [conditions, setConditions] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [checkerRemarks, setCheckerRemarks] = useState('')

  const runDecisionEngine = async () => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/applications/${applicationId}/decide`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to run decision')
        return
      }
      setSuccess(`Underwriting engine completed: Score ${data.decision.creditScore}/100 → ${data.decision.decision}`)
      setTimeout(() => router.refresh(), 1500)
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const processAction = async (selectedAction: string) => {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const body: Record<string, unknown> = { action: selectedAction }
      if (selectedAction === 'APPROVE') {
        body.sanctionedAmount = sanctionedAmount
        body.sanctionedTenure = sanctionedTenure
        body.interestRate = interestRate
        body.processingFee = processingFee
        body.conditions = conditions
      }
      if (overrideReason) body.overrideReason = overrideReason
      if (checkerRemarks && (selectedAction === 'CONFIRM' || selectedAction === 'RETURN')) body.remarks = checkerRemarks

      const res = await fetch(`/api/applications/${applicationId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to process')
        return
      }
      const messages: Record<string, string> = {
        SANCTIONED: 'Application sanctioned',
        PENDING_APPROVAL: `Submitted for checker approval: ${(data.checkerReasons || []).join('; ')}`,
        REJECTED: 'Application rejected',
        REFERRED: 'Application referred for review',
        RETURNED: 'Sanction returned to the maker for review',
      }
      setSuccess(messages[data.outcome] || 'Done')
      setTimeout(() => router.refresh(), 1500)
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const isViewOnly = userRole === 'VIEWER'
  const canProcess = ['APPLIED', 'UNDER_REVIEW'].includes(currentStatus)
  const isTerminal = ['SANCTIONED', 'REJECTED', 'WITHDRAWN'].includes(currentStatus)

  if (isTerminal) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Underwriting Actions</h3>
        </div>
        <div style={{textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-muted)'}}>
          <p>This application has been <strong>{currentStatus.toLowerCase()}</strong>. No further actions available.</p>
        </div>
      </div>
    )
  }

  if (currentStatus === 'PENDING_APPROVAL' && checker?.pending) {
    return (
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Checker Approval</h3>
          <span className="badge badge-warning">Awaiting checker</span>
        </div>
        {error && <div className="alert alert-danger mb-4"><span>{error}</span></div>}
        {success && <div className="alert alert-success mb-4"><span>{success}</span></div>}
        <p style={{fontSize: '0.875rem', marginBottom: 'var(--space-3)'}}>
          <strong>{checker.makerName}</strong> approved a sanction
          {pendingSanction && <> of <strong>{formatINR(pendingSanction.amount)}</strong> for {pendingSanction.tenure} months at {pendingSanction.interestRate}% p.a.</>}.
          A second approver is required because:
        </p>
        <ul style={{fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', paddingLeft: 'var(--space-5)'}}>
          {checker.reasons.map(r => <li key={r}>{r}</li>)}
          {pendingSanction?.overrideReason && <li>Maker&apos;s override reason: {pendingSanction.overrideReason}</li>}
        </ul>
        {checker.canCheck ? (
          <>
            <div className="form-group" style={{marginBottom: 'var(--space-3)'}}>
              <label className="form-label" htmlFor="checker-remarks">Remarks (required to return)</label>
              <textarea id="checker-remarks" className="form-input" rows={2} value={checkerRemarks} onChange={e => setCheckerRemarks(e.target.value)} />
            </div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'}}>
              <button className="btn btn-primary" style={{background: 'var(--accent-green)', borderColor: 'var(--accent-green)'}} disabled={loading} onClick={() => processAction('CONFIRM')}>
                ✓ Confirm Sanction
              </button>
              <button className="btn btn-ghost" style={{borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)'}} disabled={loading || !checkerRemarks.trim()} onClick={() => processAction('RETURN')}>
                ↩ Return to Maker
              </button>
            </div>
          </>
        ) : (
          <p className="text-muted" style={{fontSize: '0.875rem'}}>{checker.blockedReason}</p>
        )}
      </div>
    )
  }

  if (isViewOnly) {
    return (
      <div className="card">
        <div className="card-header"><h3 className="card-title">Underwriting Actions</h3></div>
        <div style={{textAlign: 'center', padding: 'var(--space-4)', color: 'var(--text-muted)'}}>
          <p>Read-only access. Contact an Admin or Analyst to process this application.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3 className="card-title">Underwriting Actions</h3>
        <span className="badge badge-primary">{currentStatus.replace('_', ' ')}</span>
      </div>

      {error && <div className="alert alert-danger mb-4"><span>{error}</span></div>}
      {success && <div className="alert alert-success mb-4"><span>{success}</span></div>}

      {/* Step 1: Run Decision Engine */}
      {!hasDecision && canProcess && (
        <div style={{marginBottom: 'var(--space-4)'}}>
          <p style={{fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3)'}}>
            Run the underwriting recommendation engine to generate a score and eligibility assessment.
          </p>
          <button className="btn btn-primary" onClick={runDecisionEngine} disabled={loading} style={{width: '100%'}}>
            {loading ? <><span className="spinner" style={{width: 16, height: 16}}></span> Running...</> : '⚡ Run Underwriting Engine'}
          </button>
        </div>
      )}

      {/* Step 2: Process Decision */}
      {hasDecision && canProcess && !showApprovalForm && (
        <div>
          <p style={{fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3)'}}>
            System recommends: <strong style={{color: systemDecision === 'APPROVE' ? 'var(--accent-green)' : systemDecision === 'REJECT' ? 'var(--accent-red)' : 'var(--accent-yellow)'}}>{systemDecision}</strong>
          </p>
          <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'}}>
            <button className="btn btn-primary" style={{background: 'var(--accent-green)', borderColor: 'var(--accent-green)'}} onClick={() => { setAction('APPROVE'); setShowApprovalForm(true) }}>
              ✓ Approve & Sanction
            </button>
            <button className="btn btn-ghost" style={{borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)'}} onClick={() => processAction('REFER')}>
              ↻ Refer for Review
            </button>
            <button className="btn btn-ghost" style={{borderColor: 'var(--accent-red)', color: 'var(--accent-red)'}} onClick={() => {
              if (systemDecision === 'APPROVE') {
                setAction('REJECT')
                setShowApprovalForm(true) // need override reason
              } else {
                processAction('REJECT')
              }
            }}>
              ✕ Reject
            </button>
          </div>
          {/* Re-run decision */}
          <button className="btn btn-ghost btn-sm" onClick={runDecisionEngine} disabled={loading} style={{width: '100%', marginTop: 'var(--space-3)'}}>
            {loading ? 'Running...' : '↻ Re-run Underwriting Engine'}
          </button>
        </div>
      )}

      {/* Approval / Override Form */}
      {showApprovalForm && (
        <div className="animate-fadeIn">
          <h4 style={{fontWeight: 600, marginBottom: 'var(--space-4)', color: action === 'APPROVE' ? 'var(--accent-green)' : 'var(--accent-red)'}}>
            {action === 'APPROVE' ? '✓ Sanction Details' : '✕ Rejection Override'}
          </h4>

          {/* Override warning */}
          {systemDecision && systemDecision !== action && (
            <div className="alert alert-warning mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" /></svg>
              <div>
                <strong>System Override:</strong> You are overriding the system&apos;s {systemDecision} recommendation.
                <div className="form-group" style={{marginTop: 'var(--space-2)'}}>
                  <input className="form-input" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Reason for override (required)" />
                </div>
              </div>
            </div>
          )}

          {action === 'APPROVE' && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'}}>
              <div className="form-group">
                <label className="form-label">Sanctioned Amount (₹)</label>
                <input className="form-input" type="number" value={sanctionedAmount} onChange={e => setSanctionedAmount(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Tenure (months)</label>
                <input className="form-input" type="number" value={sanctionedTenure} onChange={e => setSanctionedTenure(e.target.value)} />
              </div>
              <div className="grid-2" style={{gap: 'var(--space-3)'}}>
                <div className="form-group">
                  <label className="form-label">Interest Rate (% p.a.)</label>
                  <input className="form-input" type="number" step="0.1" value={interestRate} onChange={e => setInterestRate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Processing Fee (%)</label>
                  <input className="form-input" type="number" step="0.1" value={processingFee} onChange={e => setProcessingFee(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Conditions (one per line)</label>
                <textarea className="form-input" rows={3} value={conditions} onChange={e => setConditions(e.target.value)} placeholder={"Submission of post-dated cheques\nQuarterly financial review\nMaintain minimum balance"} style={{resize: 'vertical'}} />
              </div>
            </div>
          )}

          <div style={{display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)'}}>
            <button className="btn btn-ghost" onClick={() => { setShowApprovalForm(false); setAction('') }}>Cancel</button>
            <button
              className="btn btn-primary"
              style={action === 'REJECT' ? {background: 'var(--accent-red)', borderColor: 'var(--accent-red)'} : {}}
              disabled={loading || (systemDecision !== action && !overrideReason)}
              onClick={() => processAction(action)}
            >
              {loading ? 'Processing...' : action === 'APPROVE' ? 'Confirm Sanction' : 'Confirm Rejection'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
