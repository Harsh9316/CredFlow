import Link from 'next/link'
import { ArrowRight, BadgeCheck, Clock3, FileText, Plus, Scale, ShieldAlert, UserCheck } from 'lucide-react'
import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge } from '@/components/ui'
import { date, inr } from '@/lib/format'

export const metadata = { title: 'Overview' }

async function getOverview(nbfcId: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [total, last30, byStatus, sanctioned, decided, awaitingChecker, toReview, recent, recommendations] = await Promise.all([
    prisma.loanApplication.count({ where: { nbfcId } }),
    prisma.loanApplication.count({ where: { nbfcId, appliedAt: { gte: since } } }),
    prisma.loanApplication.groupBy({ by: ['status'], where: { nbfcId }, _count: { _all: true } }),
    prisma.approval.aggregate({
      where: { application: { nbfcId }, finalDecision: 'APPROVE', status: 'CONFIRMED' },
      _sum: { sanctionedAmount: true },
      _count: { _all: true },
    }),
    prisma.loanApplication.findMany({ where: { nbfcId, decidedAt: { not: null } }, select: { appliedAt: true, decidedAt: true } }),
    prisma.loanApplication.findMany({
      where: { nbfcId, status: 'PENDING_APPROVAL' },
      include: { borrower: { select: { businessName: true } }, approval: { select: { sanctionedAmount: true, user: { select: { name: true } } } } },
      orderBy: { updatedAt: 'asc' },
      take: 5,
    }),
    prisma.loanApplication.findMany({
      where: { nbfcId, status: { in: ['APPLIED', 'UNDER_REVIEW'] } },
      include: { borrower: { select: { businessName: true } }, creditDecision: { select: { decision: true, creditScore: true } } },
      orderBy: { appliedAt: 'asc' },
      take: 6,
    }),
    prisma.loanApplication.findMany({
      where: { nbfcId },
      include: {
        borrower: { select: { businessName: true, industry: true, city: true } },
        creditDecision: { select: { creditScore: true, decision: true } },
      },
      orderBy: { appliedAt: 'desc' },
      take: 8,
    }),
    prisma.creditDecision.groupBy({ by: ['decision'], where: { application: { nbfcId } }, _count: { _all: true } }),
  ])

  const count = (s: string) => byStatus.find(b => b.status === s)?._count._all ?? 0
  const approvedCount = count('SANCTIONED') + count('APPROVED')
  const rejectedCount = count('REJECTED')
  const decidedCount = approvedCount + rejectedCount
  const avgTat = decided.length
    ? decided.reduce((sum, a) => sum + (a.decidedAt!.getTime() - a.appliedAt.getTime()), 0) / decided.length / 86_400_000
    : null

  return {
    total,
    last30,
    inReview: count('APPLIED') + count('UNDER_REVIEW'),
    awaitingCount: count('PENDING_APPROVAL'),
    approvalRate: decidedCount ? Math.round((approvedCount / decidedCount) * 100) : null,
    decidedCount,
    sanctionedAmount: sanctioned._sum.sanctionedAmount ?? 0,
    sanctionedCount: sanctioned._count._all,
    avgTat,
    awaitingChecker,
    toReview,
    recent,
    recommendations: Object.fromEntries(recommendations.map(r => [r.decision, r._count._all])) as Record<string, number>,
  }
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default async function DashboardPage() {
  const session = await requirePageSession()
  const o = await getOverview(session.nbfcId)
  const recTotal = (o.recommendations.APPROVE ?? 0) + (o.recommendations.REFER ?? 0) + (o.recommendations.REJECT ?? 0)
  const queueEmpty = o.awaitingChecker.length === 0 && o.toReview.length === 0

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${session.name.split(' ')[0]}`}
        description={`Here's where ${session.nbfcName}'s credit pipeline stands today.`}
        actions={
          session.role !== 'VIEWER' && (
            <Link href="/applications/new" className="btn btn-primary"><Plus aria-hidden /> New application</Link>
          )
        }
      />

      <div className="stats">
        <Stat label="Applications" value={o.total} icon={<FileText />} hint={<><strong>{o.last30}</strong> in the last 30 days</>} />
        <Stat label="In review" value={o.inReview} icon={<Clock3 />} hint={o.avgTat !== null ? <>Avg. decision time <strong>{o.avgTat.toFixed(1)} days</strong></> : 'No decisions yet'} />
        <Stat
          label="Approval rate"
          value={o.approvalRate !== null ? `${o.approvalRate}%` : '—'}
          icon={<Scale />}
          hint={<>of <strong>{o.decidedCount}</strong> decided applications</>}
        />
        <Stat label="Sanctioned" value={inr(o.sanctionedAmount)} icon={<BadgeCheck />} hint={<>across <strong>{o.sanctionedCount}</strong> loans</>} />
      </div>

      <div className="split" style={{ '--rail': '360px' } as React.CSSProperties}>
        <Card
          title="Recent applications"
          actions={<Link href="/applications" className="btn btn-ghost btn-sm">View all <ArrowRight aria-hidden /></Link>}
          flush
        >
          {o.recent.length === 0 ? (
            <EmptyState icon={<FileText size={20} />} title="No applications yet" action={<Link href="/applications/new" className="btn btn-primary btn-sm"><Plus aria-hidden /> Create the first one</Link>}>
              Applications created here or through the API will show up in this list.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th className="right">Amount</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {o.recent.map(app => (
                    <tr key={app.id} className="clickable">
                      <td>
                        <Link href={`/applications/${app.id}`} className="row-link cell-primary">{app.borrower.businessName}</Link>
                        <div className="cell-sub">{app.applicationNo} · {app.borrower.industry}</div>
                      </td>
                      <td className="right num strong">{inr(app.requestedAmount)}</td>
                      <td className="num">
                        {app.creditDecision ? (
                          <span className={app.creditDecision.creditScore >= 70 ? 'tone-success strong' : app.creditDecision.creditScore >= 50 ? 'tone-warning strong' : 'tone-danger strong'}>
                            {app.creditDecision.creditScore}
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td><StatusBadge status={app.status} /></td>
                      <td className="muted">{date(app.appliedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card title="Needs attention" description="Oldest first" flush>
            {queueEmpty ? (
              <EmptyState icon={<BadgeCheck size={20} />} title="All caught up">Nothing is waiting for review or a checker.</EmptyState>
            ) : (
              <ul>
                {o.awaitingChecker.map(app => (
                  <li key={app.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <Link href={`/applications/${app.id}`} className="between" style={{ padding: '12px 20px' }}>
                      <span style={{ minWidth: 0 }}>
                        <span className="cell-primary" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.borrower.businessName}</span>
                        <span className="cell-sub">{inr(app.approval?.sanctionedAmount)} · submitted by {app.approval?.user.name}</span>
                      </span>
                      <Badge tone="accent"><UserCheck aria-hidden /> Check</Badge>
                    </Link>
                  </li>
                ))}
                {o.toReview.map(app => (
                  <li key={app.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <Link href={`/applications/${app.id}`} className="between" style={{ padding: '12px 20px' }}>
                      <span style={{ minWidth: 0 }}>
                        <span className="cell-primary" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.borrower.businessName}</span>
                        <span className="cell-sub">
                          {inr(app.requestedAmount)} · {app.creditDecision ? `scored ${app.creditDecision.creditScore}` : 'not yet evaluated'}
                        </span>
                      </span>
                      {app.creditDecision
                        ? <Badge tone="warning">Decide</Badge>
                        : <Badge tone="info">Evaluate</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {o.awaitingCount + o.inReview > o.awaitingChecker.length + o.toReview.length && (
              <div className="card-foot">
                <Link href="/applications?status=open" className="tone-accent strong">See all {o.awaitingCount + o.inReview} open applications</Link>
              </div>
            )}
          </Card>

          <Card title="Engine recommendations" description="All evaluated applications">
            {recTotal === 0 ? (
              <p className="muted small">No applications evaluated yet.</p>
            ) : (
              <>
                <div className="stacked-bar" role="img" aria-label="Share of approve, refer and reject recommendations">
                  {(['APPROVE', 'REFER', 'REJECT'] as const).map(k => (
                    <span key={k} style={{
                      width: `${((o.recommendations[k] ?? 0) / recTotal) * 100}%`,
                      background: k === 'APPROVE' ? 'var(--success)' : k === 'REFER' ? 'var(--warning)' : 'var(--danger)',
                    }} />
                  ))}
                </div>
                <div className="legend">
                  {([['APPROVE', 'Approve', 'var(--success)'], ['REFER', 'Refer', 'var(--warning)'], ['REJECT', 'Reject', 'var(--danger)']] as const).map(([k, label, color]) => (
                    <div key={k} className="legend-row">
                      <span className="legend-swatch" style={{ background: color }} />
                      <span>{label}</span>
                      <span className="num strong">{o.recommendations[k] ?? 0}</span>
                      <span className="num muted" style={{ width: 40, textAlign: 'right' }}>{Math.round(((o.recommendations[k] ?? 0) / recTotal) * 100)}%</span>
                    </div>
                  ))}
                </div>
                {(o.recommendations.REJECT ?? 0) > 0 && (
                  <p className="small muted mt-4 row"><ShieldAlert size={14} aria-hidden /> Includes fraud hard-stops.</p>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
