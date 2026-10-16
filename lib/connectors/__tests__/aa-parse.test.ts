import { describe, expect, it } from 'vitest'
import { bankMetrics, gstMetrics, nameSimilarity, parseFi, type DepositAccount, type GstAccount } from '../aa-parse'

// Shapes follow the ReBIT samples in Setu's FI data type docs (deposit v1.1 / v2.0.0, gstr1_3b v1.0.0)
const depositV2 = {
  account: {
    type: 'deposit',
    version: '2.0.0',
    maskedAccNumber: 'XXXXXX4373',
    profile: { holders: { type: 'Single', holder: [{ name: 'Ramkrishna Sapan', pan: 'AAAPL1234C' }] } },
    summary: { currentBalance: '101666.33', accountSubType: 'SAVINGS', status: 'ACTIVE' },
    transactions: {
      transaction: [
        { amount: '1239', transactionalBalance: '62289.25', mode: 'UPI', narration: 'UPI/935314560764/getsimpl', transactionTimestamp: '2021-04-01T13:20:14+05:30', type: 'DEBIT', valueDate: '2021-04-01' },
        { amount: '50000', mode: 'NEFT', narration: 'NEFT/CUSTOMER', transactionTimestamp: '2021-04-05T10:00:00+05:30', type: 'CREDIT', valueDate: '2021-04-05' },
      ],
    },
  },
}

// v1.1: summary.type, a single transaction object instead of an array, DD-MM-YYYY dates
const depositV1 = {
  type: 'deposit',
  maskedAccNumber: 'XXXXXXXX6053',
  summary: { currentBalance: '5000', type: 'CURRENT' },
  transactions: { transaction: { amount: '1,200.50', type: 'CREDIT', valueDate: '05-04-2021', narration: 'CASH' } },
}

const gstr = {
  Account: {
    type: 'gstr1_3b',
    maskedGstinNumber: 'maskedGstinNumber1',
    Profile: { BusinessDetails: { lgnm: 'Anupam Mukherjee', sts: 'Active' } },
    Transactions: {
      Gstr3bDetails: {
        gstr3b: {
          ret_prd: '072016',
          dof: '01-JAN-2021',
          status: 'PROCESSED',
          sup_details: {
            osup_det: { txval: '250', iamt: '100' },
            osup_zero: { txval: '250' },
            osup_nil_exmp: { txval: '250' },
            isup_rev: { txval: '250' },
            osup_nongst: { txval: '250' },
          },
        },
      },
    },
  },
}

const dep = (ai: string, txns: [type: 'CREDIT' | 'DEBIT', amount: number, date: string, narration?: string][]): DepositAccount => ({
  kind: 'deposit',
  maskedAccNumber: ai,
  accountType: 'CURRENT',
  holderNames: [],
  holderPans: ['AAGCM0000M'],
  currentBalance: null,
  transactions: txns.map(([type, amount, date, narration = '']) => ({ type, amount, date, narration, mode: '' })),
})

describe('parseFi', () => {
  it('parses a deposit v2.0.0 account', () => {
    const a = parseFi(depositV2) as DepositAccount
    expect(a.kind).toBe('deposit')
    expect(a.accountType).toBe('SAVINGS')
    expect(a.holderPans).toEqual(['AAAPL1234C'])
    expect(a.currentBalance).toBe(101666.33)
    expect(a.transactions).toHaveLength(2)
    expect(a.transactions[0]).toMatchObject({ type: 'DEBIT', amount: 1239, date: '2021-04-01' })
  })

  it('parses a deposit v1.1 account with a single transaction object', () => {
    const a = parseFi(depositV1) as DepositAccount
    expect(a.accountType).toBe('CURRENT')
    expect(a.transactions).toEqual([{ type: 'CREDIT', amount: 1200.5, date: '2021-04-05', narration: 'CASH', mode: '' }])
  })

  it('parses GSTR-3B outward supplies, excluding reverse-charge inward supplies', () => {
    const g = parseFi(gstr) as GstAccount
    expect(g.kind).toBe('gst')
    expect(g.legalName).toBe('Anupam Mukherjee')
    expect(g.periods).toEqual([{ month: '2016-07', turnover: 1000, filedOn: '01-JAN-2021', status: 'PROCESSED' }])
  })

  it('reports unknown or empty payloads instead of throwing', () => {
    expect(parseFi(null).kind).toBe('unknown')
    expect(parseFi({ account: { type: 'mutual_funds' } })).toEqual({ kind: 'unknown', type: 'mutual_funds' })
  })
})

describe('bankMetrics', () => {
  const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-04-15T00:00:00Z') }

  it('uses complete months only and averages them', () => {
    const m = bankMetrics([dep('1', [
      ['CREDIT', 100_000, '2026-01-10'], ['DEBIT', 60_000, '2026-01-20'],
      ['CREDIT', 120_000, '2026-02-10'], ['DEBIT', 70_000, '2026-02-20'],
      ['CREDIT', 80_000, '2026-03-10'], ['DEBIT', 50_000, '2026-03-20'],
      ['CREDIT', 999_999, '2026-04-05'], // partial month, ignored
    ])], range)!
    expect(m.months).toBe(3)
    expect(m.monthly.map(x => x.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(m.avgMonthlyInflow).toBe(100_000)
    expect(m.avgMonthlyOutflow).toBe(60_000)
    expect(m.inflowVolatility).toBeCloseTo(0.163, 3)
    expect(m.partialMonthsIncluded).toBe(false)
  })

  it('excludes transfers between the borrower’s own accounts', () => {
    const m = bankMetrics([
      dep('1', [['CREDIT', 100_000, '2026-01-05'], ['DEBIT', 25_000, '2026-01-28']]),
      dep('2', [['CREDIT', 25_000, '2026-01-29']]),
    ], range)!
    expect(m.internalTransfersExcluded).toBe(1)
    expect(m.totalCredits).toBe(100_000)
    expect(m.totalDebits).toBe(0)
  })

  it('does not pair a credit and debit within the same account', () => {
    const m = bankMetrics([dep('1', [['CREDIT', 25_000, '2026-01-05'], ['DEBIT', 25_000, '2026-01-05']])], range)!
    expect(m.internalTransfersExcluded).toBe(0)
  })

  it('counts returned and bounced payments', () => {
    const m = bankMetrics([dep('1', [
      ['DEBIT', 590, '2026-01-12', 'ECS RTN CHGS INSUFFICIENT FUNDS'],
      ['DEBIT', 500, '2026-02-12', 'CHQ RET 004512'],
      ['DEBIT', 400, '2026-03-12', 'NACH RETURN'],
      ['CREDIT', 10_000, '2026-03-14', 'NEFT RETURNING CUSTOMER'],
    ])], range)!
    expect(m.bounceCount).toBe(3)
  })

  it('keeps partial months when fewer than three complete months exist', () => {
    const m = bankMetrics([dep('1', [['CREDIT', 10_000, '2026-04-02']])], { from: new Date('2026-03-15T00:00:00Z'), to: new Date('2026-04-15T00:00:00Z') })!
    expect(m.partialMonthsIncluded).toBe(true)
    expect(m.months).toBe(2)
  })

  it('returns null without transactions', () => {
    expect(bankMetrics([dep('1', [])], range)).toBeNull()
  })
})

describe('gstMetrics', () => {
  it('annualises turnover and lists unfiled periods', () => {
    const acc: GstAccount = {
      kind: 'gst', maskedGstin: 'X', legalName: 'ACME', registrationStatus: 'Active',
      periods: [
        { month: '2026-01', turnover: 100, filedOn: null, status: '' },
        { month: '2026-02', turnover: 200, filedOn: null, status: '' },
        { month: '2026-04', turnover: 300, filedOn: null, status: '' },
      ],
    }
    const g = gstMetrics([acc])!
    expect(g.periodsFiled).toBe(3)
    expect(g.avgMonthlyTurnover).toBe(200)
    expect(g.annualisedTurnover).toBe(2400)
    expect(g.missingPeriods).toEqual(['2026-03'])
  })
})

describe('nameSimilarity', () => {
  it('ignores case, punctuation and legal suffixes', () => {
    expect(nameSimilarity('Acme Traders Pvt. Ltd.', 'ACME TRADERS PRIVATE LIMITED')).toBe(1)
    expect(nameSimilarity('Acme Traders', 'Zenith Foods')).toBe(0)
    expect(nameSimilarity('', 'x')).toBe(0)
  })
})
