'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const industries = [
  'Manufacturing', 'IT Services', 'Healthcare', 'Retail', 'Construction',
  'Agriculture', 'Real Estate', 'Hospitality', 'Trading', 'Logistics',
  'Education', 'Food Processing', 'Textiles', 'Pharmaceuticals'
]

const constitutions = ['Proprietorship', 'Partnership', 'LLP', 'Pvt Ltd', 'Public Ltd']
const collateralTypes = [
  { value: 'NONE', label: 'Unsecured (No Collateral)' },
  { value: 'LAP', label: 'Loan Against Property' },
  { value: 'MACHINERY', label: 'Machinery' },
  { value: 'INVOICE', label: 'Invoice Financing' },
  { value: 'STOCK', label: 'Stock / Inventory' },
  { value: 'FD', label: 'Fixed Deposit' },
]

export default function NewApplicationPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Borrower fields
  const [businessName, setBusinessName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [pan, setPan] = useState('')
  const [gstin, setGstin] = useState('')
  const [industry, setIndustry] = useState('')
  const [constitution, setConstitution] = useState('')
  const [vintage, setVintage] = useState('')
  const [annualTurnover, setAnnualTurnover] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')

  // Loan fields
  const [requestedAmount, setRequestedAmount] = useState('')
  const [requestedTenure, setRequestedTenure] = useState('')
  const [purpose, setPurpose] = useState('')
  const [priority, setPriority] = useState('NORMAL')

  // Financial fields
  const [avgMonthlyInflow, setAvgMonthlyInflow] = useState('')
  const [avgMonthlyExpenses, setAvgMonthlyExpenses] = useState('')
  const [inflowVolatility, setInflowVolatility] = useState('0.2')

  // Collateral fields
  const [collateralType, setCollateralType] = useState('NONE')
  const [assessedValue, setAssessedValue] = useState('')
  const [ltv, setLtv] = useState('70')
  const [hasPersonalGuarantee, setHasPersonalGuarantee] = useState(false)
  const [guarantorName, setGuarantorName] = useState('')

  const handleSubmit = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName, legalName, pan, gstin, industry, constitution,
          vintage, annualTurnover, contactPerson, contactPhone, contactEmail,
          city, state,
          requestedAmount, requestedTenure, purpose, priority,
          avgMonthlyInflow, avgMonthlyExpenses,
          freeCashFlow: avgMonthlyInflow && avgMonthlyExpenses
            ? String(parseFloat(avgMonthlyInflow) - parseFloat(avgMonthlyExpenses))
            : undefined,
          inflowVolatility,
          collateralType,
          assessedValue: collateralType !== 'NONE' ? assessedValue : undefined,
          ltv: collateralType !== 'NONE' ? ltv : undefined,
          hasPersonalGuarantee,
          guarantorName: hasPersonalGuarantee ? guarantorName : undefined,
        })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create application')
        return
      }

      router.push(`/applications/${data.applicationId}`)
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (val: string) => {
    const num = parseFloat(val)
    if (isNaN(num)) return ''
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`
    if (num >= 100000) return `₹${(num / 100000).toFixed(1)} L`
    return `₹${num.toLocaleString()}`
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">New Loan Application</h1>
          <p className="page-subtitle">Create a new SME loan application</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="card mb-6">
        <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-4)', justifyContent: 'center'}}>
          {[
            { num: 1, label: 'Borrower Profile' },
            { num: 2, label: 'Loan Details' },
            { num: 3, label: 'Financials' },
            { num: 4, label: 'Security' },
          ].map((s, i) => (
            <div key={s.num} style={{display: 'flex', alignItems: 'center', gap: 'var(--space-2)'}}>
              <div
                onClick={() => setStep(s.num)}
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
                  background: step === s.num ? 'var(--primary-500)' : step > s.num ? 'var(--accent-green)' : 'var(--bg-glass)',
                  color: step >= s.num ? 'white' : 'var(--text-muted)',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {step > s.num ? '✓' : s.num}
              </div>
              <span style={{fontSize: '0.875rem', color: step === s.num ? 'var(--text-primary)' : 'var(--text-muted)'}}>{s.label}</span>
              {i < 3 && <div style={{width: 40, height: 2, background: step > s.num ? 'var(--accent-green)' : 'var(--border-color)', margin: '0 var(--space-2)'}}></div>}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Borrower Profile */}
      {step === 1 && (
        <div className="card animate-fadeIn">
          <div className="card-header"><h3 className="card-title">Borrower Profile</h3></div>
          <div className="grid-2" style={{gap: 'var(--space-4)'}}>
            <div className="form-group">
              <label className="form-label">Business Name *</label>
              <input className="form-input" value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="e.g., ABC Manufacturing Pvt Ltd" />
            </div>
            <div className="form-group">
              <label className="form-label">Legal Name</label>
              <input className="form-input" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="If different from business name" />
            </div>
            <div className="form-group">
              <label className="form-label">Industry *</label>
              <select className="form-select" value={industry} onChange={e => setIndustry(e.target.value)}>
                <option value="">Select Industry</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Constitution *</label>
              <select className="form-select" value={constitution} onChange={e => setConstitution(e.target.value)}>
                <option value="">Select Constitution</option>
                {constitutions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">PAN</label>
              <input className="form-input" value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
            </div>
            <div className="form-group">
              <label className="form-label">GSTIN</label>
              <input className="form-input" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} placeholder="22ABCDE1234F1Z5" maxLength={15} />
            </div>
            <div className="form-group">
              <label className="form-label">Business Vintage (months) *</label>
              <input className="form-input" type="number" value={vintage} onChange={e => setVintage(e.target.value)} placeholder="e.g., 36" />
            </div>
            <div className="form-group">
              <label className="form-label">Annual Turnover (₹)</label>
              <input className="form-input" type="number" value={annualTurnover} onChange={e => setAnnualTurnover(e.target.value)} placeholder="e.g., 50000000" />
              {annualTurnover && <small className="text-muted">{formatCurrency(annualTurnover)}</small>}
            </div>
            <div className="form-group">
              <label className="form-label">Contact Person *</label>
              <input className="form-input" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Full name" />
            </div>
            <div className="form-group">
              <label className="form-label">Contact Phone *</label>
              <input className="form-input" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
            <div className="form-group">
              <label className="form-label">City</label>
              <input className="form-input" value={city} onChange={e => setCity(e.target.value)} placeholder="Mumbai" />
            </div>
            <div className="form-group">
              <label className="form-label">State</label>
              <input className="form-input" value={state} onChange={e => setState(e.target.value)} placeholder="Maharashtra" />
            </div>
          </div>
          <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-6)'}}>
            <button className="btn btn-primary" onClick={() => {
              if (!businessName || !industry || !constitution || !contactPerson || !contactPhone) {
                setError('Please fill all required (*) fields')
                return
              }
              setError('')
              setStep(2)
            }}>Next: Loan Details →</button>
          </div>
        </div>
      )}

      {/* Step 2: Loan Details */}
      {step === 2 && (
        <div className="card animate-fadeIn">
          <div className="card-header"><h3 className="card-title">Loan Request</h3></div>
          <div className="grid-2" style={{gap: 'var(--space-4)'}}>
            <div className="form-group">
              <label className="form-label">Requested Amount (₹) *</label>
              <input className="form-input" type="number" value={requestedAmount} onChange={e => setRequestedAmount(e.target.value)} placeholder="e.g., 5000000" />
              {requestedAmount && <small className="text-muted">{formatCurrency(requestedAmount)}</small>}
            </div>
            <div className="form-group">
              <label className="form-label">Requested Tenure (months) *</label>
              <input className="form-input" type="number" value={requestedTenure} onChange={e => setRequestedTenure(e.target.value)} placeholder="e.g., 36" />
            </div>
            <div className="form-group">
              <label className="form-label">Purpose</label>
              <input className="form-input" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g., Working Capital, Equipment Purchase" />
            </div>
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>
          <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-6)'}}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => {
              if (!requestedAmount || !requestedTenure) {
                setError('Please fill amount and tenure')
                return
              }
              setError('')
              setStep(3)
            }}>Next: Financials →</button>
          </div>
        </div>
      )}

      {/* Step 3: Financials */}
      {step === 3 && (
        <div className="card animate-fadeIn">
          <div className="card-header">
            <h3 className="card-title">Financial Information</h3>
            <span className="badge badge-primary">Bank Statement Analysis</span>
          </div>
          <div className="grid-2" style={{gap: 'var(--space-4)'}}>
            <div className="form-group">
              <label className="form-label">Avg Monthly Inflow (₹) *</label>
              <input className="form-input" type="number" value={avgMonthlyInflow} onChange={e => setAvgMonthlyInflow(e.target.value)} placeholder="e.g., 2500000" />
              {avgMonthlyInflow && <small className="text-muted">{formatCurrency(avgMonthlyInflow)}</small>}
            </div>
            <div className="form-group">
              <label className="form-label">Avg Monthly Expenses (₹) *</label>
              <input className="form-input" type="number" value={avgMonthlyExpenses} onChange={e => setAvgMonthlyExpenses(e.target.value)} placeholder="e.g., 1800000" />
              {avgMonthlyExpenses && <small className="text-muted">{formatCurrency(avgMonthlyExpenses)}</small>}
            </div>
            <div className="form-group">
              <label className="form-label">Inflow Volatility (CV)</label>
              <input className="form-input" type="number" step="0.01" value={inflowVolatility} onChange={e => setInflowVolatility(e.target.value)} placeholder="0.2" />
              <small className="text-muted">Coefficient of variation (0 = stable, 1 = very volatile)</small>
            </div>
            {avgMonthlyInflow && avgMonthlyExpenses && (
              <div className="form-group">
                <label className="form-label">Free Cash Flow (calculated)</label>
                <div style={{padding: 'var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)', fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 600, color: parseFloat(avgMonthlyInflow) - parseFloat(avgMonthlyExpenses) > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}}>
                  {formatCurrency(String(parseFloat(avgMonthlyInflow) - parseFloat(avgMonthlyExpenses)))} / month
                </div>
              </div>
            )}
          </div>
          <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-6)'}}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
            <button className="btn btn-primary" onClick={() => {
              if (!avgMonthlyInflow || !avgMonthlyExpenses) {
                setError('Please fill financial details')
                return
              }
              setError('')
              setStep(4)
            }}>Next: Security →</button>
          </div>
        </div>
      )}

      {/* Step 4: Security / Collateral */}
      {step === 4 && (
        <div className="card animate-fadeIn">
          <div className="card-header"><h3 className="card-title">Security & Collateral</h3></div>
          <div className="grid-2" style={{gap: 'var(--space-4)'}}>
            <div className="form-group" style={{gridColumn: '1 / -1'}}>
              <label className="form-label">Collateral Type</label>
              <select className="form-select" value={collateralType} onChange={e => setCollateralType(e.target.value)}>
                {collateralTypes.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            {collateralType !== 'NONE' && (
              <>
                <div className="form-group">
                  <label className="form-label">Assessed Value (₹) *</label>
                  <input className="form-input" type="number" value={assessedValue} onChange={e => setAssessedValue(e.target.value)} placeholder="e.g., 10000000" />
                  {assessedValue && <small className="text-muted">{formatCurrency(assessedValue)}</small>}
                </div>
                <div className="form-group">
                  <label className="form-label">LTV (%)</label>
                  <input className="form-input" type="number" value={ltv} onChange={e => setLtv(e.target.value)} placeholder="70" />
                  {assessedValue && ltv && (
                    <small className="text-muted">Collateral Cap: {formatCurrency(String(parseFloat(assessedValue) * parseFloat(ltv) / 100))}</small>
                  )}
                </div>
              </>
            )}
            <div className="form-group" style={{gridColumn: '1 / -1'}}>
              <label style={{display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer'}}>
                <input type="checkbox" checked={hasPersonalGuarantee} onChange={e => setHasPersonalGuarantee(e.target.checked)} />
                <span className="form-label" style={{margin: 0}}>Personal Guarantee</span>
              </label>
            </div>
            {hasPersonalGuarantee && (
              <div className="form-group">
                <label className="form-label">Guarantor Name</label>
                <input className="form-input" value={guarantorName} onChange={e => setGuarantorName(e.target.value)} placeholder="Full name of guarantor" />
              </div>
            )}
          </div>

          {/* Summary card */}
          <div style={{marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)'}}>
            <h4 style={{marginBottom: 'var(--space-3)', fontWeight: 600}}>Application Summary</h4>
            <div className="grid-2" style={{gap: 'var(--space-3)', fontSize: '0.875rem'}}>
              <div><span className="text-muted">Borrower:</span> {businessName}</div>
              <div><span className="text-muted">Industry:</span> {industry}</div>
              <div><span className="text-muted">Amount:</span> <strong>{formatCurrency(requestedAmount)}</strong></div>
              <div><span className="text-muted">Tenure:</span> {requestedTenure} months</div>
              <div><span className="text-muted">FCF:</span> {avgMonthlyInflow && avgMonthlyExpenses ? formatCurrency(String(parseFloat(avgMonthlyInflow) - parseFloat(avgMonthlyExpenses))) : 'N/A'}/mo</div>
              <div><span className="text-muted">Security:</span> {collateralType === 'NONE' ? 'Unsecured' : collateralType}</div>
            </div>
          </div>

          <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-6)'}}>
            <button className="btn btn-ghost" onClick={() => setStep(3)}>← Back</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? (
                <><span className="spinner" style={{width: 16, height: 16}}></span> Creating...</>
              ) : (
                '✓ Submit Application'
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
