// Connector registry. Pick a provider per data source with environment variables:
//   CONNECTOR_BUREAU, CONNECTOR_GST, CONNECTOR_KYC, CONNECTOR_BANK_DATA = none | mock
// To add a real provider, implement the interface from ./types and add it to the maps below.

import type { BankDataConnector, BureauConnector, Connectors, GstConnector, KycConnector } from './types'
import { mockBankData, mockBureau, mockGst, mockKyc } from './mock'

export type * from './types'

const bureau: Record<string, BureauConnector> = { mock: mockBureau }
const gst: Record<string, GstConnector> = { mock: mockGst }
const kyc: Record<string, KycConnector> = { mock: mockKyc }
const bankData: Record<string, BankDataConnector> = { mock: mockBankData }

function pick<T>(kind: string, registry: Record<string, T>, envVar: string): T | null {
  const name = (process.env[envVar] ?? 'none').trim().toLowerCase()
  if (name === 'none' || name === '') return null
  const connector = registry[name]
  if (!connector) {
    throw new Error(`${envVar}=${name} is not a known ${kind} connector (available: none, ${Object.keys(registry).join(', ')})`)
  }
  return connector
}

export function getConnectors(): Connectors {
  return {
    bureau: pick('bureau', bureau, 'CONNECTOR_BUREAU'),
    gst: pick('GST', gst, 'CONNECTOR_GST'),
    kyc: pick('KYC', kyc, 'CONNECTOR_KYC'),
    bankData: pick('bank data', bankData, 'CONNECTOR_BANK_DATA'),
  }
}
