'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Alert, PageHeader } from '@/components/ui'
import { COLLATERAL_LABEL, inr } from '@/lib/format'

const INDUSTRIES = [
  'Manufacturing', 'IT Services', 'Healthcare', 'Retail', 'Construction', 'Agriculture', 'Real Estate',
  'Hospitality', 'Trading', 'Logistics', 'Education', 'Food Processing', 'Textiles', 'Pharmaceuticals',
]
const CONSTITUTIONS = ['Proprietorship', 'Partnership', 'LLP', 'Pvt Ltd', 'Public Ltd']
const COLLATERAL = [
  { value: 'NONE', title: 'Unsecured', desc: 'No collateral' },
  { value: 'LAP', title: 'Property', desc: 'Loan against property' },
  { value: 'MACHINERY', title: 'Machinery', desc: 'Plant & equipment' },
  { value: 'INVOICE', title: 'Invoices', desc: 'Receivables' },
  { value: 'STOCK', title: 'Stock', desc: 'Inventory' },
  { value: 'FD', title: 'Fixed deposit', desc: 'Lien on FD' },
]
const STEPS = ['Borrower', 'Loan', 'Financials', 'Security'] as const

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

function Field({ id, label, required, hint, children, span }: { id: string; label: string; required?: boolean; hint?: ReactNode; children: ReactNode; span?: boolean }) {
  return (
    <div className={`field${span ? ' field-span' : ''}`}>
      <label className="label" htmlFor={id}>{label}{required && <span className="req" aria-hidden>*</span>}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

function Money({ id, value, onChange, placeholder, required }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <div className="input-affix">
      <span>₹</span>
      <input id={id} className="input has-prefix num" type="number" min={0} inputMode="numeric" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} />
    </div>
  )
}

export default function NewApplicationPage() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [f, setF] = useState({
    businessName: '', legalName: '', pan: '', gstin: '', industry: '', constitution: '', vintage: '', annualTurnover: '',
    contactPerson: '', contactPhone: '', contactEmail: '', city: '', state: '',
    requestedAmount: '', requestedTenure: '', purpose: '', priority: 'NORMAL',
    avgMonthlyInflow: '', avgMonthlyExpenses: '', inflowVolatility: '0.2',
    collateralType: 'NONE', assessedValue: '', ltv: '70', hasPersonalGuarantee: false, guarantorName: '', guarantorRelation: '',
  })
  const set = (k: keyof typeof f) => (v: string | boolean) => setF(prev => ({ ...prev, [k]: v }))

  const n = (v: string) => (v === '' ? NaN : Number(v))
  const fcf = n(f.avgMonthlyInflow) - n(f.avgMonthlyExpenses)
  const indicativeEmi = useMemo(() => {
    const p = n(f.requestedAmount)
    const months = n(f.requestedTenure)
    if (!(p > 0) || !(months > 0)) return NaN
    const r = 0.14 / 12
    return (p * r) / (1 - Math.pow(1 + r, -months))
  }, [f.requestedAmount, f.requestedTenure])
  const coverage = fcf / indicativeEmi

  const validate = (s: number): string | null => {
    if (s === 0) {
      if (!f.businessName || !f.industry || !f.constitution || !f.vintage || !f.contactPerson || !f.contactPhone) return 'Fill in the required borrower fields.'
      if (f.pan && !PAN.test(f.pan)) return 'PAN should look like ABCDE1234F.'
      if (f.gstin && !GSTIN.test(f.gstin)) return 'GSTIN should be 15 characters, like 27ABCDE1234F1Z5.'
    }
    if (s === 1 && (!(n(f.requestedAmount) > 0) || !(n(f.requestedTenure) > 0))) return 'Enter the loan amount and tenure.'
    if (s === 2 && (!(n(f.avgMonthlyInflow) >= 0) || !(n(f.avgMonthlyExpenses) >= 0) || f.avgMonthlyInflow === '' || f.avgMonthlyExpenses === '')) return 'Enter average monthly inflow and expenses.'
    if (s === 3 && f.collateralType !== 'NONE' && !(n(f.assessedValue) > 0)) return 'Enter the assessed value of the collateral.'
    return null
  }

  const next = () => {
    const problem = validate(step)
    if (problem) return setError(problem)
    setError('')
    setStep(step + 1)
    setMaxStep(Math.max(maxStep, step + 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async () => {
    for (let s = 0; s < STEPS.length; s++) {
      const problem = validate(s)
      if (problem) {
        setStep(s)
        return setError(problem)
      }
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f,
          freeCashFlow: Number.isFinite(fcf) ? String(fcf) : undefined,
          assessedValue: f.collateralType !== 'NONE' ? f.assessedValue : undefined,
          ltv: f.collateralType !== 'NONE' ? f.ltv : undefined,
          guarantorName: f.hasPersonalGuarantee ? f.guarantorName : undefined,
          guarantorRelation: f.hasPersonalGuarantee ? f.guarantorRelation : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create the application')
        return
      }
      router.push(`/applications/${data.applicationId}`)
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader back={{ href: '/applications', label: 'Applications' }} title="New application" description="Capture the borrower, request, cash flow and security. You can run the underwriting engine right after." />

      <ol className="stepper" aria-label="Steps">
        {STEPS.map((name, i) => (
          <li key={name} style={{ flex: 1, minWidth: 150 }}>
            <button
              type="button"
              className={`step${i === step ? ' current' : i <= maxStep ? ' done' : ''}`}
              style={{ width: '100%' }}
              disabled={i > maxStep}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => { setError(''); setStep(i) }}
            >
              <span className="step-num">Step {i + 1}</span>
              <span className="step-name">{name}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="split" style={{ '--rail': '320px' } as React.CSSProperties}>
        <form className="card" onSubmit={e => { e.preventDefault(); if (step < STEPS.length - 1) next(); else submit() }} noValidate>
          <div className="card-body fade-in" key={step}>
            {error && <Alert tone="danger" className="mb-6">{error}</Alert>}

            {step === 0 && (
              <>
                <div className="form-section">
                  <h2 className="form-section-title">Business</h2>
                  <p className="form-section-desc">Identity documents are verified and cross-checked during underwriting.</p>
                  <div className="form-grid">
                    <Field id="businessName" label="Business name" required span>
                      <input id="businessName" className="input" value={f.businessName} onChange={e => set('businessName')(e.target.value)} placeholder="Shakti Auto Components" autoFocus />
                    </Field>
                    <Field id="legalName" label="Legal name" hint="If different from the business name" span>
                      <input id="legalName" className="input" value={f.legalName} onChange={e => set('legalName')(e.target.value)} placeholder="Shakti Auto Components Pvt Ltd" />
                    </Field>
                    <Field id="industry" label="Industry" required>
                      <select id="industry" className="select" value={f.industry} onChange={e => set('industry')(e.target.value)}>
                        <option value="">Select…</option>
                        {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                      </select>
                    </Field>
                    <Field id="constitution" label="Constitution" required>
                      <select id="constitution" className="select" value={f.constitution} onChange={e => set('constitution')(e.target.value)}>
                        <option value="">Select…</option>
                        {CONSTITUTIONS.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field id="pan" label="PAN">
                      <input id="pan" className="input mono" value={f.pan} onChange={e => set('pan')(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
                    </Field>
                    <Field id="gstin" label="GSTIN">
                      <input id="gstin" className="input mono" value={f.gstin} onChange={e => set('gstin')(e.target.value.toUpperCase())} placeholder="27ABCDE1234F1Z5" maxLength={15} />
                    </Field>
                    <Field id="vintage" label="Time in business" required hint="Months since incorporation or start of operations">
                      <div className="input-affix">
                        <input id="vintage" className="input num" type="number" min={0} value={f.vintage} onChange={e => set('vintage')(e.target.value)} placeholder="36" style={{ paddingRight: 70 }} />
                        <span>months</span>
                      </div>
                    </Field>
                    <Field id="annualTurnover" label="Annual turnover" hint={n(f.annualTurnover) > 0 ? inr(n(f.annualTurnover)) : 'As declared in the last filed return'}>
                      <Money id="annualTurnover" value={f.annualTurnover} onChange={set('annualTurnover')} placeholder="50000000" />
                    </Field>
                  </div>
                </div>
                <div className="form-section">
                  <h2 className="form-section-title">Contact & location</h2>
                  <p className="form-section-desc">Primary contact for this application.</p>
                  <div className="form-grid">
                    <Field id="contactPerson" label="Contact person" required>
                      <input id="contactPerson" className="input" value={f.contactPerson} onChange={e => set('contactPerson')(e.target.value)} placeholder="Full name" />
                    </Field>
                    <Field id="contactPhone" label="Phone" required>
                      <input id="contactPhone" className="input" type="tel" value={f.contactPhone} onChange={e => set('contactPhone')(e.target.value)} placeholder="98765 43210" />
                    </Field>
                    <Field id="contactEmail" label="Email">
                      <input id="contactEmail" className="input" type="email" value={f.contactEmail} onChange={e => set('contactEmail')(e.target.value)} placeholder="finance@company.in" />
                    </Field>
                    <div />
                    <Field id="city" label="City">
                      <input id="city" className="input" value={f.city} onChange={e => set('city')(e.target.value)} placeholder="Pune" />
                    </Field>
                    <Field id="state" label="State">
                      <input id="state" className="input" value={f.state} onChange={e => set('state')(e.target.value)} placeholder="Maharashtra" />
                    </Field>
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <div className="form-section">
                <h2 className="form-section-title">Loan request</h2>
                <p className="form-section-desc">What the borrower is asking for. The engine may recommend a different amount.</p>
                <div className="form-grid">
                  <Field id="requestedAmount" label="Amount" required hint={n(f.requestedAmount) > 0 ? inr(n(f.requestedAmount)) : undefined}>
                    <Money id="requestedAmount" value={f.requestedAmount} onChange={set('requestedAmount')} placeholder="2500000" />
                  </Field>
                  <Field id="requestedTenure" label="Tenure" required>
                    <div className="input-affix">
                      <input id="requestedTenure" className="input num" type="number" min={1} max={360} value={f.requestedTenure} onChange={e => set('requestedTenure')(e.target.value)} placeholder="36" style={{ paddingRight: 70 }} />
                      <span>months</span>
                    </div>
                  </Field>
                  <Field id="purpose" label="Purpose" span>
                    <input id="purpose" className="input" value={f.purpose} onChange={e => set('purpose')(e.target.value)} placeholder="Working capital, equipment purchase, expansion…" />
                  </Field>
                  <Field id="priority" label="Priority">
                    <select id="priority" className="select" value={f.priority} onChange={e => set('priority')(e.target.value)}>
                      <option value="LOW">Low</option>
                      <option value="NORMAL">Normal</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </select>
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="form-section">
                <h2 className="form-section-title">Cash flow</h2>
                <p className="form-section-desc">From bank statement analysis. Averages over the last six months work best.</p>
                <div className="form-grid">
                  <Field id="avgMonthlyInflow" label="Average monthly inflow" required hint={n(f.avgMonthlyInflow) > 0 ? inr(n(f.avgMonthlyInflow)) : undefined}>
                    <Money id="avgMonthlyInflow" value={f.avgMonthlyInflow} onChange={set('avgMonthlyInflow')} placeholder="2500000" />
                  </Field>
                  <Field id="avgMonthlyExpenses" label="Average monthly expenses" required hint={n(f.avgMonthlyExpenses) > 0 ? inr(n(f.avgMonthlyExpenses)) : undefined}>
                    <Money id="avgMonthlyExpenses" value={f.avgMonthlyExpenses} onChange={set('avgMonthlyExpenses')} placeholder="1800000" />
                  </Field>
                  <Field id="inflowVolatility" label="Inflow volatility" hint="Coefficient of variation of monthly credits: 0.1 is very steady, 0.5 is volatile">
                    <input id="inflowVolatility" className="input num" type="number" min={0} step="0.01" value={f.inflowVolatility} onChange={e => set('inflowVolatility')(e.target.value)} />
                  </Field>
                  <div className="field">
                    <span className="label">Free cash flow</span>
                    <div className={`tile figure num ${Number.isFinite(fcf) ? (fcf > 0 ? 'tone-success' : 'tone-danger') : 'muted'}`} style={{ padding: '6px 12px', fontSize: 18 }}>
                      {Number.isFinite(fcf) ? `${inr(fcf)} / month` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <>
                <div className="form-section">
                  <h2 className="form-section-title">Collateral</h2>
                  <p className="form-section-desc">The policy caps the usable LTV for each collateral type.</p>
                  <div className="choice-grid" role="radiogroup" aria-label="Collateral type">
                    {COLLATERAL.map(c => (
                      <label key={c.value} className={`choice${f.collateralType === c.value ? ' selected' : ''}`}>
                        <input type="radio" name="collateralType" value={c.value} checked={f.collateralType === c.value} onChange={() => set('collateralType')(c.value)} />
                        <span className="choice-title">{c.title}</span>
                        <span className="choice-desc">{c.desc}</span>
                      </label>
                    ))}
                  </div>
                  {f.collateralType !== 'NONE' && (
                    <div className="form-grid mt-6">
                      <Field id="assessedValue" label="Assessed value" required hint={n(f.assessedValue) > 0 ? inr(n(f.assessedValue)) : undefined}>
                        <Money id="assessedValue" value={f.assessedValue} onChange={set('assessedValue')} placeholder="10000000" />
                      </Field>
                      <Field id="ltv" label="Requested LTV" hint={n(f.assessedValue) > 0 && n(f.ltv) > 0 ? `Collateral cap ${inr((n(f.assessedValue) * n(f.ltv)) / 100)}` : undefined}>
                        <div className="input-affix">
                          <input id="ltv" className="input num" type="number" min={0} max={100} value={f.ltv} onChange={e => set('ltv')(e.target.value)} style={{ paddingRight: 30 }} />
                          <span>%</span>
                        </div>
                      </Field>
                    </div>
                  )}
                </div>
                <div className="form-section">
                  <label className="check">
                    <input type="checkbox" checked={f.hasPersonalGuarantee} onChange={e => set('hasPersonalGuarantee')(e.target.checked)} />
                    <span>
                      <span className="strong" style={{ display: 'block' }}>Personal guarantee</span>
                      <span className="small muted">A promoter or director guarantees the loan.</span>
                    </span>
                  </label>
                  {f.hasPersonalGuarantee && (
                    <div className="form-grid mt-4">
                      <Field id="guarantorName" label="Guarantor name">
                        <input id="guarantorName" className="input" value={f.guarantorName} onChange={e => set('guarantorName')(e.target.value)} />
                      </Field>
                      <Field id="guarantorRelation" label="Relationship">
                        <input id="guarantorRelation" className="input" value={f.guarantorRelation} onChange={e => set('guarantorRelation')(e.target.value)} placeholder="Director" />
                      </Field>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="between card-foot" style={{ background: 'var(--surface)' }}>
            {step > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={() => { setError(''); setStep(step - 1) }}><ArrowLeft aria-hidden /> Back</button>
            ) : <span />}
            {step < STEPS.length - 1 ? (
              <button type="submit" className="btn btn-primary">Continue <ArrowRight aria-hidden /></button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <><span className="spinner" aria-hidden /> Creating…</> : <><Check aria-hidden /> Create application</>}
              </button>
            )}
          </div>
        </form>

        <aside className="split-rail card" aria-label="Summary">
          <div className="card-head"><h2 className="card-title">Summary</h2></div>
          <div className="card-body">
            <dl className="kv" style={{ gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--space-4)' }}>
              <div><dt>Borrower</dt><dd>{f.businessName || <span className="muted">—</span>}{f.industry && <span className="small muted" style={{ display: 'block', fontWeight: 400 }}>{f.industry}{f.constitution ? ` · ${f.constitution}` : ''}</span>}</dd></div>
              <div><dt>Request</dt><dd className="num">{n(f.requestedAmount) > 0 ? `${inr(n(f.requestedAmount))}${n(f.requestedTenure) > 0 ? ` · ${f.requestedTenure} months` : ''}` : <span className="muted">—</span>}</dd></div>
              <div><dt>Free cash flow</dt><dd className="num">{Number.isFinite(fcf) ? `${inr(fcf)} / month` : <span className="muted">—</span>}</dd></div>
              <div>
                <dt>Indicative EMI coverage</dt>
                <dd className={`num ${Number.isFinite(coverage) ? (coverage >= 1.5 ? 'tone-success' : 'tone-warning') : ''}`}>
                  {Number.isFinite(coverage) && coverage > 0 ? `${coverage.toFixed(2)}x` : <span className="muted">—</span>}
                </dd>
              </div>
              <div><dt>Security</dt><dd>{COLLATERAL_LABEL[f.collateralType]}{f.collateralType !== 'NONE' && n(f.assessedValue) > 0 ? ` · ${inr(n(f.assessedValue))}` : ''}</dd></div>
            </dl>
          </div>
          <div className="card-foot">Coverage is indicative at 14% p.a. The engine uses your policy&apos;s rate and rules.</div>
        </aside>
      </div>
    </>
  )
}
