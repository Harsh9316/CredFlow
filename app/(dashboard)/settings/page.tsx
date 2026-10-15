import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import { getActivePolicy } from '@/lib/policy'
import type { CreditPolicy } from '@credflow/engine'

const collateralTypes = [
  { key: 'LAP', label: 'Loan Against Property' },
  { key: 'MACHINERY', label: 'Machinery' },
  { key: 'INVOICE', label: 'Invoice Financing' },
  { key: 'STOCK', label: 'Stock/Inventory' },
  { key: 'FD', label: 'Fixed Deposit' },
] as const

const fraudRuleLabels: Record<keyof CreditPolicy['fraud']['rules'], string> = {
  panGstinMismatch: 'PAN does not match GSTIN',
  missingIdentity: 'No PAN or GSTIN',
  inflowSpike: 'Inflow spike',
  turnoverBankShortfall: 'Bank inflows far below declared turnover',
  excessiveBankFlow: 'Bank inflows far above declared turnover',
  newEntityLargeLoan: 'New entity, large loan',
  loanExceedsTurnover: 'Loan exceeds annual turnover',
}

function describeRuleParams(key: string, rule: Record<string, unknown>): string {
  switch (key) {
    case 'inflowSpike': return `Any month > ${rule.multipleOfAverage}× average (needs ${rule.minMonths}+ months)`
    case 'turnoverBankShortfall': return `Bank / turnover < ${rule.minBankToTurnoverRatio}`
    case 'excessiveBankFlow': return `Bank / turnover > ${rule.maxBankToTurnoverRatio}`
    case 'newEntityLargeLoan': return `Vintage < ${rule.maxVintageMonths} months and amount > ₹${((rule.amountAbove as number) / 100000).toFixed(1)}L`
    default: return '—'
  }
}

const severityBadge = (s: string) => (s === 'CRITICAL' ? 'badge-danger' : s === 'WARNING' ? 'badge-warning' : 'badge-gray')

export default async function SettingsPage() {
  const session = await requirePageSession()
  const { policy, policyId, checksum } = await getActivePolicy(session.nbfcId)
  const history = await prisma.creditPolicy.findMany({
    where: { nbfcId: session.nbfcId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, policyKey: true, version: true, isActive: true, activatedAt: true, checksum: true, _count: { select: { decisions: true } } },
  })

  const s = policy.scoring
  const scorecard = [
    { name: 'Cash flow', metric: 'Free cash flow ÷ (amount ÷ 12)', c: s.cashFlow },
    { name: 'EMI coverage', metric: 'Free cash flow ÷ EMI', c: s.emiCoverage },
    { name: 'Stability', metric: 'Inflow coefficient of variation', c: s.stability },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Credit policy applied to every decision for {session.nbfcName}</p>
        </div>
      </div>

      {/* Active policy */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">{policy.name}</h3>
          <span className="badge badge-primary">{policyId ? 'Active' : 'Built-in default'}</span>
        </div>
        {policy.description && <p className="text-muted" style={{marginBottom: 'var(--space-4)'}}>{policy.description}</p>}
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-label">Policy</div>
            <div className="setting-value font-mono" style={{fontSize: '1.1rem'}}>{policy.id}@{policy.version}</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Stored with every decision for audits and backtesting</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Checksum (SHA-256)</div>
            <div className="setting-value font-mono" style={{fontSize: '1.1rem'}} title={checksum}>{checksum.slice(0, 12)}…</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Changes whenever any rule changes</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Changing the policy</div>
            <div className="font-mono text-xs" style={{marginTop: 'var(--space-2)'}}>npm run policy -- apply policies/&lt;file&gt;.yaml --nbfc &lt;CODE&gt;</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Policies are versioned YAML files, validated before they are applied</p>
          </div>
        </div>
      </div>

      {/* Thresholds & affordability */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Decision Thresholds</h3>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-label">Approve</div>
            <div className="setting-value" style={{color: 'var(--accent-green)'}}>≥{policy.decision.approveThreshold}</div>
          </div>
          <div className="setting-item">
            <div className="setting-label">Refer</div>
            <div className="setting-value" style={{color: 'var(--accent-yellow)'}}>{policy.decision.referThreshold}–{policy.decision.approveThreshold - 1}</div>
          </div>
          <div className="setting-item">
            <div className="setting-label">Reject</div>
            <div className="setting-value" style={{color: 'var(--accent-red)'}}>&lt;{policy.decision.referThreshold}</div>
          </div>
        </div>
      </div>

      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Affordability &amp; Loan Sizing</h3>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-label">EMI method</div>
            <div className="setting-value" style={{fontSize: '1.1rem'}}>
              {policy.affordability.method === 'amortized'
                ? `Amortized @ ${policy.affordability.annualInterestRate}% p.a.`
                : `Flat factor ${policy.affordability.flatFactor} (ignores interest)`}
            </div>
          </div>
          <div className="setting-item">
            <div className="setting-label">Min EMI coverage</div>
            <div className="setting-value">{policy.affordability.minEMICoverage}x</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Max EMI = free cash flow ÷ {policy.affordability.minEMICoverage}</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Unsecured sizing</div>
            <div className="setting-value">{Math.round(policy.affordability.unsecuredHaircut * 100)}%</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>of cash-flow eligibility</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Collateral headroom</div>
            <div className="setting-value">{policy.affordability.collateralHeadroom}x</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>of collateral cap, for secured loans</p>
          </div>
        </div>
      </div>

      {/* Scorecard */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Scorecard (100 points)</h3>
        </div>
        <div className="table-container" style={{border: 'none'}}>
          <table>
            <thead>
              <tr><th>Component</th><th>Metric</th><th>Max</th><th>Bands → points</th></tr>
            </thead>
            <tbody>
              {scorecard.map(({ name, metric, c }) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="text-muted">{metric}</td>
                  <td>{c.max}</td>
                  <td className="font-mono text-xs">
                    {c.bands.map(b => `${c.direction === 'higher-is-better' ? '≥' : '≤'}${b.threshold} → ${b.points}`).join(' · ')} · else {c.otherwise}
                  </td>
                </tr>
              ))}
              <tr>
                <td>Collateral</td>
                <td className="text-muted">Collateral cap ÷ amount</td>
                <td>{s.collateral.max}</td>
                <td className="font-mono text-xs">
                  {s.collateral.coverageBands.map(b => `≥${b.threshold} → ${b.points}`).join(' · ')} · else {s.collateral.otherwise}
                  {s.collateral.preferredTypes.length > 0 && ` · +${s.collateral.preferredTypeBonus} for ${s.collateral.preferredTypes.join('/')}`}
                  {s.collateral.personalGuaranteeBonus > 0 && ` · +${s.collateral.personalGuaranteeBonus} for guarantee`}
                </td>
              </tr>
              <tr>
                <td>Profile</td>
                <td className="text-muted">Vintage (months) + industry risk</td>
                <td>{s.profile.max}</td>
                <td className="font-mono text-xs">
                  {s.profile.vintageBands.map(b => `≥${b.threshold}m → ${b.points}`).join(' · ')} · else {s.profile.vintageOtherwise}
                  {` · industry LOW ${s.profile.industryPoints.LOW} / MEDIUM ${s.profile.industryPoints.MEDIUM} / HIGH ${s.profile.industryPoints.HIGH}`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* LTV Limits */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">LTV Limits by Collateral Type</h3>
        </div>
        <div className="settings-grid">
          {collateralTypes.map(({ key, label }) => (
            <div key={key} className="setting-item">
              <div className="setting-label">{label}</div>
              <div className="setting-value">{policy.collateral.ltvLimits[key]}%</div>
              <div style={{marginTop: 'var(--space-3)'}}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${policy.collateral.ltvLimits[key]}%`}}></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Industry Risk Bands */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Industry Risk Classification</h3>
          <span className="badge badge-gray">Unlisted industries: {policy.industries.defaultBand}</span>
        </div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)'}}>
          {Object.entries(policy.industries.riskBands).map(([industry, risk]) => (
            <div key={industry} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)'}}>
              <span>{industry}</span>
              <span className={`badge ${risk === 'LOW' ? 'badge-success' : risk === 'MEDIUM' ? 'badge-warning' : 'badge-danger'}`}>
                {risk}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Fraud rules */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Fraud Pre-checks</h3>
          <span className="badge badge-gray">Hard stop at {policy.fraud.hardStopSeverity}</span>
        </div>
        <div className="table-container" style={{border: 'none'}}>
          <table>
            <thead>
              <tr><th>Rule</th><th>Status</th><th>Severity</th><th>Trigger</th></tr>
            </thead>
            <tbody>
              {Object.entries(policy.fraud.rules).map(([key, rule]) => (
                <tr key={key}>
                  <td>{fraudRuleLabels[key as keyof typeof fraudRuleLabels]}</td>
                  <td>{rule.enabled ? 'On' : <span className="text-muted">Off</span>}</td>
                  <td><span className={`badge ${severityBadge(rule.severity)}`}>{rule.severity}</span></td>
                  <td className="text-xs text-muted">{describeRuleParams(key, rule as Record<string, unknown>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bureau */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Bureau Overlay</h3>
          <span className="badge badge-gray">Modifier only, never a gate</span>
        </div>
        <div className="settings-grid">
          {policy.bureau.scoreBands.map(b => (
            <div key={b.minScore} className="setting-item">
              <div className="setting-label">Score ≥{b.minScore}</div>
              <div className="setting-value">{b.modifier > 0 ? '+' : ''}{b.modifier}</div>
            </div>
          ))}
          <div className="setting-item">
            <div className="setting-label">Below all bands</div>
            <div className="setting-value">{policy.bureau.otherwiseModifier}</div>
          </div>
          <div className="setting-item">
            <div className="setting-label">DPD 90+ history</div>
            <div className="setting-value">{policy.bureau.delinquencyModifier}</div>
          </div>
        </div>
      </div>

      {/* Version history */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Policy History</h3>
        </div>
        {history.length === 0 ? (
          <p className="text-muted">No policy applied yet. Decisions use the built-in default ({policy.id}@{policy.version}).</p>
        ) : (
          <div className="table-container" style={{border: 'none'}}>
            <table>
              <thead>
                <tr><th>Policy</th><th>Checksum</th><th>Activated</th><th>Decisions</th><th></th></tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="font-mono">{h.policyKey}@{h.version}</td>
                    <td className="font-mono text-xs">{h.checksum.slice(0, 12)}…</td>
                    <td className="text-muted">{h.activatedAt ? h.activatedAt.toLocaleDateString('en-IN') : '—'}</td>
                    <td>{h._count.decisions}</td>
                    <td>{h.isActive && <span className="badge badge-success">Active</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
