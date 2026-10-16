// Credrail UI kit. Server-compatible presentational components; styling lives in app/globals.css.

import Link from 'next/link'
import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, Info } from 'lucide-react'
import { APPLICATION_STATUS, DECISION, type Tone } from '@/lib/format'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export function PageHeader({ title, description, actions, back, badge }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { href: string; label: string }
  badge?: ReactNode
}) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        {back && (
          <Link href={back.href} className="back-link">
            <ArrowLeft aria-hidden /> {back.label}
          </Link>
        )}
        <div className="page-title-row">
          <h1 className="page-title">{title}</h1>
          {badge}
        </div>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, description, actions, children, className, bodyClassName, flush, footer, id }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  /** No body padding (for tables and lists that run edge to edge) */
  flush?: boolean
  footer?: ReactNode
  id?: string
}) {
  return (
    <section className={cx('card', className)} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <div className="card-head">
          <div style={{ minWidth: 0 }}>
            {title && <h2 className="card-title">{title}</h2>}
            {description && <p className="card-desc">{description}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className={cx('card-body', bodyClassName)}>{children}</div>}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  )
}

export function Badge({ tone = 'neutral', dot, size, children, title }: {
  tone?: Tone
  dot?: boolean
  size?: 'lg'
  children: ReactNode
  title?: string
}) {
  return (
    <span className={cx('badge', tone !== 'neutral' && `badge-${tone}`, dot && 'badge-dot', size === 'lg' && 'badge-lg')} title={title}>
      {children}
    </span>
  )
}

export function StatusBadge({ status, size }: { status: string; size?: 'lg' }) {
  const s = APPLICATION_STATUS[status] ?? { label: status, tone: 'neutral' as Tone }
  return <Badge tone={s.tone} dot size={size}>{s.label}</Badge>
}

export function DecisionBadge({ decision, size }: { decision: string; size?: 'lg' }) {
  const d = DECISION[decision] ?? { label: decision, tone: 'neutral' as Tone }
  return <Badge tone={d.tone} size={size}>{d.label}</Badge>
}

export function Stat({ label, value, hint, icon }: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon" aria-hidden>{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

const ALERT_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: AlertCircle }

export function Alert({ tone = 'info', title, children, className }: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const Icon = ALERT_ICON[tone]
  return (
    <div className={cx('alert', `alert-${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div>
        {title && <div className="alert-title">{title}</div>}
        {children && <div>{children}</div>}
      </div>
    </div>
  )
}

export function Meter({ value, max = 100, tone, label }: { value: number; max?: number; tone?: 'success' | 'warning' | 'danger'; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={cx('meter', tone)} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ScoreRing({ score, tone, label = 'of 100' }: { score: number; tone: Tone; label?: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  const color = tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : tone === 'danger' ? 'var(--danger)' : 'var(--accent)'
  return (
    <div className="score-ring" role="img" aria-label={`Credit score ${score} out of 100`}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle className="track" cx="50" cy="50" r={r} />
        <circle className="value" cx="50" cy="50" r={r} stroke={color} strokeDasharray={`${(Math.max(0, Math.min(100, score)) / 100) * c} ${c}`} />
      </svg>
      <div className="score-ring-label">
        <strong>{score}</strong>
        <span>{label}</span>
      </div>
    </div>
  )
}
