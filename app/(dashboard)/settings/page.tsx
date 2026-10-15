import { Terminal } from 'lucide-react'
import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import { getActivePolicy } from '@/lib/policy'
import type { CreditPolicy } from '@credflow/engine'
import { Badge, Card, PageHeader } from '@/components/ui'
import { COLLATERAL_LABEL, date, inr } from '@/lib/format'

export const metadata = { title: 'Credit policy' }

const FRAUD_RULES: Record<keyof CreditPolicy['fraud']['rules'], string> = {
  panGstinMismatch: 'PAN does not match GSTIN',
  missingIdentity: 'No PAN or GSTIN',
  inflowSpike: 'Inflow spike',
  turnoverBankShortfall: 'Bank inflows far below declared turnover',
  excessiveBankFlow: 'Bank inflows far above declared turnover',
  newEntityLargeLoan: 'New entity, large loan',
  loanExceedsTurnover: 'Loan exceeds annual turnover',
  gstinNotActive: 'GSTIN not active',
  panNotVerified: 'PAN not verified',
}

function ruleTrigger(key: string, rule: Record<string, unknown>): string {
  switch (key) {
    case 'inflowSpike': return `Any month above ${rule.multipleOfAverage}× the average (needs ${rule.minMonths}+ months of data)`
    case 'turnoverBankShortfall': return `Annualised bank inflows below ${Math.round(Number(rule.minBankToTurnoverRatio) * 100)}% of declared turnover`
    case 'excessiveBankFlow': return `Annualised bank inflows above ${rule.maxBankToTurnoverRatio}× declared turnover`
    case 'newEntityLargeLoan': return `Under ${rule.maxVintageMonths} months old and requesting over ${inr(Number(rule.amountAbove))}`
    case 'gstinNotActive': return 'GST network reports the GSTIN as cancelled, suspended or not found (needs a GST connector)'
    case 'panNotVerified': return 'PAN fails verification (needs a KYC connector)'
    case 'panGstinMismatch': return 'PAN embedded in the GSTIN differs from the PAN supplied'
    case 'missingIdentity': return 'Neither PAN nor GSTIN supplied'
    case 'loanExceedsTurnover': return 'Requested amount is more than annual turnover'
    default: return '—'
  }
}

const severityTone = (s: string) => (s === 'CRITICAL' ? 'danger' : s === 'WARNING' ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral'

export default async function SettingsPage() {
  const session = await requirePageSession()
  const { policy, policyId, checksum } = await getActivePolicy(session.nbfcId)
  const history = await prisma.creditPolicy.findMany({
    where: { nbfcId: session.nbfcId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, policyKey: true, version: true, isActive: true, activatedAt: true, checksum: true, _count: { select: { decisions: true } } },
  })

  const s = policy.scoring
  const banded = [
    { name: 'Cash flow', metric: 'Free cash flow ÷ (amount ÷ 12)', c: s.cashFlow },
    { name: 'EMI coverage', metric: 'Free cash flow ÷ EMI', c: s.emiCoverage },
    { name: 'Stability', metric: 'Inflow coefficient of variation', c: s.stability },
  ]
  const a = policy.affordability

  return (
    <>
      <PageHeader
        title="Credit policy"
        description={`The rules the engine applies to every decision for ${session.nbfcName}.`}
        badge={<Badge tone={policyId ? 'success' : 'neutral'} dot>{policyId ? 'Active' : 'Built-in default'}</Badge>}
      />

      <div className="split" style={{ '--rail': '340px' } as React.CSSProperties}>
        <div className="stack">
          <Card title={policy.name} description={policy.description}>
            <div className="tiles">
              <div className="tile">
                <div className="tile-label">Approve at</div>
                <div className="figure tone-success">{policy.decision.approveThreshold}+</div>
              </div>
              <div className="tile">
                <div className="tile-label">Refer between</div>
                <div className="figure tone-warning">{policy.decision.referThreshold}–{policy.decision.approveThreshold - 1}</div>
              </div>
              <div className="tile">
                <div className="tile-label">Reject below</div>
                <div className="figure tone-danger">{policy.decision.referThreshold}</div>
              </div>
            </div>
            <dl className="kv kv-3 mt-6">
              <div><dt>EMI method</dt><dd>{a.method === 'amortized' ? `Amortised at ${a.annualInterestRate}% p.a.` : `Flat factor ${a.flatFactor}`}</dd></div>
              <div><dt>Min. EMI coverage</dt><dd>{a.minEMICoverage}x</dd></div>
              <div><dt>Unsecured sizing</dt><dd>{Math.round(a.unsecuredHaircut * 100)}% of cash-flow eligibility</dd></div>
              <div><dt>Collateral headroom</dt><dd>{a.collateralHeadroom}x of collateral cap</dd></div>
              <div><dt>Max. inflow volatility</dt><dd>{Math.round(policy.explanations.maxInflowCV * 100)}%</dd></div>
              <div><dt>Min. business vintage</dt><dd>{policy.explanations.minBusinessVintageMonths} months</dd></div>
            </dl>
          </Card>

          <Card title="Scorecard" description="Five components, 100 points in total" flush>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Component</th><th className="right">Max</th><th>Bands → points</th></tr></thead>
                <tbody>
                  {banded.map(({ name, metric, c }) => (
                    <tr key={name}>
                      <td><div className="cell-primary">{name}</div><div className="cell-sub">{metric}</div></td>
                      <td className="right num strong">{c.max}</td>
                      <td className="small" style={{ whiteSpace: 'normal' }}>
                        <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                          {c.bands.map(b => <span key={b.threshold} className="code">{c.direction === 'higher-is-better' ? '≥' : '≤'}{b.threshold} → {b.points}</span>)}
                          <span className="code">else {c.otherwise}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td><div className="cell-primary">Collateral</div><div className="cell-sub">Collateral cap ÷ amount</div></td>
                    <td className="right num strong">{s.collateral.max}</td>
                    <td className="small" style={{ whiteSpace: 'normal' }}>
                      <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {s.collateral.coverageBands.map(b => <span key={b.threshold} className="code">≥{b.threshold} → {b.points}</span>)}
                        <span className="code">else {s.collateral.otherwise}</span>
                        {s.collateral.preferredTypes.length > 0 && <span className="muted">+{s.collateral.preferredTypeBonus} for {s.collateral.preferredTypes.join(', ')}</span>}
                        {s.collateral.personalGuaranteeBonus > 0 && <span className="muted">· +{s.collateral.personalGuaranteeBonus} for a guarantee</span>}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td><div className="cell-primary">Business profile</div><div className="cell-sub">Vintage + industry risk</div></td>
                    <td className="right num strong">{s.profile.max}</td>
                    <td className="small" style={{ whiteSpace: 'normal' }}>
                      <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                        {s.profile.vintageBands.map(b => <span key={b.threshold} className="code">≥{b.threshold}m → {b.points}</span>)}
                        <span className="code">else {s.profile.vintageOtherwise}</span>
                        <span className="muted">+ industry: low {s.profile.industryPoints.LOW}, medium {s.profile.industryPoints.MEDIUM}, high {s.profile.industryPoints.HIGH}</span>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Fraud pre-checks" description={`Flags at ${policy.fraud.hardStopSeverity} or above force a reject recommendation`} flush>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Rule</th><th>Severity</th><th>Triggers when</th></tr></thead>
                <tbody>
                  {Object.entries(policy.fraud.rules).map(([key, rule]) => (
                    <tr key={key} style={rule.enabled ? undefined : { opacity: 0.5 }}>
                      <td className="cell-primary">{FRAUD_RULES[key as keyof typeof FRAUD_RULES]}{!rule.enabled && <span className="muted small"> (off)</span>}</td>
                      <td><Badge tone={severityTone(rule.severity)}>{rule.severity.charAt(0) + rule.severity.slice(1).toLowerCase()}</Badge></td>
                      <td className="small" style={{ whiteSpace: 'normal', minWidth: 260 }}>{ruleTrigger(key, rule as Record<string, unknown>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid-2">
            <Card title="LTV limits">
              {(['LAP', 'MACHINERY', 'INVOICE', 'STOCK', 'FD'] as const).map(k => (
                <div key={k} className="meter-row">
                  <div className="meter-head"><span>{COLLATERAL_LABEL[k]}</span><span>{policy.collateral.ltvLimits[k]}%</span></div>
                  <div className="meter"><span style={{ width: `${policy.collateral.ltvLimits[k]}%` }} /></div>
                </div>
              ))}
            </Card>
            <Card title="Industry risk" description={`Unlisted industries are treated as ${policy.industries.defaultBand.toLowerCase()} risk`}>
              <ul className="stack-sm" style={{ gap: 'var(--space-2)' }}>
                {Object.entries(policy.industries.riskBands).map(([industry, band]) => (
                  <li key={industry} className="between">
                    <span>{industry}</span>
                    <Badge tone={band === 'LOW' ? 'success' : band === 'MEDIUM' ? 'warning' : 'danger'}>{band.charAt(0) + band.slice(1).toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>

        <aside className="split-rail stack" aria-label="Policy details">
          <Card title="Version">
            <dl className="kv" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-4)' }}>
              <div><dt>Policy</dt><dd className="mono">{policy.id}@{policy.version}</dd></div>
              <div><dt>Checksum (SHA-256)</dt><dd className="mono small" title={checksum}>{checksum.slice(0, 20)}…</dd></div>
            </dl>
            <div className="section-label mt-6">To change the policy</div>
            <p className="small text-2">Edit a YAML file in <span className="code">policies/</span>, bump its version, then apply it:</p>
            <div className="secret" style={{ marginTop: 'var(--space-2)' }}>
              <Terminal size={14} aria-hidden className="muted" />
              <code>npm run policy -- apply policies/&lt;file&gt;.yaml --nbfc &lt;CODE&gt;</code>
            </div>
          </Card>

          <Card title="Maker-checker">
            <dl className="kv" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-4)' }}>
              <div><dt>Second approver above</dt><dd>{policy.approvals.checkerRequiredAbove === null ? 'Never on amount alone' : inr(policy.approvals.checkerRequiredAbove)}</dd></div>
              <div><dt>Overrides need a checker</dt><dd>{policy.approvals.checkerRequiredForOverrides ? 'Yes' : 'No'}</dd></div>
              <div><dt>Who can check</dt><dd>{policy.approvals.checkerRoles.map(r => r.charAt(0) + r.slice(1).toLowerCase()).join(', ')}, never the maker</dd></div>
            </dl>
          </Card>

          <Card title="Bureau overlay" description="Adjusts the score; never a gate on its own">
            <ul className="stack-sm" style={{ gap: 'var(--space-2)' }}>
              {policy.bureau.scoreBands.map(b => (
                <li key={b.minScore} className="between"><span>Score {b.minScore}+</span><span className="num strong">{b.modifier > 0 ? '+' : ''}{b.modifier}</span></li>
              ))}
              <li className="between"><span>Below all bands</span><span className="num strong">{policy.bureau.otherwiseModifier}</span></li>
              <li className="between"><span>DPD 90+ history</span><span className="num strong">{policy.bureau.delinquencyModifier}</span></li>
              <li className="between"><span>Bureau fraud alert</span><span className="num strong tone-danger">{policy.bureau.fraudAlertModifier}</span></li>
            </ul>
          </Card>

          <Card title="History" flush>
            {history.length === 0 ? (
              <p className="small muted card-body">No policy applied yet; the built-in default is in use.</p>
            ) : (
              <ul>
                {history.map(h => (
                  <li key={h.id} className="between" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ minWidth: 0 }}>
                      <span className="mono small strong" style={{ display: 'block' }}>{h.policyKey}@{h.version}</span>
                      <span className="cell-sub">{h.activatedAt ? `Activated ${date(h.activatedAt)}` : 'Never activated'} · {h._count.decisions} decisions</span>
                    </span>
                    {h.isActive && <Badge tone="success" dot>Active</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  )
}
