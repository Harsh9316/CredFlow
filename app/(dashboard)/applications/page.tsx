import Link from 'next/link'
import { FileText, Plus, Search } from 'lucide-react'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import { Badge, Card, DecisionBadge, EmptyState, PageHeader, StatusBadge } from '@/components/ui'
import { COLLATERAL_LABEL, date, inr } from '@/lib/format'

export const metadata = { title: 'Applications' }

const TABS = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'open', label: 'In review', statuses: ['APPLIED', 'UNDER_REVIEW'] },
  { key: 'checker', label: 'Awaiting checker', statuses: ['PENDING_APPROVAL'] },
  { key: 'sanctioned', label: 'Sanctioned', statuses: ['SANCTIONED', 'APPROVED'] },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
] as const

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const session = await requirePageSession()
  const params = await searchParams
  const tab = TABS.find(t => t.key === params.status) ?? TABS[0]
  const q = params.q?.trim() ?? ''

  const search: Prisma.LoanApplicationWhereInput = q
    ? {
        OR: [
          { applicationNo: { contains: q, mode: 'insensitive' } },
          { borrower: { businessName: { contains: q, mode: 'insensitive' } } },
          { borrower: { pan: { contains: q.toUpperCase() } } },
          { sourceReference: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {}

  const [applications, statusCounts] = await Promise.all([
    prisma.loanApplication.findMany({
      where: { nbfcId: session.nbfcId, ...(tab.statuses && { status: { in: [...tab.statuses] } }), ...search },
      orderBy: { appliedAt: 'desc' },
      take: 200,
      include: {
        borrower: { select: { businessName: true, industry: true, city: true } },
        creditDecision: { select: { creditScore: true, decision: true } },
        collateral: { select: { collateralType: true } },
      },
    }),
    prisma.loanApplication.groupBy({ by: ['status'], where: { nbfcId: session.nbfcId, ...search }, _count: { _all: true } }),
  ])

  const countFor = (statuses: readonly string[] | null) =>
    statusCounts.filter(s => !statuses || statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0)
  const href = (key: string) => {
    const sp = new URLSearchParams()
    if (key !== 'all') sp.set('status', key)
    if (q) sp.set('q', q)
    const s = sp.toString()
    return `/applications${s ? `?${s}` : ''}`
  }

  return (
    <>
      <PageHeader
        title="Applications"
        description="Every loan application for your NBFC, from the dashboard and the API."
        actions={session.role !== 'VIEWER' && <Link href="/applications/new" className="btn btn-primary"><Plus aria-hidden /> New application</Link>}
      />

      <Card flush>
        <nav className="tabs" aria-label="Filter by status">
          {TABS.map(t => (
            <Link key={t.key} href={href(t.key)} className={`tab${t.key === tab.key ? ' active' : ''}`} aria-current={t.key === tab.key ? 'page' : undefined}>
              {t.label}
              <span className="tab-count">{countFor(t.statuses)}</span>
            </Link>
          ))}
        </nav>
        <form className="toolbar" role="search" action="/applications">
          {tab.key !== 'all' && <input type="hidden" name="status" value={tab.key} />}
          <label className="search">
            <Search aria-hidden />
            <span className="sr-only">Search applications</span>
            <input className="input" type="search" name="q" defaultValue={q} placeholder="Search borrower, application no, PAN or reference" />
          </label>
          {q && <Link href={tab.key === 'all' ? '/applications' : `/applications?status=${tab.key}`} className="btn btn-ghost btn-sm">Clear</Link>}
          <span className="muted small" style={{ marginLeft: 'auto' }}>{applications.length} shown</span>
        </form>

        {applications.length === 0 ? (
          <EmptyState icon={<FileText size={20} />} title={q ? 'No matching applications' : 'Nothing here yet'}>
            {q ? 'Try a different search, or another status tab.' : 'Applications in this state will appear here.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Borrower</th>
                  <th className="right">Amount</th>
                  <th className="right">Tenure</th>
                  <th>Security</th>
                  <th className="right">Score</th>
                  <th>Recommendation</th>
                  <th>Status</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {applications.map(app => {
                  const security = app.collateral?.collateralType ?? 'NONE'
                  return (
                    <tr key={app.id} className="clickable">
                      <td>
                        <Link href={`/applications/${app.id}`} className="row-link cell-primary cell-truncate" style={{ display: 'block' }}>
                          {app.borrower.businessName}
                        </Link>
                        <div className="cell-sub">
                          <span className="mono">{app.applicationNo}</span> · {app.borrower.industry}{app.borrower.city ? ` · ${app.borrower.city}` : ''}
                        </div>
                      </td>
                      <td className="right num strong">{inr(app.requestedAmount)}</td>
                      <td className="right num">{app.requestedTenure} mo</td>
                      <td>{security === 'NONE' ? <span className="muted">Unsecured</span> : COLLATERAL_LABEL[security]}</td>
                      <td className="right num">
                        {app.creditDecision ? (
                          <span className={`strong ${app.creditDecision.creditScore >= 70 ? 'tone-success' : app.creditDecision.creditScore >= 50 ? 'tone-warning' : 'tone-danger'}`}>
                            {app.creditDecision.creditScore}
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>{app.creditDecision ? <DecisionBadge decision={app.creditDecision.decision} /> : <Badge>Not evaluated</Badge>}</td>
                      <td><StatusBadge status={app.status} /></td>
                      <td className="muted">{date(app.appliedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
