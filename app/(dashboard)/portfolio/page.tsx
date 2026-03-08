import prisma from '@/lib/db'
import Link from 'next/link'

async function getPortfolioStats() {
  const [
    sanctionedApps,
    totalSanctionedAmount,
    borrowersWithLoans,
    collateralBreakdown,
    industryBreakdown
  ] = await Promise.all([
    prisma.loanApplication.count({
      where: { status: 'SANCTIONED' }
    }),
    prisma.approval.aggregate({
      _sum: { sanctionedAmount: true },
      where: { finalDecision: 'APPROVE' }
    }),
    prisma.borrower.count({
      where: {
        loanApplications: {
          some: { status: 'SANCTIONED' }
        }
      }
    }),
    prisma.collateral.groupBy({
      by: ['collateralType'],
      _count: { id: true },
      _sum: { assessedValue: true }
    }),
    prisma.loanApplication.findMany({
      where: { status: 'SANCTIONED' },
      include: {
        borrower: { select: { industry: true } },
        approval: { select: { sanctionedAmount: true } }
      }
    })
  ])

  // Calculate industry breakdown
  const industryMap = new Map<string, { count: number; amount: number }>()
  industryBreakdown?.forEach((app) => {
    const industry = app.borrower.industry
    const existing = industryMap.get(industry) || { count: 0, amount: 0 }
    industryMap.set(industry, {
      count: existing.count + 1,
      amount: existing.amount + (app.approval?.sanctionedAmount || 0)
    })
  })

  // Get sanctioned applications with details
  const sanctionedApplications = await prisma.loanApplication.findMany({
    where: { status: 'SANCTIONED' },
    include: {
      borrower: { select: { businessName: true, industry: true, city: true } },
      collateral: { select: { collateralType: true } },
      approval: { select: { sanctionedAmount: true, interestRate: true, sanctionedTenure: true } }
    },
    orderBy: { sanctionedAt: 'desc' }
  })

  // ── Risk Governance: Top Borrower Exposure ──
  const borrowerExposure = new Map<string, { name: string; totalAmount: number; loanCount: number }>()
  sanctionedApplications.forEach((app) => {
    const bName = app.borrower.businessName
    const existing = borrowerExposure.get(bName) || { name: bName, totalAmount: 0, loanCount: 0 }
    borrowerExposure.set(bName, {
      name: bName,
      totalAmount: existing.totalAmount + (app.approval?.sanctionedAmount || 0),
      loanCount: existing.loanCount + 1
    })
  })
  const topBorrowers = Array.from(borrowerExposure.values())
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10)

  // ── Risk Governance: Secured vs Unsecured Ratio ──
  const totalSanctionedCount = sanctionedApplications.length
  const securedCount = sanctionedApplications.filter(a => a.collateral && a.collateral.collateralType !== 'NONE').length
  const unsecuredCount = totalSanctionedCount - securedCount
  const securedPct = totalSanctionedCount > 0 ? Math.round((securedCount / totalSanctionedCount) * 100) : 0
  const unsecuredPct = 100 - securedPct

  // ── Risk Governance: Industry Concentration Warnings ──
  const totalAmountNum = (totalSanctionedAmount._sum.sanctionedAmount || 0)
  const concentrationWarnings = Array.from(industryMap.entries())
    .filter(([, data]) => totalAmountNum > 0 && (data.amount / totalAmountNum) > 0.35)
    .map(([industry, data]) => ({
      industry,
      pct: Math.round((data.amount / totalAmountNum) * 100)
    }))

  return {
    totalLoans: sanctionedApps,
    totalAmount: totalAmountNum,
    activeBorrowers: borrowersWithLoans,
    collateralBreakdown,
    industryBreakdown: Array.from(industryMap.entries()).map(([industry, data]) => ({
      industry,
      ...data
    })),
    sanctionedApplications,
    topBorrowers,
    securedPct,
    unsecuredPct,
    securedCount,
    unsecuredCount,
    concentrationWarnings
  }
}

function formatAmount(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)} Cr`
  } else if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(1)} L`
  }
  return `₹${amount.toLocaleString()}`
}

function getCollateralTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    LAP: 'Property',
    MACHINERY: 'Machinery',
    INVOICE: 'Invoice',
    STOCK: 'Stock/Inventory',
    FD: 'Fixed Deposit',
    NONE: 'Unsecured'
  }
  return labels[type] || type
}

function getSecurityBadge(collateralType: string | null | undefined) {
  if (!collateralType || collateralType === 'NONE') {
    return <span className="badge badge-gray">Unsecured</span>
  }
  if (collateralType === 'INVOICE') {
    return <span className="badge badge-primary">Invoice-backed</span>
  }
  return <span className="badge badge-success">Secured</span>
}

export default async function PortfolioPage() {
  const stats = await getPortfolioStats()

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Portfolio</h1>
          <p className="page-subtitle">View sanctioned loans and portfolio health</p>
        </div>
      </div>

      {/* Portfolio Summary */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Portfolio Summary</h3>
        </div>
        <div className="portfolio-summary">
          <div className="portfolio-stat">
            <div className="portfolio-stat-value">{stats.totalLoans}</div>
            <div className="portfolio-stat-label">Active Loans</div>
          </div>
          <div className="portfolio-stat">
            <div className="portfolio-stat-value" style={{color: 'var(--accent-green)'}}>{formatAmount(stats.totalAmount)}</div>
            <div className="portfolio-stat-label">Total Sanctioned</div>
          </div>
          <div className="portfolio-stat">
            <div className="portfolio-stat-value">{stats.activeBorrowers}</div>
            <div className="portfolio-stat-label">Active Borrowers</div>
          </div>
          <div className="portfolio-stat">
            <div className="portfolio-stat-value">{stats.collateralBreakdown.filter(c => c.collateralType !== 'NONE' && c.collateralType !== 'INVOICE').length > 0 ? 
              Math.round((stats.collateralBreakdown.filter(c => c.collateralType !== 'NONE' && c.collateralType !== 'INVOICE').reduce((acc, c) => acc + c._count.id, 0) / stats.totalLoans) * 100) : 0}%</div>
            <div className="portfolio-stat-label">Secured</div>
          </div>
          <div className="portfolio-stat">
            <div className="portfolio-stat-value">{stats.totalLoans > 0 ? formatAmount(stats.totalAmount / stats.totalLoans) : '₹0'}</div>
            <div className="portfolio-stat-label">Avg Loan Size</div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Collateral Breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Security Classification</h3>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-4)'}}>
            {stats.collateralBreakdown.map((item, i) => (
              <div key={i} style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-3)', background: 'var(--bg-glass)', borderRadius: 'var(--radius-md)'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-3)'}}>
                  <div style={{
                    width: 8, 
                    height: 8, 
                    borderRadius: '50%', 
                    background: item.collateralType === 'LAP' ? 'var(--accent-green)' :
                               item.collateralType === 'MACHINERY' ? 'var(--primary-400)' :
                               item.collateralType === 'INVOICE' ? 'var(--accent-purple)' :
                               item.collateralType === 'STOCK' ? 'var(--accent-yellow)' :
                               'var(--gray-400)'
                  }}></div>
                  <span>{getCollateralTypeLabel(item.collateralType)}</span>
                </div>
                <div style={{display: 'flex', alignItems: 'center', gap: 'var(--space-4)'}}>
                  <span className="text-muted">{item._count.id} loans</span>
                  <span style={{fontWeight: 600}}>{formatAmount(item._sum.assessedValue || 0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Industry Breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Industry Exposure</h3>
          </div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-4)'}}>
            {stats.industryBreakdown.sort((a, b) => b.amount - a.amount).map((item, i) => (
              <div key={i}>
                <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)'}}>
                  <span>{item.industry}</span>
                  <span style={{fontWeight: 600}}>{formatAmount(item.amount)}</span>
                </div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{width: `${(item.amount / stats.totalAmount) * 100}%`}}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Risk Governance */}
      <div className="card" style={{marginTop: 'var(--space-6)'}}>
        <div className="card-header">
          <h3 className="card-title">Risk Governance</h3>
          <span className="badge badge-primary">Concentration Metrics</span>
        </div>

        {/* Alerts */}
        {stats.concentrationWarnings.length > 0 && (
          <div style={{marginBottom: 'var(--space-4)'}}>
            {stats.concentrationWarnings.map((w, i) => (
              <div key={i} className="alert alert-warning" style={{marginBottom: 'var(--space-2)'}}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span><strong>{w.industry}</strong> concentration at {w.pct}% of total portfolio — exceeds 35% threshold</span>
              </div>
            ))}
          </div>
        )}

        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-6)'}}>
          {/* Secured vs Unsecured */}
          <div>
            <div className="text-xs text-muted mb-4" style={{textTransform: 'uppercase', letterSpacing: '0.05em'}}>Security Ratio</div>
            <div style={{display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-3)'}}>
              <div style={{flex: 1}}>
                <div style={{fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-green)'}}>{stats.securedPct}%</div>
                <div className="text-xs text-muted">Secured ({stats.securedCount} loans)</div>
              </div>
              <div style={{flex: 1}}>
                <div style={{fontSize: '1.5rem', fontWeight: 700, color: stats.unsecuredPct > 60 ? 'var(--accent-red)' : 'var(--accent-yellow)'}}>{stats.unsecuredPct}%</div>
                <div className="text-xs text-muted">Unsecured ({stats.unsecuredCount} loans)</div>
              </div>
            </div>
            <div className="progress-bar" style={{height: 8}}>
              <div className="progress-fill" style={{width: `${stats.securedPct}%`, background: 'var(--accent-green)'}}></div>
            </div>
          </div>

          {/* Industry Exposure % */}
          <div>
            <div className="text-xs text-muted mb-4" style={{textTransform: 'uppercase', letterSpacing: '0.05em'}}>Industry Exposure %</div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-2)'}}>
              {stats.industryBreakdown.sort((a, b) => b.amount - a.amount).slice(0, 5).map((item, i) => {
                const pct = stats.totalAmount > 0 ? Math.round((item.amount / stats.totalAmount) * 100) : 0
                return (
                  <div key={i} style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem'}}>
                    <span>{item.industry}</span>
                    <span style={{fontWeight: 600, color: pct > 35 ? 'var(--accent-red)' : 'var(--text-primary)'}}>{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Top Borrower Exposure */}
          <div>
            <div className="text-xs text-muted mb-4" style={{textTransform: 'uppercase', letterSpacing: '0.05em'}}>Top Borrower Exposure</div>
            <div style={{display: 'flex', flexDirection: 'column', gap: 'var(--space-2)'}}>
              {stats.topBorrowers.slice(0, 5).map((b, i) => {
                const pct = stats.totalAmount > 0 ? Math.round((b.totalAmount / stats.totalAmount) * 100) : 0
                return (
                  <div key={i} style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem'}}>
                    <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%'}}>{b.name}</span>
                    <span style={{fontWeight: 600, color: pct > 25 ? 'var(--accent-red)' : 'var(--text-primary)'}}>{pct}% ({formatAmount(b.totalAmount)})</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Sanctioned Loans Table */}
      <div className="card" style={{marginTop: 'var(--space-6)'}}>
        <div className="card-header">
          <h3 className="card-title">Active Loans</h3>
        </div>
        <div className="table-container" style={{border: 'none'}}>
          <table>
            <thead>
              <tr>
                <th>Application No</th>
                <th>Borrower</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Sanctioned Amount</th>
                <th>Tenure</th>
                <th>Interest Rate</th>
                <th>Security</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stats.sanctionedApplications.map((app) => (
                <tr key={app.id}>
                  <td style={{fontWeight: 500, color: 'var(--text-primary)'}}>{app.applicationNo}</td>
                  <td>{app.borrower.businessName}</td>
                  <td>{app.borrower.industry}</td>
                  <td>{app.borrower.city}</td>
                  <td style={{fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-green)'}}>{formatAmount(app.approval?.sanctionedAmount || 0)}</td>
                  <td>{app.approval?.sanctionedTenure} mo</td>
                  <td>{app.approval?.interestRate}% p.a.</td>
                  <td>{getSecurityBadge(app.collateral?.collateralType)}</td>
                  <td>
                    <Link href={`/applications/${app.id}`} className="btn btn-ghost btn-sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
