// Setu connectors: Account Aggregator (FIU gateway v2), GSTIN verification and PAN verification.
// Written against Setu's published OpenAPI specs (github.com/SetuHQ/docs, api-references/data):
//   AA   https://fiu-sandbox.setu.co | https://fiu.setu.co        POST /users/login, /v2/consents, /v2/sessions
//   Data https://dg-sandbox.setu.co  | https://dg.setu.co         POST /api/verify/gst, /api/verify/pan
//
// Configuration (all from the environment; see docs/CONNECTORS.md):
//   SETU_ENV=sandbox|production
//   SETU_AA_CLIENT_ID, SETU_AA_CLIENT_SECRET, SETU_AA_PRODUCT_INSTANCE_ID
//   SETU_DATA_CLIENT_ID, SETU_DATA_CLIENT_SECRET, SETU_GST_PRODUCT_INSTANCE_ID, SETU_PAN_PRODUCT_INSTANCE_ID

import { ConnectorError, requestJson, type FetchLike } from './http'
import { nameSimilarity } from './aa-parse'
import type {
  AaAccountData,
  AaConsentStatus,
  AaSessionStatus,
  BankDataConnector,
  GstConnector,
  GstinVerification,
  KycConnector,
  PanVerification,
} from './types'

const PROVIDER = 'setu'

function env(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new ConnectorError(PROVIDER, `${name} is not set`, undefined, 'not_configured')
  return v
}

const production = () => process.env.SETU_ENV === 'production'
const aaBase = () => (production() ? 'https://fiu.setu.co' : 'https://fiu-sandbox.setu.co')
const dataBase = () => (production() ? 'https://dg.setu.co' : 'https://dg-sandbox.setu.co')

const CONSENT_STATUSES: AaConsentStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'PAUSED', 'EXPIRED', 'FAILED']
const SESSION_STATUSES: AaSessionStatus[] = ['PENDING', 'PARTIAL', 'COMPLETED', 'EXPIRED', 'FAILED']
const consentStatus = (s: unknown): AaConsentStatus => {
  const v = String(s ?? '').toUpperCase() as AaConsentStatus
  // INITIATED (consent created, awaiting the borrower) is treated as PENDING
  return CONSENT_STATUSES.includes(v) ? v : 'PENDING'
}
const sessionStatus = (s: unknown): AaSessionStatus => {
  const v = String(s ?? '').toUpperCase() as AaSessionStatus
  return SESSION_STATUSES.includes(v) ? v : v === ('ACTIVE' as string) ? 'PENDING' : 'FAILED'
}

// ───────────── Account Aggregator ─────────────

type ConsentResponse = { id: string; url?: string; status: string }
type SessionResponse = {
  id: string
  status: string
  fips?: { fipID: string; accounts?: { linkRefNumber: string; maskedAccNumber: string; FIstatus?: string; status?: string; data: unknown }[] }[] | null
}

export class SetuAaConnector implements BankDataConnector {
  readonly provider = PROVIDER
  private token: { value: string; expiresAt: number } | null = null

  constructor(private readonly fetchImpl?: FetchLike) {}

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > Date.now()) return this.token.value
    const { data } = await requestJson<{ access_token: string }>(PROVIDER, `${aaBase()}/users/login`, {
      method: 'POST',
      headers: { client: 'bridge' },
      body: { clientID: env('SETU_AA_CLIENT_ID'), grant_type: 'client_credentials', secret: env('SETU_AA_CLIENT_SECRET') },
      retries: 1,
      fetchImpl: this.fetchImpl,
    })
    if (!data?.access_token) throw new ConnectorError(PROVIDER, 'login returned no access token', undefined, 'bad_response')
    // Refresh a little early; the token lifetime is not documented, so assume 10 minutes and retry on 401
    this.token = { value: data.access_token, expiresAt: Date.now() + 9 * 60_000 }
    return data.access_token
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const send = async (token: string) =>
      requestJson<T>(PROVIDER, `${aaBase()}${path}`, {
        method,
        body,
        headers: { authorization: `Bearer ${token}`, 'x-product-instance-id': env('SETU_AA_PRODUCT_INSTANCE_ID') },
        fetchImpl: this.fetchImpl,
      })
    try {
      return (await send(await this.accessToken())).data
    } catch (e) {
      if (e instanceof ConnectorError && e.status === 401) return (await send(await this.accessToken(true))).data
      throw e
    }
  }

  async createConsent(req: Parameters<BankDataConnector['createConsent']>[0]) {
    const mobile = req.mobile.replace(/\D/g, '').slice(-10)
    if (mobile.length !== 10) throw new ConnectorError(PROVIDER, 'mobile number must have 10 digits', undefined, 'invalid_request')
    const res = await this.call<ConsentResponse>('POST', '/v2/consents', {
      vua: mobile,
      ...(req.pan && { PAN: req.pan }),
      dataRange: { from: req.dataRange.from.toISOString(), to: req.dataRange.to.toISOString() },
      consentDuration: { unit: 'MONTH', value: 1 },
      fetchType: 'ONETIME',
      consentMode: 'STORE',
      consentTypes: ['PROFILE', 'SUMMARY', 'TRANSACTIONS'],
      fiTypes: req.fiTypes,
      dataLife: { unit: 'MONTH', value: 1 },
      context: [{ key: 'purposeDescription', value: 'Credit assessment for a business loan' }],
      additionalParams: { tags: ['credrail', req.reference] },
      ...(process.env.SETU_AA_REDIRECT_URL && { redirectUrl: process.env.SETU_AA_REDIRECT_URL }),
    })
    if (!res?.id || !res.url) throw new ConnectorError(PROVIDER, 'create consent returned no id or url', undefined, 'bad_response')
    return { consentId: res.id, url: res.url, status: consentStatus(res.status) }
  }

  async getConsent(consentId: string) {
    const res = await this.call<ConsentResponse>('GET', `/v2/consents/${encodeURIComponent(consentId)}`)
    return { status: consentStatus(res?.status) }
  }

  async createSession(consentId: string, range: { from: Date; to: Date }) {
    const res = await this.call<SessionResponse>('POST', '/v2/sessions', {
      consentId,
      dataRange: { from: range.from.toISOString(), to: range.to.toISOString() },
      format: 'json',
    })
    if (!res?.id) throw new ConnectorError(PROVIDER, 'create session returned no id', undefined, 'bad_response')
    return { sessionId: res.id, status: sessionStatus(res.status) }
  }

  async getSession(sessionId: string) {
    const res = await this.call<SessionResponse>('GET', `/v2/sessions/${encodeURIComponent(sessionId)}`)
    const accounts: AaAccountData[] = (res?.fips ?? []).flatMap(f =>
      (f.accounts ?? []).map(a => ({
        fipId: f.fipID,
        maskedAccNumber: a.maskedAccNumber,
        linkRefNumber: a.linkRefNumber,
        // The spec names the field FIstatus; some responses use status
        fiStatus: String(a.FIstatus ?? a.status ?? '').toUpperCase(),
        data: a.data,
      }))
    )
    return { status: sessionStatus(res?.status), accounts }
  }
}

// ───────────── GSTIN and PAN verification ─────────────

const dataHeaders = (instanceVar: string) => ({
  'x-client-id': env('SETU_DATA_CLIENT_ID'),
  'x-client-secret': env('SETU_DATA_CLIENT_SECRET'),
  'x-product-instance-id': env(instanceVar),
})

type GstResponse = {
  verification?: string
  message?: string
  data?: {
    company?: { name?: string; tradeName?: string; status?: string; constitutionOfBusiness?: string }
    gst?: { id?: string; registrationDate?: string; dateOfCancellation?: string }
  }
}

const GST_STATUS: Record<string, GstinVerification['status']> = {
  ACTIVE: 'ACTIVE',
  PROVISIONAL: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  'CANCELLED SUO-MOTO': 'CANCELLED',
  SUSPENDED: 'SUSPENDED',
  INACTIVE: 'SUSPENDED',
}

/** DD/MM/YYYY → YYYY-MM-DD */
const isoFromDmy = (s?: string) => {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined
}

export class SetuGstConnector implements GstConnector {
  readonly provider = PROVIDER
  constructor(private readonly fetchImpl?: FetchLike) {}

  async verifyGstin(gstin: string): Promise<GstinVerification> {
    const { data } = await requestJson<GstResponse>(PROVIDER, `${dataBase()}/api/verify/gst`, {
      method: 'POST',
      headers: dataHeaders('SETU_GST_PRODUCT_INSTANCE_ID'),
      body: { gstin },
      retries: 1, // verification has no side effects
      fetchImpl: this.fetchImpl,
    })
    // An unknown GSTIN still returns 200 with a message and no company data
    const company = data?.data?.company
    if (String(data?.verification).toLowerCase() !== 'success' || !company) {
      return { provider: PROVIDER, status: 'NOT_FOUND' }
    }
    return {
      provider: PROVIDER,
      status: GST_STATUS[String(company.status ?? '').trim().toUpperCase()] ?? 'NOT_FOUND',
      legalName: company.name || undefined,
      tradeName: company.tradeName || undefined,
      pan: gstin.substring(2, 12),
      registeredOn: isoFromDmy(data?.data?.gst?.registrationDate),
      constitution: company.constitutionOfBusiness || undefined,
    }
  }
}

type PanResponse = { verification?: string; message?: string; data?: { full_name?: string; category?: string } }

export class SetuPanConnector implements KycConnector {
  readonly provider = PROVIDER
  constructor(private readonly fetchImpl?: FetchLike) {}

  async verifyPan(pan: string, legalName: string): Promise<PanVerification> {
    try {
      const { data } = await requestJson<PanResponse>(PROVIDER, `${dataBase()}/api/verify/pan`, {
        method: 'POST',
        headers: dataHeaders('SETU_PAN_PRODUCT_INSTANCE_ID'),
        // Setu requires an explicit consent flag and a reason for every PAN lookup
        body: { pan, consent: 'Y', reason: 'Borrower verification for a business loan application' },
        retries: 1,
        fetchImpl: this.fetchImpl,
      })
      const valid = String(data?.verification).toUpperCase() === 'SUCCESS'
      const nameOnPan = data?.data?.full_name || undefined
      return {
        provider: PROVIDER,
        valid,
        nameOnPan,
        category: data?.data?.category || undefined,
        nameMatch: valid && nameOnPan ? nameSimilarity(nameOnPan, legalName) : undefined,
      }
    } catch (e) {
      // A PAN the registry does not know comes back as a 4xx; that is an answer, not an outage
      if (e instanceof ConnectorError && (e.status === 400 || e.status === 404 || e.status === 422) && e.code !== 'consent_not_given') {
        return { provider: PROVIDER, valid: false }
      }
      throw e
    }
  }
}
