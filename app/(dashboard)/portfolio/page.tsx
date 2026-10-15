import Link from 'next/link'
import { Briefcase, Building2, Landmark, Percent, ShieldCheck } from 'lucide-react'
import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import { Alert, Badge, Card, EmptyState, Meter, PageHeader, Stat } from '@/components/ui'
import { COLLATERAL_LABEL, date, inr } from '@/lib/format'

export const metadata = { title: 'Portfolio' }

// Concentration limits used for the risk governance warnings
const INDUSTRY_LIMIT = 0.35
const SINGLE_BORROWER_LIMIT = 0.25

const SECURITY_COLOR: Record<string, string> = {
  LAP: 'var(--chart-1)',
  MACHINERY: 'var(--chart-2)',
  INVOICE: 'var(--chart-4)',
  STOCK: 'var(--chart-3)',
  FD: 'var(--success)',
  NONE: 'var(--chart-5)',
}

export default async function PortfolioPage() {
  const session = await requirePageSession()

  // Everything is derived from confirmed sanctions only (pending checker approvals are excluded)
  const loans = await prisma.loanApplication.findMany({
    where: { nbfcId: session.nbfcId, status: 'SANCTIONED', approval: { status: 'CONFIRMED', finalDecision: 'APPROVE' } },
    include: {
      borrower: { select: { id: true, businessName: true, industry: true, city: true } },
      collateral: { select: { collateralType: true, assessedValue: true } },
      approval: { select: { sanctionedAmount: true, sanctionedTenure: true, interestRate: true } },
    },
    orderBy: { sanctionedAt: 'desc' },
  })

  const amountOf = (l: (typeof loans)[number]) => l.approval?.sanctionedAmount ?? 0
  const total = loans.reduce((s, l) => s + amountOf(l), 0)
  const borrowers = new Set(loans.map(l => l.borrower.id)).size
  const weightedRate = total > 0 ? loans.reduce((s, l) => s + amountOf(l) * (l.approval?.interestRate ?? 0), 0) / total : 0

  const group = <K extends string>(key: (l: (typeof loans)[number]) => K) => {
    const m = new Map<K, { count: number; amount: number }>()
    for (const l of loans) {
      const k = key(l)
      const g = m.get(k) ?? { count: 0, amount: 0 }
      g.count++
      g.amount += amountOf(l)
      m.set(k, g)
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v, share: total > 0 ? v.amount / total : 0 })).sort((a, b) => b.amount - a.amount)
  }

  const bySecurity = group(l => l.collateral?.collateralType ?? 'NONE')
  const byIndustry = group(l => l.borrower.industry)
  const byBorrower = group(l => l.borrower.businessName).slice(0, 5)
  const securedShare = bySecurity.filter(s => s.key !== 'NONE').reduce((s, g) => s + g.share, 0)

  const breaches = [
    ...byIndustry.filter(g => g.share > INDUSTRY_LIMIT).map(g => `${g.key} is ${Math.round(g.share * 100)}% of the book (limit ${INDUSTRY_LIMIT * 100}%).`),
    ...byBorrower.filter(g => g.share > SINGLE_BORROWER_LIMIT).map(g => `${g.key} is ${Math.round(g.share * 100)}% of the book (single-borrower limit ${SINGLE_BORROWER_LIMIT * 100}%).`),
  ]

  return (
    <>
      <PageHeader title="Portfolio" description="Sanctioned loans and concentration risk across the book." />

      {loans.length === 0 ? (
        <Card>
          <EmptyState icon={<Briefcase size={20} />} title="No sanctioned loans yet">
            Loans appear here once a sanction takes effect, after checker approval where your policy requires it.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat label="Sanctioned book" value={inr(total)} icon={<Landmark />} hint={<><strong>{loans.length}</strong> loans</>} />
            <Stat label="Borrowers" value={borrowers} icon={<Building2 />} hint={<>Avg. ticket <strong>{inr(total / loans.length)}</strong></>} />
            <Stat label="Secured" value={`${Math.round(securedShare * 100)}%`} icon={<ShieldCheck />} hint="of sanctioned amount" />
            <Stat label="Weighted avg. rate" value={`${weightedRate.toFixed(2)}%`} icon={<Percent />} hint="per annum" />
          </div>

          {breaches.length > 0 && (
            <Alert tone="warning" title="Concentration limits breached" className="mb-6">
              <ul style={{ listStyle: 'disc', paddingLeft: 18 }}>{breaches.map(b => <li key={b}>{b}</li>)}</ul>
            </Alert>
          )}

          <div className="grid-3 mb-6">
            <Card title="Security mix" description="Share of sanctioned amount">
              <div className="stacked-bar" role="img" aria-label="Security mix">
                {bySecurity.map(s => <span key={s.key} style={{ width: `${s.share * 100}%`, background: SECURITY_COLOR[s.key] ?? 'var(--chart-5)' }} />)}
              </div>
              <div className="legend">
                {bySecurity.map(s => (
                  <div key={s.key} className="legend-row">
                    <span className="legend-swatch" style={{ background: SECURITY_COLOR[s.key] ?? 'var(--chart-5)' }} />
                    <span>{COLLATERAL_LABEL[s.key] ?? s.key}</span>
                    <span className="num strong">{inr(s.amount)}</span>
                    <span className="num muted" style={{ width: 40, textAlign: 'right' }}>{Math.round(s.share * 100)}%</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Industry exposure" description={`Limit ${INDUSTRY_LIMIT * 100}% per industry`}>
              {byIndustry.map(g => (
                <div key={g.key} className="meter-row">
                  <div className="meter-head">
                    <span>{g.key}</span>
                    <span className={g.share > INDUSTRY_LIMIT ? 'tone-danger' : undefined}>{Math.round(g.share * 100)}%</span>
                  </div>
                  <Meter value={g.share * 100} tone={g.share > INDUSTRY_LIMIT ? 'danger' : undefined} label={g.key} />
                </div>
              ))}
            </Card>

            <Card title="Largest borrowers" description={`Limit ${SINGLE_BORROWER_LIMIT * 100}% per borrower`}>
              {byBorrower.map(g => (
                <div key={g.key} className="meter-row">
                  <div className="meter-head">
                    <span className="cell-truncate" style={{ maxWidth: '70%' }}>{g.key}</span>
                    <span className={g.share > SINGLE_BORROWER_LIMIT ? 'tone-danger' : undefined}>{inr(g.amount)}</span>
                  </div>
                  <Meter value={g.share * 100} tone={g.share > SINGLE_BORROWER_LIMIT ? 'danger' : undefined} label={g.key} />
                </div>
              ))}
            </Card>
          </div>

          <Card title="Active loans" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th className="right">Sanctioned</th>
                    <th className="right">Tenure</th>
                    <th className="right">Rate</th>
                    <th>Security</th>
                    <th>Sanctioned on</th>
                  </tr>
                </thead>
                <tbody>
                  {loans.map(l => (
                    <tr key={l.id} className="clickable">
                      <td>
                        <Link href={`/applications/${l.id}`} className="row-link cell-primary">{l.borrower.businessName}</Link>
                        <div className="cell-sub"><span className="mono">{l.applicationNo}</span> · {l.borrower.industry}{l.borrower.city ? ` · ${l.borrower.city}` : ''}</div>
                      </td>
                      <td className="right num strong">{inr(amountOf(l))}</td>
                      <td className="right num">{l.approval?.sanctionedTenure} mo</td>
                      <td className="right num">{l.approval?.interestRate}%</td>
                      <td>
                        {!l.collateral || l.collateral.collateralType === 'NONE'
                          ? <Badge>Unsecured</Badge>
                          : <Badge tone="success">{COLLATERAL_LABEL[l.collateral.collateralType]}</Badge>}
                      </td>
                      <td className="muted">{l.sanctionedAt ? date(l.sanctionedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  )
}
