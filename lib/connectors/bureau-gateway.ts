// Bureau connector for a lender-operated bureau gateway.
//
// Commercial bureaus (TransUnion CIBIL company reports and MSME Rank, CRIF High Mark commercial,
// Experian, Equifax) give API access only to member lenders, under member-specific specifications.
// Credrail therefore does not call a bureau directly: it calls a small gateway the lender runs
// (or its LOS already provides) that pulls the report with the lender's membership and returns
// this normalised JSON. The contract is documented in docs/CONNECTORS.md.
//
//   CONNECTOR_BUREAU=gateway
//   BUREAU_GATEWAY_URL=https://bureau-gateway.internal.example/credrail/report
//   BUREAU_GATEWAY_TOKEN=<shared secret, sent as a Bearer token>

import { z } from 'zod'
import { ConnectorError, requestJson, type FetchLike } from './http'
import type { BureauConnector, BureauReport, BusinessIdentity } from './types'

export const BureauGatewayResponseSchema = z.object({
  reportId: z.string().min(1),
  bureau: z.string().min(1).describe('cibil | crif | experian | equifax'),
  noRecord: z.boolean().default(false),
  score: z.number().nullish(),
  rank: z.number().int().min(1).max(10).nullish(),
  dpd90Plus: z.boolean(),
  fraudOrWilfulDefault: z.boolean(),
  summary: z
    .object({
      activeFacilities: z.number().int().min(0).optional(),
      totalOutstanding: z.number().min(0).optional(),
      overdueAmount: z.number().min(0).optional(),
      enquiriesLast6Months: z.number().int().min(0).optional(),
    })
    .optional(),
  fetchedAt: z.string().optional(),
})

export class BureauGatewayConnector implements BureauConnector {
  readonly provider = 'gateway'
  constructor(private readonly fetchImpl?: FetchLike) {}

  async fetchReport(identity: BusinessIdentity, consent: { reference: string; capturedAt: string }): Promise<BureauReport | null> {
    const url = process.env.BUREAU_GATEWAY_URL?.trim()
    const token = process.env.BUREAU_GATEWAY_TOKEN?.trim()
    if (!url || !token) throw new ConnectorError(this.provider, 'BUREAU_GATEWAY_URL and BUREAU_GATEWAY_TOKEN must be set', undefined, 'not_configured')

    let body: unknown
    try {
      ;({ data: body } = await requestJson<unknown>(this.provider, url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: {
          pan: identity.pan ?? null,
          gstin: identity.gstin ?? null,
          legalName: identity.legalName,
          consentReference: consent.reference,
          consentCapturedAt: consent.capturedAt,
          purpose: 'credit_assessment',
        },
        timeoutMs: 30_000,
        fetchImpl: this.fetchImpl,
      }))
    } catch (e) {
      if (e instanceof ConnectorError && e.status === 404) return null // no bureau record: thin file
      throw e
    }

    const parsed = BureauGatewayResponseSchema.safeParse(body)
    if (!parsed.success) {
      throw new ConnectorError(this.provider, `gateway response does not match the contract: ${parsed.error.issues.map(i => i.path.join('.') || '(root)').join(', ')}`, undefined, 'bad_response')
    }
    const r = parsed.data
    if (r.noRecord) return null
    if ((r.score === null || r.score === undefined) && (r.rank === null || r.rank === undefined)) {
      throw new ConnectorError(this.provider, 'gateway returned neither a score nor a rank', undefined, 'bad_response')
    }
    return {
      provider: `${this.provider}:${r.bureau}`,
      reportId: r.reportId,
      score: r.score ?? null,
      rank: r.rank ?? null,
      hasDelinquency: r.dpd90Plus,
      hasFraudAlert: r.fraudOrWilfulDefault,
      summary: r.summary,
      fetchedAt: r.fetchedAt ?? new Date().toISOString(),
    }
  }
}
