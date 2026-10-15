// Display formatting shared by every page.

const lakh = 1_00_000
const crore = 1_00_00_000

/** ₹ amount in Indian shorthand: ₹85,000 · ₹25.0 L · ₹1.60 Cr */
export function inr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  const sign = amount < 0 ? '−' : ''
  const a = Math.abs(amount)
  if (a >= crore) return `${sign}₹${(a / crore).toFixed(2)} Cr`
  if (a >= lakh) return `${sign}₹${(a / lakh).toFixed(1)} L`
  return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`
}

/** ₹ amount in full Indian grouping: ₹25,00,000 */
export function inrFull(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—'
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

export function date(d: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))
}

export function dateTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d))
}

export function vintage(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  return m ? `${y} yr ${m} mo` : `${y} yr`
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(n => n[0]!.toUpperCase()).join('')

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

export const APPLICATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  APPLIED: { label: 'Applied', tone: 'info' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warning' },
  PENDING_APPROVAL: { label: 'Awaiting checker', tone: 'accent' },
  PENDING_DOCS: { label: 'Pending docs', tone: 'neutral' },
  APPROVED: { label: 'Approved', tone: 'success' },
  SANCTIONED: { label: 'Sanctioned', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'neutral' },
}

export const DECISION: Record<string, { label: string; tone: Tone }> = {
  APPROVE: { label: 'Approve', tone: 'success' },
  REFER: { label: 'Refer', tone: 'warning' },
  REJECT: { label: 'Reject', tone: 'danger' },
}

export const COLLATERAL_LABEL: Record<string, string> = {
  LAP: 'Property (LAP)',
  MACHINERY: 'Machinery',
  INVOICE: 'Invoices',
  STOCK: 'Stock / inventory',
  FD: 'Fixed deposit',
  NONE: 'Unsecured',
}

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'NBFC admin',
  ANALYST: 'Credit analyst',
  VIEWER: 'Viewer',
}

/** Score colour band; thresholds default to the standard 70 / 50. */
export function scoreTone(score: number, approve = 70, refer = 50): Tone {
  return score >= approve ? 'success' : score >= refer ? 'warning' : 'danger'
}
