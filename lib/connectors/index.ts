// Connector registry. Pick a provider per data source with environment variables:
//   CONNECTOR_BANK_DATA = none | mock | setu       Account Aggregator (bank statements, GST returns)
//   CONNECTOR_GST       = none | mock | setu       GSTIN verification
//   CONNECTOR_KYC       = none | mock | setu       PAN verification
//   CONNECTOR_BUREAU    = none | mock | gateway    Commercial bureau report via the lender's gateway
// To add a provider, implement the interface from ./types and add it to the maps below.

import type { BankDataConnector, BureauConnector, Connectors, GstConnector, KycConnector } from './types'
import { mockBankData, mockBureau, mockGst, mockKyc } from './mock'
import { SetuAaConnector, SetuGstConnector, SetuPanConnector } from './setu'
import { BureauGatewayConnector } from './bureau-gateway'

export type * from './types'

// Instances are created lazily and reused, so a provider's token cache survives across requests
const cache = new Map<string, unknown>()
const once = <T,>(key: string, make: () => T) => () => {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key) as T
}

const bureau: Record<string, () => BureauConnector> = { mock: () => mockBureau, gateway: once('gateway', () => new BureauGatewayConnector()) }
const gst: Record<string, () => GstConnector> = { mock: () => mockGst, setu: once('setu-gst', () => new SetuGstConnector()) }
const kyc: Record<string, () => KycConnector> = { mock: () => mockKyc, setu: once('setu-pan', () => new SetuPanConnector()) }
const bankData: Record<string, () => BankDataConnector> = { mock: () => mockBankData, setu: once('setu-aa', () => new SetuAaConnector()) }

function pick<T>(kind: string, registry: Record<string, () => T>, envVar: string): T | null {
  const name = (process.env[envVar] ?? 'none').trim().toLowerCase()
  if (name === 'none' || name === '') return null
  const make = registry[name]
  if (!make) {
    throw new Error(`${envVar}=${name} is not a known ${kind} connector (available: none, ${Object.keys(registry).join(', ')})`)
  }
  if (name === 'mock' && process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_CONNECTORS !== 'true') {
    throw new Error(`${envVar}=mock is refused in production: mock providers return fake data. Set ALLOW_MOCK_CONNECTORS=true only for a demo.`)
  }
  return make()
}

export function getConnectors(): Connectors {
  return {
    bureau: pick('bureau', bureau, 'CONNECTOR_BUREAU'),
    gst: pick('GST', gst, 'CONNECTOR_GST'),
    kyc: pick('KYC', kyc, 'CONNECTOR_KYC'),
    bankData: pick('bank data', bankData, 'CONNECTOR_BANK_DATA'),
  }
}

/** Which provider each data source uses, for display. Never throws. */
export function connectorSettings(): Record<'bankData' | 'gst' | 'kyc' | 'bureau', string> {
  const v = (n: string) => (process.env[n] ?? 'none').trim().toLowerCase() || 'none'
  return { bankData: v('CONNECTOR_BANK_DATA'), gst: v('CONNECTOR_GST'), kyc: v('CONNECTOR_KYC'), bureau: v('CONNECTOR_BUREAU') }
}
