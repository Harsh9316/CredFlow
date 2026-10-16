// Deterministic mock providers for development, demos and tests. Never use for real decisions.
// Results derive from a hash of the input, so the same PAN always gets the same report.
// Documented inputs trigger specific outcomes, so every path can be exercised:
//   PAN with 4th character 'X'   -> bureau fraud alert        PAN ending in 'Z' -> PAN not verified
//   PAN ending in 'D'            -> DPD 90+ history           PAN ending in 'R' -> bureau returns a rank, not a score
//   GSTIN ending in 'C'          -> GSTIN cancelled
//   AA mobile ending in '0000'   -> borrower rejects the consent
// The mock Account Aggregator approves consents immediately and returns bank (and, if requested,
// GST) data in the same ReBIT JSON format Setu returns, so the real parsers are exercised.

import { createHash } from 'node:crypto'
import { nameSimilarity } from './aa-parse'
import type { AaAccountData, AaFiType, BankDataConnector, BureauConnector, GstConnector, KycConnector } from './types'

const unit = (seed: string) => parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) / 0xffffffff

export const mockBureau: BureauConnector = {
  provider: 'mock',
  async fetchReport({ pan, gstin }) {
    const key = pan ?? gstin?.substring(2, 12)
    if (!key) return null
    if (unit(`thin:${key}`) < 0.1) return null // ~10% have no bureau record
    const asRank = key.endsWith('R')
    return {
      provider: 'mock',
      reportId: `MOCK-${createHash('sha256').update(key).digest('hex').slice(0, 10).toUpperCase()}`,
      score: asRank ? null : Math.round(450 + unit(`score:${key}`) * 400),
      rank: asRank ? 1 + Math.floor(unit(`rank:${key}`) * 10) : null,
      hasDelinquency: key.endsWith('D'),
      hasFraudAlert: key.charAt(3) === 'X',
      summary: { activeFacilities: 1 + Math.floor(unit(`fac:${key}`) * 5), enquiriesLast6Months: Math.floor(unit(`enq:${key}`) * 6) },
      fetchedAt: new Date().toISOString(),
    }
  },
}

export const mockGst: GstConnector = {
  provider: 'mock',
  async verifyGstin(gstin) {
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin) && !gstin.endsWith('C')) {
      return { provider: 'mock', status: 'NOT_FOUND' }
    }
    return { provider: 'mock', status: gstin.endsWith('C') ? 'CANCELLED' : 'ACTIVE', pan: gstin.substring(2, 12), registeredOn: '2019-07-01' }
  },
}

export const mockKyc: KycConnector = {
  provider: 'mock',
  async verifyPan(pan, legalName) {
    const valid = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) && !pan.endsWith('Z')
    const nameOnPan = valid ? legalName.toUpperCase() : undefined
    return { provider: 'mock', valid, nameOnPan, nameMatch: nameOnPan ? nameSimilarity(nameOnPan, legalName) : undefined }
  },
}

// ───────────── Account Aggregator ─────────────

const months12 = () => {
  const out: string[] = []
  const d = new Date()
  for (let i = 12; i >= 1; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
    out.push(m.toISOString().slice(0, 7))
  }
  return out
}

function mockDeposit(seed: string, maskedAccNumber: string, accountType: string, base: number, withTransferTo: boolean): unknown {
  const transaction: Record<string, string>[] = []
  let balance = base * 2
  for (const month of months12()) {
    const inflow = base * (0.8 + unit(`in:${seed}:${month}`) * 0.4)
    const outflow = inflow * (0.65 + unit(`out:${seed}:${month}`) * 0.2)
    // A few customer receipts and supplier payments a month
    for (const [day, share] of [['05', 0.4], ['14', 0.35], ['26', 0.25]] as const) {
      balance += inflow * share
      transaction.push({ type: 'CREDIT', mode: 'NEFT', amount: (inflow * share).toFixed(2), currentBalance: balance.toFixed(2), valueDate: `${month}-${day}`, transactionTimestamp: `${month}-${day}T10:00:00+05:30`, narration: `NEFT/CUSTOMER RECEIPT/${seed.slice(0, 4).toUpperCase()}`, txnId: `${seed}-${month}-${day}-c` })
    }
    for (const [day, share] of [['08', 0.5], ['20', 0.5]] as const) {
      balance -= outflow * share
      transaction.push({ type: 'DEBIT', mode: 'RTGS', amount: (outflow * share).toFixed(2), currentBalance: balance.toFixed(2), valueDate: `${month}-${day}`, transactionTimestamp: `${month}-${day}T15:00:00+05:30`, narration: 'RTGS/SUPPLIER PAYMENT', txnId: `${seed}-${month}-${day}-d` })
    }
    if (withTransferTo) {
      // Move money to the borrower's other account: must not count as income there
      transaction.push({ type: 'DEBIT', mode: 'IMPS', amount: '50000.00', currentBalance: (balance - 50000).toFixed(2), valueDate: `${month}-28`, transactionTimestamp: `${month}-28T12:00:00+05:30`, narration: 'IMPS/SELF TRANSFER', txnId: `${seed}-${month}-t` })
      balance -= 50000
    }
    if (unit(`bounce:${seed}:${month}`) < 0.08) {
      transaction.push({ type: 'DEBIT', mode: 'OTHERS', amount: '590.00', currentBalance: (balance - 590).toFixed(2), valueDate: `${month}-12`, transactionTimestamp: `${month}-12T09:00:00+05:30`, narration: 'ECS RTN CHGS INSUFFICIENT FUNDS', txnId: `${seed}-${month}-b` })
    }
  }
  return {
    account: {
      type: 'deposit',
      version: '2.0.0',
      maskedAccNumber,
      profile: { holders: { type: 'SINGLE', holder: { name: 'MOCK BORROWER', pan: 'AAGCM0000M' } } },
      summary: { currentBalance: balance.toFixed(2), currency: 'INR', accountSubType: accountType, status: 'ACTIVE' },
      transactions: { transaction },
    },
  }
}

function mockGstr(seed: string, base: number): unknown {
  return {
    Account: {
      type: 'gstr1_3b',
      version: '1.0.0',
      maskedGstinNumber: 'XXXXXXXXXXX1Z5',
      Profile: { BusinessDetails: { lgnm: 'MOCK BORROWER PVT LTD', sts: 'Active' } },
      Transactions: {
        Gstr3bDetails: {
          gstr3b: months12().map(m => ({
            ret_prd: `${m.slice(5)}${m.slice(0, 4)}`,
            status: 'PROCESSED',
            sup_details: { osup_det: { txval: (base * (0.85 + unit(`gst:${seed}:${m}`) * 0.3)).toFixed(2) } },
          })),
        },
      },
    },
  }
}

export const mockBankData: BankDataConnector = {
  provider: 'mock',
  async createConsent(req) {
    const fi = req.fiTypes.includes('GSTR1_3B') ? 'gst' : 'bank'
    const rejects = req.mobile.replace(/\D/g, '').endsWith('0000') ? 'r' : 'a'
    const consentId = `mock-${fi}-${rejects}-${req.reference}`
    return { consentId, url: `https://aa.mock.invalid/consent/${consentId}`, status: 'PENDING' }
  },
  async getConsent(consentId) {
    return consentId.split('-').at(2) === 'r' ? { status: 'REJECTED', error: 'UserRejected' } : { status: 'ACTIVE' }
  },
  async createSession(consentId) {
    return { sessionId: `${consentId}~session`, status: 'PENDING' }
  },
  async getSession(sessionId) {
    const consentId = sessionId.replace(/~session$/, '')
    const base = 400_000 + unit(`base:${consentId}`) * 2_000_000
    const fiTypes: AaFiType[] = consentId.split('-').at(1) === 'gst' ? ['DEPOSIT', 'GSTR1_3B'] : ['DEPOSIT']
    const accounts: AaAccountData[] = [
      { fipId: 'mock-bank', maskedAccNumber: 'XXXXXXXX4521', linkRefNumber: `${consentId}-1`, fiStatus: 'READY', data: mockDeposit(`${consentId}-1`, 'XXXXXXXX4521', 'CURRENT', base, true) },
      { fipId: 'mock-bank', maskedAccNumber: 'XXXXXXXX7788', linkRefNumber: `${consentId}-2`, fiStatus: 'READY', data: mockDeposit(`${consentId}-2`, 'XXXXXXXX7788', 'SAVINGS', base * 0.15, false) },
    ]
    // The self-transfers out of account 1 land in account 2
    const second = (accounts[1].data as { account: { transactions: { transaction: Record<string, string>[] } } }).account.transactions.transaction
    for (const m of months12()) second.push({ type: 'CREDIT', mode: 'IMPS', amount: '50000.00', valueDate: `${m}-28`, transactionTimestamp: `${m}-28T12:00:05+05:30`, narration: 'IMPS/SELF TRANSFER', txnId: `${consentId}-${m}-t2` })
    if (fiTypes.includes('GSTR1_3B')) {
      accounts.push({ fipId: 'mock-gstn', maskedAccNumber: 'XXXXXXXXXXX1Z5', linkRefNumber: `${consentId}-gst`, fiStatus: 'READY', data: mockGstr(consentId, base * 0.9) })
    }
    return { status: 'COMPLETED', accounts }
  },
}
