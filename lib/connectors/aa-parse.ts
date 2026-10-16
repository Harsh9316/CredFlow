// Parsers for Account Aggregator FI data in the ReBIT formats (deposit v1.x / v2.0.0, gstr1_3b v1.x),
// and the bank-statement and GST metrics derived from them. Pure functions: no I/O.
//
// Only derived figures leave this module; raw transactions are not stored (data minimisation).

import type { MonthlyFlow } from '@credrail/engine'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const asArray = <T,>(v: T | T[] | null | undefined): T[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v])
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

// ───────────── Shapes ─────────────

export type DepositTxn = { type: 'CREDIT' | 'DEBIT'; amount: number; date: string; narration: string; mode: string }

export type DepositAccount = {
  kind: 'deposit'
  maskedAccNumber: string
  accountType: string
  holderNames: string[]
  holderPans: string[]
  currentBalance: number | null
  transactions: DepositTxn[]
}

export type GstPeriod = { month: string; turnover: number; filedOn: string | null; status: string }

export type GstAccount = {
  kind: 'gst'
  maskedGstin: string
  legalName: string
  registrationStatus: string
  periods: GstPeriod[]
}

export type ParsedFi = DepositAccount | GstAccount | { kind: 'unknown'; type: string }

// ───────────── Parsing ─────────────

/** Unwraps `{account: …}` / `{Account: …}` envelopes and dispatches on the FI type. */
export function parseFi(data: unknown, maskedAccNumber = ''): ParsedFi {
  if (!isObj(data)) return { kind: 'unknown', type: 'empty' }
  const acc = isObj(data.account) ? data.account : isObj(data.Account) ? data.Account : data
  const type = str(acc.type).toLowerCase()
  if (type === 'deposit') return parseDeposit(acc, maskedAccNumber)
  if (type === 'gstr1_3b') return parseGst(acc)
  return { kind: 'unknown', type: type || 'missing' }
}

function isoDate(v: unknown): string {
  const s = str(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})/)
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : ''
}

export function parseDeposit(acc: Obj, maskedAccNumber = ''): DepositAccount {
  const profile = isObj(acc.profile) ? acc.profile : {}
  const holdersBlock = isObj(profile.holders) ? profile.holders : {}
  const holders = asArray(holdersBlock.holder as Obj | Obj[]).filter(isObj)
  const summary = isObj(acc.summary) ? acc.summary : {}
  const txBlock = isObj(acc.transactions) ? acc.transactions : {}

  const transactions: DepositTxn[] = asArray(txBlock.transaction as Obj | Obj[])
    .filter(isObj)
    .map(t => ({
      type: str(t.type).toUpperCase() === 'CREDIT' ? ('CREDIT' as const) : ('DEBIT' as const),
      amount: Math.abs(num(t.amount)),
      date: isoDate(t.valueDate) || isoDate(t.transactionTimestamp),
      narration: str(t.narration),
      mode: str(t.mode),
    }))
    .filter(t => t.amount > 0 && t.date)

  return {
    kind: 'deposit',
    maskedAccNumber: str(acc.maskedAccNumber ?? acc.masked_account_number) || maskedAccNumber,
    // v1.x uses summary.type, v2.0.0 uses summary.accountSubType
    accountType: str(summary.accountSubType ?? summary.type).toUpperCase(),
    holderNames: holders.map(h => str(h.name)).filter(Boolean),
    holderPans: holders.map(h => str(h.pan).toUpperCase()).filter(Boolean),
    currentBalance: summary.currentBalance === undefined ? null : num(summary.currentBalance),
    transactions,
  }
}

const sumTxval = (...blocks: unknown[]) => blocks.reduce<number>((s, b) => s + (isObj(b) ? num(b.txval) : 0), 0)

export function parseGst(acc: Obj): GstAccount {
  const profile = isObj(acc.Profile) ? acc.Profile : {}
  const business = isObj(profile.BusinessDetails) ? profile.BusinessDetails : {}
  const txns = isObj(acc.Transactions) ? acc.Transactions : {}
  const g3b = isObj(txns.Gstr3bDetails) ? txns.Gstr3bDetails : {}

  const periods: GstPeriod[] = asArray(g3b.gstr3b as Obj | Obj[])
    .filter(isObj)
    .map(r => {
      const p = str(r.ret_prd) // MMYYYY
      const sup = isObj(r.sup_details) ? r.sup_details : {}
      return {
        month: /^\d{6}$/.test(p) ? `${p.slice(2)}-${p.slice(0, 2)}` : '',
        // Outward supplies: taxable + zero-rated + nil/exempt + non-GST
        turnover: sumTxval(sup.osup_det, sup.osup_zero, sup.osup_nil_exmp, sup.osup_nongst),
        filedOn: str(r.dof) || null,
        status: str(r.status).toUpperCase(),
      }
    })
    .filter(p => p.month)

  return {
    kind: 'gst',
    maskedGstin: str(acc.maskedGstinNumber),
    legalName: str(business.lgnm),
    registrationStatus: str(business.sts),
    periods,
  }
}

// ───────────── Bank metrics ─────────────

// Narrations that mark a returned or bounced payment (cheque, ECS/NACH mandate, inward return)
const BOUNCE = /\b(RTN|RETURN(ED)?|BOUNCE[DS]?|DISHONOU?RED|INSUFF(ICIENT)?\s*(FUNDS|BAL)|CHQ\s*RET|ECS\s*RTN|NACH\s*(RTN|RETURN|FAIL))\b/i

export type BankMetrics = {
  monthly: MonthlyFlow[]
  months: number
  avgMonthlyInflow: number
  avgMonthlyOutflow: number
  inflowVolatility: number
  totalCredits: number
  totalDebits: number
  accounts: number
  /** Matched credit/debit pairs between the borrower's own linked accounts, excluded from flows. */
  internalTransfersExcluded: number
  /** Entries whose narration marks a returned or bounced payment. */
  bounceCount: number
  /** True when fewer than 3 complete months were available, so partial months were kept. */
  partialMonthsIncluded: boolean
  holderPans: string[]
}

const monthKey = (d: string) => d.slice(0, 7)

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7))
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m === 13) { m = 1; y++ }
  }
  return out
}

const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10)

export function bankMetrics(accounts: DepositAccount[], range: { from: Date; to: Date }): BankMetrics | null {
  const tagged = accounts.flatMap((a, ai) => a.transactions.map(t => ({ ...t, ai, excluded: false })))
  if (tagged.length === 0) return null

  // Exclude transfers between the borrower's own accounts: same amount, opposite direction,
  // different linked accounts, value dates at most one day apart.
  let internalPairs = 0
  if (accounts.length > 1) {
    const debits = tagged.filter(t => t.type === 'DEBIT')
    for (const c of tagged.filter(t => t.type === 'CREDIT')) {
      const cd = Date.parse(c.date)
      const match = debits.find(d => !d.excluded && d.ai !== c.ai && d.amount === c.amount && Math.abs(Date.parse(d.date) - cd) <= 86_400_000)
      if (match) {
        match.excluded = true
        c.excluded = true
        internalPairs++
      }
    }
  }

  const from = range.from.toISOString().slice(0, 10)
  const to = range.to.toISOString().slice(0, 10)
  const all = monthsBetween(from, to)
  // A month counts only if the whole month lies inside the requested range
  const complete = all.filter(m => `${m}-01` >= from && lastDay(m) <= to)
  const partial = complete.length < 3
  const months = partial ? all : complete

  const flows = new Map(months.map(m => [m, { inflow: 0, outflow: 0 }]))
  let totalCredits = 0, totalDebits = 0, bounceCount = 0
  for (const t of tagged) {
    if (BOUNCE.test(t.narration)) bounceCount++
    if (t.excluded) continue
    const f = flows.get(monthKey(t.date))
    if (!f) continue
    if (t.type === 'CREDIT') { f.inflow += t.amount; totalCredits += t.amount }
    else { f.outflow += t.amount; totalDebits += t.amount }
  }

  const monthly: MonthlyFlow[] = months.map(m => ({ month: m, inflow: Math.round(flows.get(m)!.inflow), outflow: Math.round(flows.get(m)!.outflow) }))
  const inflows = monthly.map(m => m.inflow)
  const mean = inflows.reduce((a, b) => a + b, 0) / inflows.length
  const sd = Math.sqrt(inflows.reduce((a, b) => a + (b - mean) ** 2, 0) / inflows.length)

  return {
    monthly,
    months: monthly.length,
    avgMonthlyInflow: Math.round(mean),
    avgMonthlyOutflow: Math.round(monthly.reduce((a, m) => a + m.outflow, 0) / monthly.length),
    inflowVolatility: mean > 0 ? Math.round((sd / mean) * 1000) / 1000 : 0,
    totalCredits: Math.round(totalCredits),
    totalDebits: Math.round(totalDebits),
    accounts: accounts.length,
    internalTransfersExcluded: internalPairs,
    bounceCount,
    partialMonthsIncluded: partial,
    holderPans: [...new Set(accounts.flatMap(a => a.holderPans))],
  }
}

// ───────────── GST metrics ─────────────

export type GstMetrics = {
  monthly: { month: string; turnover: number }[]
  periodsFiled: number
  avgMonthlyTurnover: number
  /** Average monthly turnover × 12. */
  annualisedTurnover: number
  /** Months with no GSTR-3B between the first and last filed period. */
  missingPeriods: string[]
  legalName: string
  registrationStatus: string
}

export function gstMetrics(accounts: GstAccount[]): GstMetrics | null {
  const byMonth = new Map<string, number>()
  for (const a of accounts) for (const p of a.periods) byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.turnover)
  if (byMonth.size === 0) return null
  const months = [...byMonth.keys()].sort()
  const span = monthsBetween(`${months.at(0)}-01`, `${months.at(-1)}-01`)
  const monthly = months.map(m => ({ month: m, turnover: Math.round(byMonth.get(m)!) }))
  const avg = monthly.reduce((s, m) => s + m.turnover, 0) / monthly.length
  return {
    monthly,
    periodsFiled: monthly.length,
    avgMonthlyTurnover: Math.round(avg),
    annualisedTurnover: Math.round(avg * 12),
    missingPeriods: span.filter(m => !byMonth.has(m)),
    legalName: accounts.find(a => a.legalName)?.legalName ?? '',
    registrationStatus: accounts.find(a => a.registrationStatus)?.registrationStatus ?? '',
  }
}

// ───────────── Names ─────────────

const STOP = new Set(['PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'THE', 'AND', 'CO', 'COMPANY', 'M/S', 'MS', 'MR', 'MRS', 'SHRI', 'SMT'])

/** 0-1 token-overlap similarity between two names, ignoring case, punctuation and legal suffixes. */
export function nameSimilarity(a: string, b: string): number {
  const tokens = (s: string) => new Set(s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(t => t && !STOP.has(t)))
  const x = tokens(a), y = tokens(b)
  if (x.size === 0 || y.size === 0) return 0
  let common = 0
  for (const t of x) if (y.has(t)) common++
  return Math.round(((2 * common) / (x.size + y.size)) * 100) / 100
}
