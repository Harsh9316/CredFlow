import prisma from '@/lib/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import DecisionPanel from '@/components/DecisionPanel'
import { requirePageSession } from '@/lib/auth'

async function getApplication(id: string, nbfcId: string) {
  const application = await prisma.loanApplication.findFirst({
    where: { id, nbfcId },
    include: {
      borrower: true,
      collateral: true,
      creditDecision: true,
      approval: true,
      auditLogs: {
        orderBy: { timestamp: 'desc' },
        include: {
          user: { select: { name: true } }
        }
      }
    }
  })
  
  if (!application) return null

  // Get financial data for borrower
  const financialData = await prisma.financialData.findFirst({
    where: { borrowerId: application.borrowerId },
    orderBy: { periodEnd: 'desc' }
  })

  return { ...application, financialData }
}

function formatAmount(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`
  } else if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(1)} L`
  }
  return `₹${amount.toLocaleString()}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function getStatusBadge(status: string) {
  const statusConfig: Record<string, { class: string; label: string }> = {
    APPLIED: { class: 'badge-primary', label: 'Applied' },
    UNDER_REVIEW: { class: 'badge-warning', label: 'Under Review' },
    PENDING_DOCS: { class: 'badge-gray', label: 'Pending Docs' },
    APPROVED: { class: 'badge-success', label: 'Approved' },
    REJECTED: { class: 'badge-danger', label: 'Rejected' },
    SANCTIONED: { class: 'badge-purple', label: 'Sanctioned' },
    WITHDRAWN: { class: 'badge-gray', label: 'Withdrawn' }
  }
  const config = statusConfig[status] || { class: 'badge-gray', label: status }
  return <span className={`badge ${config.class}`}>{config.label}</span>
}

function getDecisionBanner(decision: string) {
  const config: Record<string, { class: string; label: string; icon: string }> = {
    APPROVE: { 
      class: 'approve', 
      label: 'Recommended for Approval',
      icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
    },
    REFER: { 
      class: 'refer', 
      label: 'Refer for Manual Review',
      icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
    },
    REJECT: { 
      class: 'reject', 
      label: 'Not Recommended',
      icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
    }
  }
  const item = config[decision] || config.REFER
  
  return (
    <div className={`decision-banner ${item.class}`}>
      <div className="decision-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
        </svg>
      </div>
      <h3 className="decision-title">{item.label}</h3>
    </div>
  )
}

function getCollateralTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    LAP: 'Loan Against Property',
    MACHINERY: 'Machinery',
    INVOICE: 'Invoice Financing',
    STOCK: 'Stock/Inventory',
    FD: 'Fixed Deposit',
    NONE: 'Unsecured'
  }
  return labels[type] || type
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requirePageSession()
  const application = await getApplication(id, session.nbfcId)

  if (!application) {
    notFound()
  }

  const { borrower, collateral, creditDecision, approval, financialData, auditLogs } = application

  // Parse JSON fields
  const scoreBreakdown = creditDecision?.scoreBreakdown ? JSON.parse(creditDecision.scoreBreakdown) : null
  const approvalReasons = creditDecision?.approvalReasons ? JSON.parse(creditDecision.approvalReasons) : []
  const riskFlags = creditDecision?.riskFlags ? JSON.parse(creditDecision.riskFlags) : []
  const recommendations = creditDecision?.recommendations ? JSON.parse(creditDecision.recommendations) : []
  const calculationInputs = creditDecision?.calculationInputs ? JSON.parse(creditDecision.calculationInputs) : null
  const monthlyData = financialData?.monthlyData ? JSON.parse(financialData.monthlyData) : []

  // Fraud pre-check data (embedded in calculationInputs)
  const fraudPreCheck = calculationInputs?.fraudPreCheck || null
  const bureauOverlay = calculationInputs?.bureauOverlay || null

  return (
    <>
      <div className="page-header">
        <div>
          <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-4)'}}>
            <Link href="/applications" className="btn btn-ghost btn-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="page-title">{application.applicationNo}</h1>
            {getStatusBadge(application.status)}
          </div>
          <p className="page-subtitle">{borrower.businessName} • {borrower.industry}</p>
        </div>
        <div className="page-actions">
        </div>
      </div>

      <div className="grid-2">
        {/* Left Column */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-6)'}}>
          {/* Borrower Profile */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Borrower Profile</h3>
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)'}}>
              <div>
                <div className="text-xs text-muted mb-2">Legal Name</div>
                <div>{borrower.legalName || borrower.businessName}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Constitution</div>
                <div>{borrower.constitution}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Industry</div>
                <div>{borrower.industry}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Business Vintage</div>
                <div>{Math.floor(borrower.vintage / 12)} years {borrower.vintage % 12} months</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Annual Turnover</div>
                <div>{borrower.annualTurnover ? formatAmount(borrower.annualTurnover) : '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Location</div>
                <div>{borrower.city}, {borrower.state}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">GSTIN</div>
                <div className="font-mono">{borrower.gstin || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Contact</div>
                <div>{borrower.contactPerson} ({borrower.contactPhone})</div>
              </div>
            </div>
          </div>

          {/* Loan Request */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Loan Request</h3>
            </div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)'}}>
              <div>
                <div className="text-xs text-muted mb-2">Requested Amount</div>
                <div style={{fontSize: '1.5rem', fontWeight: 700}}>{formatAmount(application.requestedAmount)}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Tenure</div>
                <div style={{fontSize: '1.5rem', fontWeight: 700}}>{application.requestedTenure} months</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Purpose</div>
                <div>{application.purpose || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-2">Source</div>
                <div>{application.sourcePlatform || 'Direct'}</div>
              </div>
            </div>
          </div>

          {/* Financial Analysis */}
          {financialData && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Financial Analysis</h3>
                <span className="text-xs text-muted">6 months bank statement</span>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)'}}>
                <div style={{padding: 'var(--space-4)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)'}}>
                  <div className="text-xs text-muted mb-2">Avg Monthly Inflow</div>
                  <div style={{fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-green)'}}>
                    {formatAmount(financialData.avgMonthlyInflow || 0)}
                  </div>
                </div>
                <div style={{padding: 'var(--space-4)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)'}}>
                  <div className="text-xs text-muted mb-2">Avg Monthly Expenses</div>
                  <div style={{fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-red)'}}>
                    {formatAmount(financialData.avgMonthlyExpenses || 0)}
                  </div>
                </div>
                <div style={{padding: 'var(--space-4)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)'}}>
                  <div className="text-xs text-muted mb-2">Free Cash Flow</div>
                  <div style={{fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary-400)'}}>
                    {formatAmount(financialData.freeCashFlow || 0)}
                  </div>
                </div>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)'}}>
                <div>
                  <div className="text-xs text-muted mb-2">Inflow Volatility (CV)</div>
                  <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-2)'}}>
                    <div style={{flex: 1}}>
                      <div className="progress-bar">
                        <div 
                          className={`progress-fill ${(financialData.inflowVolatility || 0) > 0.5 ? 'danger' : (financialData.inflowVolatility || 0) > 0.3 ? 'warning' : 'success'}`}
                          style={{width: `${Math.min((financialData.inflowVolatility || 0) * 100, 100)}%`}}
                        ></div>
                      </div>
                    </div>
                    <span style={{fontWeight: 600}}>{((financialData.inflowVolatility || 0) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
              
              {/* Monthly Cash Flow Chart */}
              {monthlyData.length > 0 && (
                <div style={{marginTop: 'var(--space-6)'}}>
                  <div className="text-xs text-muted mb-4">Monthly Cash Flow</div>
                  <div style={{display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)', height: '120px'}}>
                    {monthlyData.map((m: { month: string; inflow: number; outflow: number }, i: number) => {
                      const maxVal = Math.max(...monthlyData.map((d: { month: string; inflow: number; outflow: number }) => d.inflow))
                      const height = (m.inflow / maxVal) * 100
                      return (
                        <div key={i} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                          <div 
                            style={{
                              width: '100%',
                              height: `${height}%`,
                              background: 'linear-gradient(180deg, var(--primary-400), var(--primary-600))',
                              borderRadius: 'var(--radius-sm)',
                              minHeight: '10px'
                            }}
                          ></div>
                          <div className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>{m.month}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Collateral */}
          {collateral && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Collateral & Security</h3>
                <span className={`badge ${collateral.collateralType === 'NONE' ? 'badge-gray' : 'badge-success'}`}>
                  {collateral.collateralType === 'NONE' ? 'Unsecured' : 'Secured'}
                </span>
              </div>
              {collateral.collateralType !== 'NONE' ? (
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)'}}>
                  <div>
                    <div className="text-xs text-muted mb-2">Collateral Type</div>
                    <div>{getCollateralTypeLabel(collateral.collateralType)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted mb-2">Assessed Value</div>
                    <div style={{fontWeight: 600}}>{formatAmount(collateral.assessedValue)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted mb-2">LTV Applied</div>
                    <div>{collateral.ltv}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted mb-2">Collateral Eligible Amount</div>
                    <div style={{fontWeight: 600, color: 'var(--accent-green)'}}>{formatAmount(collateral.collateralCap)}</div>
                  </div>
                  {collateral.hasPersonalGuarantee && (
                    <div style={{gridColumn: 'span 2'}}>
                      <div className="text-xs text-muted mb-2">Personal Guarantee</div>
                      <div>{collateral.guarantorName} ({collateral.guarantorRelation})</div>
                    </div>
                  )}
                  {collateral.description && (
                    <div style={{gridColumn: 'span 2'}}>
                      <div className="text-xs text-muted mb-2">Description</div>
                      <div>{collateral.description}</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted">No collateral provided. This is an unsecured facility.</p>
              )}
            </div>
          )}
        </div>

        {/* Right Column */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-6)'}}>
          {/* Decision Action Panel */}
          <DecisionPanel
            applicationId={id}
            currentStatus={application.status}
            hasDecision={!!creditDecision}
            systemDecision={creditDecision?.decision}
            recommendedAmount={creditDecision?.finalRecommendedAmt}
            userRole={session.role}
          />

          {/* Fraud Pre-Check Results */}
          {fraudPreCheck && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Fraud Pre-Checks</h3>
                <span className={`badge ${fraudPreCheck.riskLevel === 'CLEAR' ? 'badge-success' : fraudPreCheck.riskLevel === 'HIGH_RISK' ? 'badge-danger' : 'badge-warning'}`}>
                  {fraudPreCheck.riskLevel === 'CLEAR' ? '✓ Clear' : fraudPreCheck.riskLevel === 'HIGH_RISK' ? '🚨 High Risk' : '⚠ Review'}
                </span>
              </div>
              <p style={{fontSize: '0.875rem', color: fraudPreCheck.riskLevel === 'CLEAR' ? 'var(--accent-green)' : fraudPreCheck.riskLevel === 'HIGH_RISK' ? 'var(--accent-red)' : 'var(--accent-yellow)', marginBottom: 'var(--space-3)'}}>
                {fraudPreCheck.summary}
              </p>
              {fraudPreCheck.flagCount > 0 && (
                <div className="text-xs text-muted">{fraudPreCheck.flagCount} flag(s) detected — see Risk Flags below for details</div>
              )}
              {bureauOverlay && (
                <div style={{marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem'}}>
                  <div className="text-xs text-muted mb-2">Bureau Overlay</div>
                  {bureauOverlay.available ? (
                    <div>Score: {bureauOverlay.bureauScore} • Modifier: {bureauOverlay.modifier > 0 ? '+' : ''}{bureauOverlay.modifier}</div>
                  ) : (
                    <div className="text-muted">Bureau data not available. Cash-flow based assessment used.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Underwriting Recommendation */}
          {creditDecision && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Underwriting Recommendation</h3>
              </div>
              
              {getDecisionBanner(creditDecision.decision)}
              
              {/* Score Gauge */}
              <div style={{textAlign: 'center', marginBottom: 'var(--space-6)'}}>
                <div className="score-gauge">
                  <svg className="score-gauge-circle" viewBox="0 0 100 100">
                    <circle className="score-gauge-bg" cx="50" cy="50" r="40" />
                    <circle 
                      className="score-gauge-fill" 
                      cx="50" 
                      cy="50" 
                      r="40"
                      style={{
                        stroke: creditDecision.creditScore >= 70 ? 'var(--accent-green)' :
                               creditDecision.creditScore >= 50 ? 'var(--accent-yellow)' :
                               'var(--accent-red)',
                        strokeDasharray: `${creditDecision.creditScore * 2.51} 251`
                      }}
                    />
                  </svg>
                  <div className="score-gauge-value">
                    <div className="score-number" style={{
                      color: creditDecision.creditScore >= 70 ? 'var(--accent-green)' :
                             creditDecision.creditScore >= 50 ? 'var(--accent-yellow)' :
                             'var(--accent-red)'
                    }}>
                      {creditDecision.creditScore}
                    </div>
                    <div className="score-label">Credit Score</div>
                  </div>
                </div>
              </div>

              {/* Score Breakdown */}
              {scoreBreakdown && (
                <div style={{marginBottom: 'var(--space-6)'}}>
                  <div className="text-xs text-muted mb-4">Score Breakdown</div>
                  {[
                    { label: 'Cash Flow', score: scoreBreakdown.cashFlowScore, max: 30 },
                    { label: 'EMI Coverage', score: scoreBreakdown.coverageScore, max: 25 },
                    { label: 'Stability', score: scoreBreakdown.stabilityScore, max: 20 },
                    { label: 'Collateral', score: scoreBreakdown.collateralScore, max: 15 },
                    { label: 'Profile', score: scoreBreakdown.profileScore, max: 10 }
                  ].map((item, i) => (
                    <div key={i} style={{marginBottom: 'var(--space-3)'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)'}}>
                        <span className="text-sm">{item.label}</span>
                        <span className="text-sm font-semibold">{item.score}/{item.max}</span>
                      </div>
                      <div className="progress-bar">
                        <div 
                          className="progress-fill"
                          style={{width: `${(item.score / item.max) * 100}%`}}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Eligibility Amounts */}
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)'}}>
                <div style={{padding: 'var(--space-4)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)'}}>
                  <div className="text-xs text-muted mb-2">Cash Flow Eligible</div>
                  <div style={{fontSize: '1.25rem', fontWeight: 700}}>{formatAmount(creditDecision.cashFlowEligible)}</div>
                </div>
                <div style={{padding: 'var(--space-4)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)'}}>
                  <div className="text-xs text-muted mb-2">Collateral Eligible</div>
                  <div style={{fontSize: '1.25rem', fontWeight: 700}}>{formatAmount(creditDecision.collateralEligible)}</div>
                </div>
              </div>

              <div style={{padding: 'var(--space-4)', background: 'linear-gradient(135deg, var(--primary-600), var(--primary-700))', borderRadius: 'var(--radius-lg)', textAlign: 'center'}}>
                <div className="text-xs" style={{opacity: 0.8, marginBottom: 'var(--space-1)'}}>Recommended Amount</div>
                <div style={{fontSize: '1.75rem', fontWeight: 700}}>{formatAmount(creditDecision.finalRecommendedAmt)}</div>
              </div>

              {/* Approval Reasons */}
              {approvalReasons.length > 0 && (
                <div style={{marginTop: 'var(--space-6)'}}>
                  <div className="text-xs text-muted mb-4">Approval Factors</div>
                  <div className="approval-points">
                    {approvalReasons.map((reason: string, i: number) => (
                      <span key={i} className="approval-point">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk Flags */}
              {riskFlags.length > 0 && (
                <div style={{marginTop: 'var(--space-6)'}}>
                  <div className="text-xs text-muted mb-4">Risk Flags</div>
                  <div className="risk-flags">
                    {riskFlags.map((flag: string, i: number) => (
                      <span key={i} className="risk-flag">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Recommendations</h3>
              </div>
              <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-2)'}}>
                {recommendations.map((rec: string, i: number) => (
                  <div key={i} style={{fontSize: '0.85rem', padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)'}}>
                    → {rec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval / Sanction Details */}
          {approval && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Sanction Details</h3>
                <span className="badge badge-success">Sanctioned</span>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)'}}>
                <div>
                  <div className="text-xs text-muted mb-2">Sanctioned Amount</div>
                  <div style={{fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-green)'}}>{formatAmount(approval.sanctionedAmount || 0)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-2">Tenure</div>
                  <div style={{fontSize: '1.5rem', fontWeight: 700}}>{approval.sanctionedTenure} months</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-2">Interest Rate</div>
                  <div style={{fontWeight: 600}}>{approval.interestRate}% p.a.</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-2">Processing Fee</div>
                  <div style={{fontWeight: 600}}>{formatAmount(approval.processingFee || 0)}</div>
                </div>
                {approval.overrideSystem && (
                  <div style={{gridColumn: 'span 2'}}>
                    <div className="alert alert-warning">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>System recommendation overridden: {approval.overrideReason}</span>
                    </div>
                  </div>
                )}
              </div>
              {/* Collateral Enforcement Note */}
              {collateral && collateral.collateralType !== 'NONE' && (
                <div style={{marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', color: 'var(--text-muted)'}}>
                  📋 Collateral charge creation, registration, and enforcement to be handled as per NBFC internal recovery and security enforcement process.
                </div>
              )}
            </div>
          )}

          {/* Audit Trail */}
          {auditLogs.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Audit Trail</h3>
              </div>
              <div className="timeline">
                {auditLogs.map((log: { action: string; timestamp: Date; details: string | null; user?: { name: string } | null }, i: number) => {
                  const details = log.details ? JSON.parse(log.details) : {}
                  return (
                    <div key={i} className={`timeline-item ${log.action.includes('APPROVED') || log.action.includes('SANCTIONED') ? 'success' : log.action.includes('REJECTED') ? 'danger' : ''}`}>
                      <div className="timeline-dot"></div>
                      <div className="timeline-content">
                        <div className="timeline-time">{formatDate(log.timestamp)}</div>
                        <div className="timeline-title">{log.action.replace(/_/g, ' ')}</div>
                        <div className="timeline-desc">by {log.user?.name} • {details.message || ''}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
