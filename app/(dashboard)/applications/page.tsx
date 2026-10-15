import prisma from '@/lib/db'
import Link from 'next/link'
import { requirePageSession } from '@/lib/auth'

async function getApplications(nbfcId: string) {
  return prisma.loanApplication.findMany({
    where: { nbfcId },
    orderBy: { appliedAt: 'desc' },
    include: {
      borrower: {
        select: { businessName: true, industry: true, city: true }
      },
      creditDecision: {
        select: { creditScore: true, decision: true }
      },
      collateral: {
        select: { collateralType: true }
      }
    }
  })
}

function formatAmount(amount: number): string {
  if (amount >= 10000000) {
    return `₹${(amount / 10000000).toFixed(2)}Cr`
  } else if (amount >= 100000) {
    return `₹${(amount / 100000).toFixed(1)}L`
  }
  return `₹${amount.toLocaleString()}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
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

function getSecurityType(collateralType: string | null | undefined) {
  if (!collateralType || collateralType === 'NONE') {
    return <span className="badge badge-gray">Unsecured</span>
  }
  if (collateralType === 'INVOICE') {
    return <span className="badge badge-primary">Invoice-backed</span>
  }
  return <span className="badge badge-success">Secured</span>
}

export default async function ApplicationsPage() {
  const session = await requirePageSession()
  const applications = await getApplications(session.nbfcId)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Loan Applications</h1>
          <p className="page-subtitle">Manage and review SME loan applications</p>
        </div>
        <div className="page-actions">
          <Link href="/applications/new" className="btn btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 18, height: 18}}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Application
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="table-container" style={{border: 'none'}}>
          <table>
            <thead>
              <tr>
                <th>Application No</th>
                <th>Borrower</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Amount</th>
                <th>Tenure</th>
                <th>Security</th>
                <th>Score</th>
                <th>Status</th>
                <th>Applied</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {applications.map((app) => (
                <tr key={app.id}>
                  <td style={{fontWeight: 500, color: 'var(--text-primary)'}}>{app.applicationNo}</td>
                  <td>{app.borrower.businessName}</td>
                  <td>{app.borrower.industry}</td>
                  <td>{app.borrower.city}</td>
                  <td style={{fontFamily: 'var(--font-mono)'}}>{formatAmount(app.requestedAmount)}</td>
                  <td>{app.requestedTenure} mo</td>
                  <td>{getSecurityType(app.collateral?.collateralType)}</td>
                  <td>
                    {app.creditDecision ? (
                      <span style={{
                        fontWeight: 600,
                        color: app.creditDecision.creditScore >= 70 ? 'var(--accent-green)' :
                               app.creditDecision.creditScore >= 50 ? 'var(--accent-yellow)' :
                               'var(--accent-red)'
                      }}>
                        {app.creditDecision.creditScore}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>{getStatusBadge(app.status)}</td>
                  <td>{formatDate(app.appliedAt)}</td>
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
