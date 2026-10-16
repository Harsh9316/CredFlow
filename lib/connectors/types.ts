// Interfaces for external data providers. Implement one of these to plug in a real
// bureau, GST, PAN or Account Aggregator provider, then register it in lib/connectors/index.ts.
// Connectors fetch data; all credit judgement stays in the engine and the policy.

import type { MonthlyFlow } from '@credrail/engine'

export type BusinessIdentity = {
  pan?: string | null
  gstin?: string | null
  legalName: string
}

export type BureauReport = {
  provider: string
  reportId: string
  score: number
  /** Any facility 90+ days past due in the lookback window. */
  hasDelinquency: boolean
  /** Bureau-reported fraud or wilful-defaulter marker. */
  hasFraudAlert: boolean
  fetchedAt: string
}

export interface BureauConnector {
  readonly provider: string
  /** Commercial bureau report, or null when the bureau has no record (thin file). */
  fetchReport(identity: BusinessIdentity): Promise<BureauReport | null>
}

export type GstinVerification = {
  provider: string
  status: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'NOT_FOUND'
  legalName?: string
  /** PAN embedded in the registration. */
  pan?: string
  registeredOn?: string
}

export interface GstConnector {
  readonly provider: string
  verifyGstin(gstin: string): Promise<GstinVerification>
}

export type PanVerification = {
  provider: string
  valid: boolean
  nameOnPan?: string
  /** 0-1 similarity between nameOnPan and the name supplied. */
  nameMatch?: number
}

export interface KycConnector {
  readonly provider: string
  verifyPan(pan: string, legalName: string): Promise<PanVerification>
}

export interface BankDataConnector {
  readonly provider: string
  /** Month-by-month inflows/outflows for an Account Aggregator consent the borrower has approved. */
  fetchMonthlyFlows(consentHandle: string): Promise<MonthlyFlow[]>
}

export type Connectors = {
  bureau: BureauConnector | null
  gst: GstConnector | null
  kyc: KycConnector | null
  bankData: BankDataConnector | null
}
