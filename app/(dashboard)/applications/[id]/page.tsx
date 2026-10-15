import { notFound } from 'next/navigation'
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Cpu, FilePlus2, Info, KeyRound, RotateCcw,
  ShieldAlert, ShieldCheck, Undo2, UserCheck, XCircle,
} from 'lucide-react'
import prisma from '@/lib/db'
import DecisionPanel from '@/components/DecisionPanel'
import { getSession, requirePageSession } from '@/lib/auth'
import { getActivePolicy } from '@/lib/policy'
import { canActAsChecker, parsePolicy, type CreditPolicy } from '@credflow/engine'
import { Alert, Badge, Card, DecisionBadge, EmptyState, Meter, PageHeader, ScoreRing, StatusBadge } from '@/components/ui'
import { COLLATERAL_LABEL, DECISION, date, dateTime, inr, scoreTone, vintage } from '@/lib/format'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  const app = session
    ? await prisma.loanApplication.findFirst({ where: { id, nbfcId: session.nbfcId }, select: { applicationNo: true } })
    : null
  return { title: app?.applicationNo ?? 'Application' }
}

type Connectors = Record<string, { provider: string; status: string; detail?: string }>
type MonthlyFlow = { month: string; inflow: number; outflow: number }

const parse = <T,>(v: string | null | undefined, fallback: T): T => {
  if (!v) return fallback
  try { return JSON.parse(v) as T } catch { return fallback }
}

// Audit actions → readable label, icon and tone
const AUDIT: Record<string, { label: string; icon: typeof CircleDot; tone?: 'success' | 'danger' | 'warning' | 'accent' }> = {
  APPLICATION_CREATED: { label: 'Application created', icon: FilePlus2 },
  RECOMMENDATION_GENERATED: { label: 'Underwriting engine run', icon: Cpu, tone: 'accent' },
  FRAUD_FLAG_RAISED: { label: 'Fraud flag raised', icon: ShieldAlert, tone: 'danger' },
  APPLICATION_APPROVED: { label: 'Approved and sanctioned', icon: CheckCircle2, tone: 'success' },
  APPROVAL_OVERRIDE: { label: 'Approved (override)', icon: CheckCircle2, tone: 'warning' },
  SANCTION_SUBMITTED_FOR_CHECK: { label: 'Sanction submitted for checker', icon: UserCheck, tone: 'accent' },
  SANCTION_CONFIRMED_BY_CHECKER: { label: 'Sanction confirmed by checker', icon: ShieldCheck, tone: 'success' },
  SANCTION_RETURNED_BY_CHECKER: { label: 'Sanction returned by checker', icon: Undo2, tone: 'warning' },
  APPLICATION_REJECTED: { label: 'Rejected', icon: XCircle, tone: 'danger' },
  REJECTION_OVERRIDE: { label: 'Rejected (override)', icon: XCircle, tone: 'danger' },
  REFERRED_FOR_REVIEW: { label: 'Referred for review', icon: RotateCcw, tone: 'warning' },
}

function auditDetail(action: string, d: Record<string, unknown>): string | null {
  if (action === 'RECOMMENDATION_GENERATED' || action === 'FRAUD_FLAG_RAISED') {
    const parts = [`Score ${d.creditScore}`, DECISION[d.decision as string]?.label ?? d.decision]
    if (d.policy) parts.push(String(d.policy))
    return parts.join(' · ')
  }
  if (typeof d.sanctionedAmount === 'number') return `${inr(d.sanctionedAmount)}${d.overrideReason ? ` · ${d.overrideReason}` : ''}`
  if (d.remarks) return String(d.remarks)
  if (d.overrideReason) return String(d.overrideReason)
  if (d.applicationNo) return `${d.applicationNo} · ${inr(Number(d.requestedAmount))} for ${d.requestedTenure} months`
  return null
}

async function decisionPolicy(policyId: string | null | undefined, nbfcId: string): Promise<CreditPolicy> {
  if (policyId) {
    const row = await prisma.creditPolicy.findFirst({ where: { id: policyId, nbfcId } })
    if (row) return parsePolicy(JSON.parse(row.document))
  }
  return (await getActivePolicy(nbfcId)).policy
}

export default async function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requirePageSession()

  const application = await prisma.loanApplication.findFirst({
    where: { id, nbfcId: session.nbfcId },
    include: {
      borrower: true,
      collateral: true,
      creditDecision: { include: { policy: { select: { policyKey: true, version: true } } } },
      approval: { include: { user: { select: { name: true } }, checker: { select: { name: true } } } },
      auditLogs: {
        orderBy: { timestamp: 'desc' },
        include: { user: { select: { name: true } }, apiKey: { select: { name: true, prefix: true } } },
      },
    },
  })
  if (!application) notFound()

  const financialData = await prisma.financialData.findFirst({
    where: { borrowerId: application.borrowerId },
    orderBy: { periodEnd: 'desc' },
  })

  const { borrower, collateral, creditDecision: decision, approval, auditLogs } = application
  const policy = await decisionPolicy(decision?.policyId, session.nbfcId)

  // Maker-checker state for the decision panel
  let checker: { pending: boolean; reasons: string[]; makerName: string; canCheck: boolean; blockedReason: string | null } | null = null
  if (approval?.status === 'PENDING_CHECKER') {
    const canCheck = canActAsChecker(policy, { userId: session.id, role: session.role }, approval.approvedBy)
    checker = {
      pending: true,
      reasons: Array.isArray(approval.checkerReasons) ? (approval.checkerReasons as string[]) : [],
      makerName: approval.user.name,
      canCheck,
      blockedReason: canCheck
        ? null
        : approval.approvedBy === session.id
          ? 'You submitted this sanction, so a different user must check it.'
          : `Only ${policy.approvals.checkerRoles.join(' or ')} users can act as checker.`,
    }
  }

  const breakdown = parse<Record<string, number> | null>(decision?.scoreBreakdown, null)
  const reasons = parse<string[]>(decision?.approvalReasons, [])
  const flags = parse<string[]>(decision?.riskFlags, [])
  const recommendations = parse<string[]>(decision?.recommendations, [])
  const inputs = parse<Record<string, unknown> | null>(decision?.calculationInputs, null)
  const fraud = inputs?.fraudPreCheck as { riskLevel: string; summary: string; flagCount: number } | undefined
  const bureau = inputs?.bureauOverlay as { available: boolean; bureauScore?: number; modifier: number; provider?: string } | undefined
  const connectors = (inputs?.connectors ?? {}) as Connectors
  const emi = typeof inputs?.emi === 'number' ? inputs.emi : null
  const coverage = typeof inputs?.emiCoverageRatio === 'number' ? inputs.emiCoverageRatio : null
  const monthly = parse<MonthlyFlow[]>(financialData?.monthlyData, [])
  const maxFlow = Math.max(1, ...monthly.flatMap(m => [m.inflow, m.outflow]))
  const tone = decision ? scoreTone(decision.creditScore, policy.decision.approveThreshold, policy.decision.referThreshold) : 'neutral'
  const policyRef = decision?.policy ? `${decision.policy.policyKey}@${decision.policy.version}` : (inputs?.creditPolicyVersion as string | undefined)

  const components = breakdown ? [
    { label: 'Cash flow', score: breakdown.cashFlowScore, max: policy.scoring.cashFlow.max },
    { label: 'EMI coverage', score: breakdown.coverageScore, max: policy.scoring.emiCoverage.max },
    { label: 'Stability', score: breakdown.stabilityScore, max: policy.scoring.stability.max },
    { label: 'Collateral', score: breakdown.collateralScore, max: policy.scoring.collateral.max },
    { label: 'Business profile', score: breakdown.profileScore, max: policy.scoring.profile.max },
  ] : []

  const fraudFlags = flags.filter(f => f.startsWith('🚨') || f.startsWith('⚠'))
  const creditFlags = flags.filter(f => !fraudFlags.includes(f))
  const clean = (f: string) => f.replace(/^🚨 FRAUD: |^⚠ Fraud Check: /, '')

  return (
    <>
      <PageHeader
        back={{ href: '/applications', label: 'Applications' }}
        title={borrower.businessName}
        badge={<StatusBadge status={application.status} size="lg" />}
        description={
          <>
            <span className="mono">{application.applicationNo}</span> · {borrower.industry} · Applied {date(application.appliedAt)}
            {application.sourcePlatform && application.sourcePlatform !== 'Direct' && <> · via {application.sourcePlatform}</>}
          </>
        }
      />

      {/* Key facts */}
      <div className="card mb-6">
        <div className="tiles" style={{ padding: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div className="tile">
            <div className="tile-label">Requested</div>
            <div className="figure">{inr(application.requestedAmount)}</div>
            <div className="small muted">{application.requestedTenure} months{application.purpose ? ` · ${application.purpose}` : ''}</div>
          </div>
          <div className="tile">
            <div className="tile-label">Recommendation</div>
            {decision ? (
              <>
                <div className="row"><span className={`figure tone-${tone}`}>{decision.creditScore}</span><DecisionBadge decision={decision.decision} /></div>
                <div className="small muted">Credit score out of 100</div>
              </>
            ) : <><div className="figure muted">—</div><div className="small muted">Not evaluated yet</div></>}
          </div>
          <div className="tile">
            <div className="tile-label">Recommended amount</div>
            <div className="figure">{decision ? inr(decision.finalRecommendedAmt) : '—'}</div>
            <div className="small muted">{emi ? `EMI ${inr(emi)} / month` : 'After evaluation'}</div>
          </div>
          <div className="tile">
            <div className="tile-label">EMI coverage</div>
            <div className={`figure ${coverage !== null ? (coverage >= policy.affordability.minEMICoverage ? 'tone-success' : 'tone-danger') : 'muted'}`}>
              {coverage !== null ? `${coverage.toFixed(2)}x` : '—'}
            </div>
            <div className="small muted">Policy minimum {policy.affordability.minEMICoverage}x</div>
          </div>
          <div className="tile">
            <div className="tile-label">Security</div>
            <div className="figure" style={{ fontSize: 16, lineHeight: '26px' }}>{collateral && collateral.collateralType !== 'NONE' ? COLLATERAL_LABEL[collateral.collateralType] : 'Unsecured'}</div>
            <div className="small muted">{collateral && collateral.collateralType !== 'NONE' ? `${inr(collateral.assessedValue)} at ${collateral.ltv}% LTV` : collateral?.hasPersonalGuarantee ? 'Personal guarantee' : 'No collateral'}</div>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          {/* Recommendation */}
          {decision ? (
            <Card
              title="Underwriting recommendation"
              description={<>Evaluated {dateTime(decision.generatedAt)}{policyRef && <> under <span className="mono">{policyRef}</span></>}</>}
              actions={<DecisionBadge decision={decision.decision} size="lg" />}
            >
              <div className="grid-2" style={{ alignItems: 'center' }}>
                <div className="score">
                  <ScoreRing score={decision.creditScore} tone={tone} />
                  <div>
                    <div className="strong" style={{ fontSize: 16 }}>
                      {decision.decision === 'APPROVE' ? 'Recommended for approval' : decision.decision === 'REFER' ? 'Refer for manual review' : 'Not recommended'}
                    </div>
                    <p className="small muted mt-1">
                      Approve at {policy.decision.approveThreshold}+, refer at {policy.decision.referThreshold}–{policy.decision.approveThreshold - 1}.
                      {fraud?.riskLevel === 'HIGH_RISK' && ' Fraud pre-checks forced a reject.'}
                    </p>
                  </div>
                </div>
                <div>
                  {components.map(c => (
                    <div key={c.label} className="meter-row">
                      <div className="meter-head"><span>{c.label}</span><span>{c.score} / {c.max}</span></div>
                      <Meter value={c.score} max={c.max} label={c.label} tone={c.score / c.max >= 0.7 ? 'success' : c.score / c.max >= 0.4 ? undefined : 'warning'} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="tiles mt-6">
                <div className="tile"><div className="tile-label">Cash-flow eligibility</div><div className="figure num">{inr(decision.cashFlowEligible)}</div></div>
                <div className="tile"><div className="tile-label">Collateral eligibility</div><div className="figure num">{inr(decision.collateralEligible)}</div></div>
                <div className="tile" style={{ background: 'var(--accent-soft)' }}>
                  <div className="tile-label tone-accent">Recommended amount</div>
                  <div className="figure num tone-accent">{inr(decision.finalRecommendedAmt)}</div>
                </div>
              </div>

              <div className="grid-2 mt-6">
                <div>
                  <div className="section-label">Why</div>
                  {reasons.length ? (
                    <ul className="reason-list">
                      {reasons.map(r => <li key={r} className="reason good"><CheckCircle2 aria-hidden />{r}</li>)}
                    </ul>
                  ) : <p className="small muted">No positive factors recorded.</p>}
                </div>
                <div>
                  <div className="section-label">Risks</div>
                  {fraudFlags.length + creditFlags.length ? (
                    <ul className="reason-list">
                      {fraudFlags.map(f => (
                        <li key={f} className={`reason ${f.startsWith('🚨') ? 'critical' : 'bad'}`}>
                          <ShieldAlert aria-hidden />{clean(f)}
                        </li>
                      ))}
                      {creditFlags.map(f => <li key={f} className="reason bad"><AlertTriangle aria-hidden />{f}</li>)}
                    </ul>
                  ) : <p className="small muted">No risk flags.</p>}
                </div>
              </div>

              {recommendations.length > 0 && (
                <div className="mt-6">
                  <div className="section-label">Suggested next steps</div>
                  <ul className="reason-list">
                    {recommendations.map(r => <li key={r} className="reason note"><ArrowRight aria-hidden />{r}</li>)}
                  </ul>
                </div>
              )}
            </Card>
          ) : (
            <Card title="Underwriting recommendation">
              <EmptyState icon={<Cpu size={20} />} title="Not evaluated yet">
                Run the underwriting engine from the panel on the right to score this application under your credit policy.
              </EmptyState>
            </Card>
          )}

          {/* Checks */}
          {decision && (
            <Card title="Fraud & verification checks" description="Run before scoring. Critical findings force a reject recommendation.">
              <div className="stack-sm">
                <div className="between">
                  <span className="strong">Fraud pre-checks</span>
                  {fraud?.riskLevel === 'CLEAR' ? <Badge tone="success"><ShieldCheck aria-hidden /> Clear</Badge>
                    : fraud?.riskLevel === 'HIGH_RISK' ? <Badge tone="danger"><ShieldAlert aria-hidden /> High risk</Badge>
                    : <Badge tone="warning"><AlertTriangle aria-hidden /> Review</Badge>}
                </div>
                {fraud?.summary && <p className="small text-2">{fraud.summary}</p>}
              </div>
              <div className="kv kv-3 mt-6">
                <div>
                  <dt>Bureau</dt>
                  <dd>
                    {bureau?.available
                      ? <>{bureau.bureauScore} <span className="muted small">({bureau.modifier > 0 ? '+' : ''}{bureau.modifier} to score)</span></>
                      : <span className="muted">{connectors.bureau?.status === 'no_record' ? 'No bureau record' : connectors.bureau?.status === 'error' ? 'Unavailable' : 'Not checked'}</span>}
                  </dd>
                </div>
                <div>
                  <dt>GSTIN</dt>
                  <dd>{connectors.gst ? (connectors.gst.status === 'ok' ? connectors.gst.detail : 'Unavailable') : <span className="muted">Not checked</span>}</dd>
                </div>
                <div>
                  <dt>PAN</dt>
                  <dd>{connectors.kyc ? (connectors.kyc.status === 'ok' ? connectors.kyc.detail : 'Unavailable') : <span className="muted">Not checked</span>}</dd>
                </div>
              </div>
              {Object.values(connectors).some(c => c.provider === 'mock') && (
                <Alert tone="info" className="mt-4">Bureau, GST and PAN results come from <strong>mock</strong> providers (test data).</Alert>
              )}
            </Card>
          )}

          {/* Financials */}
          {financialData && (
            <Card
              title="Cash flow"
              description={financialData.dataType === 'ACCOUNT_AGGREGATOR' ? 'From Account Aggregator data' : 'From bank statement analysis'}
            >
              <div className="tiles">
                <div className="tile"><div className="tile-label">Avg. monthly inflow</div><div className="figure num">{inr(financialData.avgMonthlyInflow)}</div></div>
                <div className="tile"><div className="tile-label">Avg. monthly expenses</div><div className="figure num">{inr(financialData.avgMonthlyExpenses)}</div></div>
                <div className="tile">
                  <div className="tile-label">Free cash flow</div>
                  <div className={`figure num ${(financialData.freeCashFlow ?? 0) > 0 ? 'tone-success' : 'tone-danger'}`}>{inr(financialData.freeCashFlow)}</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Inflow volatility</div>
                  <div className={`figure num ${(financialData.inflowVolatility ?? 0) > policy.explanations.maxInflowCV ? 'tone-danger' : ''}`}>{((financialData.inflowVolatility ?? 0) * 100).toFixed(0)}%</div>
                </div>
              </div>
              {monthly.length > 0 && (
                <div className="mt-6">
                  <div className="between">
                    <div className="section-label" style={{ margin: 0 }}>Monthly inflow vs outflow</div>
                    <div className="row small muted">
                      <span className="legend-swatch" style={{ background: 'var(--chart-1)' }} /> Inflow
                      <span className="legend-swatch" style={{ background: 'var(--chart-5)', marginLeft: 8 }} /> Outflow
                    </div>
                  </div>
                  <div className="flow-chart mt-3" role="img" aria-label="Monthly inflow and outflow">
                    {monthly.map(m => (
                      <div key={m.month} className="flow-month" title={`${m.month}: in ${inr(m.inflow)}, out ${inr(m.outflow)}`}>
                        <div className="flow-bars">
                          <span style={{ height: `${(m.inflow / maxFlow) * 100}%`, background: 'var(--chart-1)' }} />
                          <span style={{ height: `${(m.outflow / maxFlow) * 100}%`, background: 'var(--chart-5)' }} />
                        </div>
                        <span className="flow-label">{m.month}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Borrower & loan */}
          <div className="grid-2">
            <Card title="Borrower">
              <dl className="kv">
                <div className="span-all"><dt>Legal name</dt><dd>{borrower.legalName || borrower.businessName}</dd></div>
                <div><dt>Constitution</dt><dd>{borrower.constitution}</dd></div>
                <div><dt>In business</dt><dd>{vintage(borrower.vintage)}</dd></div>
                <div><dt>Annual turnover</dt><dd className="num">{inr(borrower.annualTurnover)}</dd></div>
                <div><dt>Location</dt><dd>{[borrower.city, borrower.state].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt>PAN</dt><dd className="mono">{borrower.pan || '—'}</dd></div>
                <div><dt>GSTIN</dt><dd className="mono">{borrower.gstin || '—'}</dd></div>
                <div className="span-all"><dt>Contact</dt><dd>{borrower.contactPerson} · {borrower.contactPhone}{borrower.contactEmail ? ` · ${borrower.contactEmail}` : ''}</dd></div>
              </dl>
            </Card>
            <Card title="Loan & security">
              <dl className="kv">
                <div><dt>Amount</dt><dd className="num">{inr(application.requestedAmount)}</dd></div>
                <div><dt>Tenure</dt><dd>{application.requestedTenure} months</dd></div>
                <div><dt>Purpose</dt><dd>{application.purpose || '—'}</dd></div>
                <div><dt>Priority</dt><dd>{application.priority.charAt(0) + application.priority.slice(1).toLowerCase()}</dd></div>
                <div><dt>Collateral</dt><dd>{collateral && collateral.collateralType !== 'NONE' ? COLLATERAL_LABEL[collateral.collateralType] : 'None'}</dd></div>
                <div><dt>Collateral cap</dt><dd className="num">{collateral ? inr(collateral.collateralCap) : '—'}</dd></div>
                <div className="span-all">
                  <dt>Personal guarantee</dt>
                  <dd>{collateral?.hasPersonalGuarantee ? `${collateral.guarantorName ?? 'Yes'}${collateral.guarantorRelation ? ` (${collateral.guarantorRelation})` : ''}` : 'No'}</dd>
                </div>
                {application.sourceReference && <div className="span-all"><dt>Source reference</dt><dd className="mono">{application.sourceReference}</dd></div>}
              </dl>
            </Card>
          </div>

          {/* Audit trail */}
          <Card title="Activity" description="Append-only audit trail">
            {auditLogs.length === 0 ? <p className="muted small">No activity yet.</p> : (
              <ol className="timeline">
                {auditLogs.map(log => {
                  const meta = AUDIT[log.action] ?? { label: log.action.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()), icon: CircleDot }
                  const Icon = meta.icon
                  const detail = auditDetail(log.action, parse(log.details, {} as Record<string, unknown>))
                  const who = log.user?.name ?? (log.apiKey ? `API key “${log.apiKey.name}”` : 'System')
                  return (
                    <li key={log.id} className={`timeline-item ${meta.tone ?? ''}`}>
                      <span className="timeline-icon">{log.apiKey && !log.user ? <KeyRound aria-hidden /> : <Icon aria-hidden />}</span>
                      <div>
                        <div className="timeline-title">{meta.label}</div>
                        <div className="timeline-meta">{who} · {dateTime(log.timestamp)}</div>
                        {detail && <div className="small text-2 mt-1">{detail}</div>}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        <aside className="split-rail stack" aria-label="Decision">
          <DecisionPanel
            applicationId={id}
            currentStatus={application.status}
            hasDecision={!!decision}
            systemDecision={decision?.decision}
            recommendedAmount={decision?.finalRecommendedAmt}
            requestedTenure={application.requestedTenure}
            defaultRate={policy.affordability.annualInterestRate}
            userRole={session.role}
            checker={checker}
            pendingSanction={approval?.status === 'PENDING_CHECKER' ? {
              amount: approval.sanctionedAmount ?? 0,
              tenure: approval.sanctionedTenure ?? 0,
              interestRate: approval.interestRate ?? 0,
              overrideReason: approval.overrideSystem ? approval.overrideReason : null,
            } : null}
          />

          {approval && approval.finalDecision === 'APPROVE' && (
            <Card
              title="Sanction"
              actions={
                approval.status === 'CONFIRMED' ? <Badge tone="success" dot>Sanctioned</Badge>
                  : approval.status === 'PENDING_CHECKER' ? <Badge tone="accent" dot>Awaiting checker</Badge>
                  : <Badge tone="warning" dot>Returned</Badge>
              }
            >
              <div className="figure figure-lg">{inr(approval.sanctionedAmount)}</div>
              <div className="small muted">{approval.sanctionedTenure} months at {approval.interestRate}% p.a. · {approval.processingFee ?? 0}% processing fee</div>
              <dl className="kv mt-4">
                <div><dt>Maker</dt><dd>{approval.user.name}</dd></div>
                <div><dt>Checker</dt><dd>{approval.checker?.name ?? (approval.status === 'PENDING_CHECKER' ? 'Pending' : 'Not required')}</dd></div>
                {approval.checkerRemarks && <div className="span-all"><dt>Checker remarks</dt><dd>{approval.checkerRemarks}</dd></div>}
              </dl>
              {approval.overrideSystem && (
                <Alert tone="warning" title="System recommendation overridden" className="mt-4">{approval.overrideReason}</Alert>
              )}
              {collateral && collateral.collateralType !== 'NONE' && approval.status === 'CONFIRMED' && (
                <p className="small muted mt-4 row" style={{ alignItems: 'flex-start' }}>
                  <Info size={14} aria-hidden style={{ marginTop: 3, flexShrink: 0 }} />
                  Charge creation and registration on the collateral follow your NBFC&apos;s security process.
                </p>
              )}
            </Card>
          )}
        </aside>
      </div>
    </>
  )
}
