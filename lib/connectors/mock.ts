// Deterministic mock providers for development, demos and tests.
// Results are derived from a hash of the input, so the same PAN always gets the same report.
// A few documented inputs trigger specific outcomes, so every path can be exercised:
//   PAN with 4th character 'X'   -> bureau fraud alert       PAN ending in 'Z' -> PAN not verified
//   GSTIN ending in 'C'          -> GSTIN cancelled          PAN ending in 'D' -> DPD 90+ history

import { createHash } from 'node:crypto'
import type { MonthlyFlow } from '@credflow/engine'
import type { BankDataConnector, BureauConnector, GstConnector, KycConnector } from './types'

const unit = (seed: string) => parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) / 0xffffffff

export const mockBureau: BureauConnector = {
  provider: 'mock',
  async fetchReport({ pan, gstin }) {
    const key = pan ?? gstin?.substring(2, 12)
    if (!key) return null
    // ~10% of businesses have no bureau record
    if (unit(`thin:${key}`) < 0.1) return null
    return {
      provider: 'mock',
      reportId: `MOCK-${createHash('sha256').update(key).digest('hex').slice(0, 10).toUpperCase()}`,
      score: Math.round(450 + unit(`score:${key}`) * 400),
      hasDelinquency: key.endsWith('D'),
      hasFraudAlert: key.charAt(3) === 'X',
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
    return {
      provider: 'mock',
      status: gstin.endsWith('C') ? 'CANCELLED' : 'ACTIVE',
      pan: gstin.substring(2, 12),
      registeredOn: '2019-07-01',
    }
  },
}

export const mockKyc: KycConnector = {
  provider: 'mock',
  async verifyPan(pan, legalName) {
    const valid = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) && !pan.endsWith('Z')
    return { provider: 'mock', valid, nameOnPan: valid ? legalName.toUpperCase() : undefined, nameMatch: valid ? 1 : 0 }
  },
}

export const mockBankData: BankDataConnector = {
  provider: 'mock',
  async fetchMonthlyFlows(consentHandle) {
    const base = 300_000 + unit(`base:${consentHandle}`) * 2_000_000
    const months: MonthlyFlow[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date()
      d.setUTCDate(1)
      d.setUTCMonth(d.getUTCMonth() - i)
      const month = d.toISOString().slice(0, 7)
      const inflow = Math.round(base * (0.8 + unit(`in:${consentHandle}:${month}`) * 0.4))
      months.push({ month, inflow, outflow: Math.round(inflow * (0.65 + unit(`out:${consentHandle}:${month}`) * 0.2)) })
    }
    return months
  },
}
