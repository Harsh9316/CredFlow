import prisma from '@/lib/db'
import Link from 'next/link'
import { requirePageSession } from '@/lib/auth'

async function getDashboardStats(nbfcId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [
    totalApplications,
    todayApplications,
    approvedCount,
    rejectedCount,
    underReviewCount,
    sanctionedCount,
    recentApplications
  ] = await Promise.all([
    prisma.loanApplication.count({ where: { nbfcId } }),
    prisma.loanApplication.count({
      where: { nbfcId, appliedAt: { gte: today } }
    }),
    prisma.loanApplication.count({
      where: { nbfcId, status: { in: ['APPROVED', 'SANCTIONED'] } }
    }),
    prisma.loanApplication.count({
      where: { nbfcId, status: 'REJECTED' }
    }),
    prisma.loanApplication.count({
      where: { nbfcId, status: 'UNDER_REVIEW' }
    }),
    prisma.loanApplication.count({
      where: { nbfcId, status: 'SANCTIONED' }
    }),
    prisma.loanApplication.findMany({
      where: { nbfcId },
      take: 10,
      orderBy: { appliedAt: 'desc' },
      include: {
        borrower: {
          select: { businessName: true, industry: true }
        }
      }
    })
  ])

  // Calculate approval rate
  const decidedApplications = approvedCount + rejectedCount
  const approvalRate = decidedApplications > 0 
    ? Math.round((approvedCount / decidedApplications) * 100) 
    : 0

  // Calculate average TAT (days from applied to decided)
  const decidedApps = await prisma.loanApplication.findMany({
    where: { nbfcId, decidedAt: { not: null } },
    select: { appliedAt: true, decidedAt: true }
  })

  let avgTAT = 0
  if (decidedApps.length > 0) {
    const totalDays = decidedApps.reduce((sum, app) => {
      const days = Math.ceil((app.decidedAt!.getTime() - app.appliedAt.getTime()) / (1000 * 60 * 60 * 24))
      return sum + days
    }, 0)
    avgTAT = Math.round(totalDays / decidedApps.length)
  }

  return {
    totalApplications,
    todayApplications,
    approvedCount,
    rejectedCount,
    underReviewCount,
    sanctionedCount,
    approvalRate,
    avgTAT,
    recentApplications
  }
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
    PENDING_APPROVAL: { class: 'badge-warning', label: 'Awaiting Checker' },
    APPROVED: { class: 'badge-success', label: 'Approved' },
    REJECTED: { class: 'badge-danger', label: 'Rejected' },
    SANCTIONED: { class: 'badge-purple', label: 'Sanctioned' },
    WITHDRAWN: { class: 'badge-gray', label: 'Withdrawn' }
  }
  const config = statusConfig[status] || { class: 'badge-gray', label: status }
  return <span className={`badge ${config.class}`}>{config.label}</span>
}

function getPriorityBadge(priority: string) {
  if (priority === 'URGENT') return <span className="badge badge-danger">Urgent</span>
  if (priority === 'HIGH') return <span className="badge badge-warning">High</span>
  return null
}

export default async function DashboardPage() {
  const session = await requirePageSession()
  const stats = await getDashboardStats(session.nbfcId)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of your credit underwriting operations</p>
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

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="stat-value">{stats.totalApplications}</div>
          <div className="stat-label">Total Applications</div>
          <div className="stat-change positive">+{stats.todayApplications} today</div>
        </div>

        <div className="stat-card success">
          <div className="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="stat-value">{stats.approvedCount}</div>
          <div className="stat-label">Approved / Sanctioned</div>
          <div className="stat-change positive">{stats.approvalRate}% approval rate</div>
        </div>

        <div className="stat-card warning">
          <div className="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="stat-value">{stats.underReviewCount}</div>
          <div className="stat-label">Under Review</div>
          <div className="stat-change positive">Avg TAT: {stats.avgTAT} days</div>
        </div>

        <div className="stat-card danger">
          <div className="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="stat-value">{stats.rejectedCount}</div>
          <div className="stat-label">Rejected</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Recent Applications</h3>
          <Link href="/applications" className="btn btn-ghost btn-sm">
            View All
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 14, height: 14}}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
        <div className="table-container" style={{border: 'none'}}>
          <table>
            <thead>
              <tr>
                <th>Application No</th>
                <th>Borrower</th>
                <th>Industry</th>
                <th>Amount</th>
                <th>Tenure</th>
                <th>Applied On</th>
                <th>Status</th>
                <th>Priority</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stats.recentApplications.map((app) => (
                <tr key={app.id}>
                  <td style={{fontWeight: 500, color: 'var(--text-primary)'}}>{app.applicationNo}</td>
                  <td>{app.borrower.businessName}</td>
                  <td>{app.borrower.industry}</td>
                  <td style={{fontFamily: 'var(--font-mono)'}}>{formatAmount(app.requestedAmount)}</td>
                  <td>{app.requestedTenure} mo</td>
                  <td>{formatDate(app.appliedAt)}</td>
                  <td>{getStatusBadge(app.status)}</td>
                  <td>{getPriorityBadge(app.priority)}</td>
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
