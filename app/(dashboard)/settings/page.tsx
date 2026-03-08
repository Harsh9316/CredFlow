import prisma from '@/lib/db'

async function getSettings() {
  const settings = await prisma.settings.findFirst({
    include: { nbfc: { select: { name: true } } }
  })
  return settings
}

function formatLtv(ltvLimits: string | null): Record<string, number> {
  if (!ltvLimits) return {}
  try {
    return JSON.parse(ltvLimits)
  } catch {
    return {}
  }
}

function formatRiskBands(bands: string | null): Record<string, string> {
  if (!bands) return {}
  try {
    return JSON.parse(bands)
  } catch {
    return {}
  }
}

export default async function SettingsPage() {
  const settings = await getSettings()

  const ltvLimits = formatLtv(settings?.ltvLimits || null)
  const riskBands = formatRiskBands(settings?.industryRiskBands || null)

  const collateralTypes = [
    { key: 'LAP', label: 'Loan Against Property' },
    { key: 'MACHINERY', label: 'Machinery' },
    { key: 'INVOICE', label: 'Invoice Financing' },
    { key: 'STOCK', label: 'Stock/Inventory' },
    { key: 'FD', label: 'Fixed Deposit' },
  ]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure credit decision parameters for {settings?.nbfc?.name || 'your NBFC'}</p>
        </div>
      </div>

      {/* Credit Policy Version */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Credit Policy</h3>
          <span className="badge badge-primary">Active</span>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-label">Policy Version</div>
            <div className="setting-value" style={{fontSize: '1.5rem'}}>{settings?.creditPolicyVersion || 'v1.0'}</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Used for audit trails, portfolio backtesting, and investor diligence</p>
          </div>
        </div>
      </div>

      {/* Credit Score Thresholds */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Credit Score Thresholds</h3>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-label">Approve Threshold</div>
            <div className="setting-value" style={{color: 'var(--accent-green)'}}>≥{settings?.approveThreshold}</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Score above this = Auto-recommend approval</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Refer Threshold</div>
            <div className="setting-value" style={{color: 'var(--accent-yellow)'}}>{settings?.referThreshold}–{(settings?.approveThreshold || 70) - 1}</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Score in this range = Manual review</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Reject Threshold</div>
            <div className="setting-value" style={{color: 'var(--accent-red)'}}>&lt;{settings?.referThreshold}</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Score below this = Auto-reject</p>
          </div>
        </div>
      </div>

      {/* Cash Flow Rules */}
      <div className="card settings-section">
        <div className="card-header">
          <h3 className="card-title">Cash Flow Rules</h3>
        </div>
        <div className="settings-grid">
          <div className="setting-item">
            <div className="setting-label">Min EMI Coverage Ratio</div>
            <div className="setting-value">{settings?.minEMICoverage}x</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Free Cash Flow ≥ EMI × {settings?.minEMICoverage}</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Max Inflow Volatility (CV)</div>
            <div className="setting-value">{((settings?.maxInflowCV || 0.5) * 100)}%</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Cash flow coefficient of variation limit</p>
          </div>
          <div className="setting-item">
            <div className="setting-label">Min Business Vintage</div>
            <div className="setting-value">{settings?.minBusinessVintage} months</div>
            <p className="text-xs text-muted" style={{marginTop: 'var(--space-2)'}}>Minimum time in business required</p>
          </div>
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
              <div className="setting-value">{ltvLimits[key] || 0}%</div>
              <div style={{marginTop: 'var(--space-3)'}}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${ltvLimits[key] || 0}%`}}></div>
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
        </div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)'}}>
          {Object.entries(riskBands).map(([industry, risk]) => (
            <div key={industry} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)'}}>
              <span>{industry}</span>
              <span className={`badge ${risk === 'LOW' ? 'badge-success' : risk === 'MEDIUM' ? 'badge-warning' : 'badge-danger'}`}>
                {risk}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* API Keys Placeholder */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">API Integrations</h3>
          <span className="badge badge-gray">Coming Soon</span>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h4 className="empty-state-title">API Keys for External Integrations</h4>
          <p className="empty-state-desc">Connect to Account Aggregators, GST API, and other data sources.</p>
        </div>
      </div>
    </>
  )
}
