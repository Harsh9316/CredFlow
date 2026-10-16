// Interfaces for external data providers. Implement one of these to plug in a provider, then
// register it in lib/connectors/index.ts. Connectors fetch and normalise data; all credit
// judgement stays in the engine and the credit policy.

export type BusinessIdentity = {
  pan?: string | null
  gstin?: string | null
  legalName: string
}

// ───────────── Bureau ─────────────

export type BureauReport = {
  provider: string
  reportId: string
  /** Score where higher is better (e.g. 300-900). Null when the bureau returns a rank instead. */
  score: number | null
  /** Commercial rank where 1 is the lowest risk (e.g. CIBIL MSME Rank, 1-10). */
  rank: number | null
  /** Any facility 90+ days past due in the lookback window. */
  hasDelinquency: boolean
  /** Bureau-reported fraud, wilful-defaulter or suit-filed marker. */
  hasFraudAlert: boolean
  /** Optional detail, shown to analysts; not used by the engine. */
  summary?: {
    activeFacilities?: number
    totalOutstanding?: number
    overdueAmount?: number
    enquiriesLast6Months?: number
  }
  fetchedAt: string
}

export interface BureauConnector {
  readonly provider: string
  /** Commercial bureau report, or null when the bureau has no record (thin file). */
  fetchReport(identity: BusinessIdentity, consent: { reference: string; capturedAt: string }): Promise<BureauReport | null>
}

// ───────────── GST and PAN verification ─────────────

export type GstinVerification = {
  provider: string
  status: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'NOT_FOUND'
  legalName?: string
  tradeName?: string
  /** PAN embedded in the registration. */
  pan?: string
  registeredOn?: string
  constitution?: string
}

export interface GstConnector {
  readonly provider: string
  verifyGstin(gstin: string): Promise<GstinVerification>
}

export type PanVerification = {
  provider: string
  valid: boolean
  nameOnPan?: string
  category?: string
  /** 0-1 similarity between nameOnPan and the name supplied. */
  nameMatch?: number
}

export interface KycConnector {
  readonly provider: string
  verifyPan(pan: string, legalName: string): Promise<PanVerification>
}

// ───────────── Account Aggregator (bank statements and GST returns) ─────────────

export type AaFiType = 'DEPOSIT' | 'GSTR1_3B'
export type AaConsentStatus = 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'PAUSED' | 'EXPIRED' | 'FAILED'
export type AaSessionStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'EXPIRED' | 'FAILED'

export type AaConsentRequest = {
  /** Borrower's mobile number registered with their bank (10 digits). */
  mobile: string
  pan?: string | null
  fiTypes: AaFiType[]
  dataRange: { from: Date; to: Date }
  /** Our consent record id, echoed in the provider's tags for traceability. */
  reference: string
}

/** One account's data from a fetch session, still in the ReBIT format the provider returned. */
export type AaAccountData = {
  fipId: string
  maskedAccNumber: string
  linkRefNumber: string
  fiStatus: string
  /** Decrypted FI payload (JSON). Parsed by lib/connectors/aa-parse.ts. */
  data: unknown
}

export interface BankDataConnector {
  readonly provider: string
  createConsent(request: AaConsentRequest): Promise<{ consentId: string; url: string; status: AaConsentStatus }>
  getConsent(consentId: string): Promise<{ status: AaConsentStatus; error?: string }>
  createSession(consentId: string, dataRange: { from: Date; to: Date }): Promise<{ sessionId: string; status: AaSessionStatus }>
  getSession(sessionId: string): Promise<{ status: AaSessionStatus; accounts: AaAccountData[] }>
}

export type Connectors = {
  bureau: BureauConnector | null
  gst: GstConnector | null
  kyc: KycConnector | null
  bankData: BankDataConnector | null
}
