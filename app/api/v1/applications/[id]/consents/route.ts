import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { v1, readJson } from '@/lib/api-v1'
import { withIdempotency } from '@/lib/idempotency'
import { listConsents, recordBureauConsent, requestBankData } from '@/lib/services/data-consents'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

export const GET = v1<{ id: string }>('applications:read', async ({ actor, params }) =>
  NextResponse.json({ data: await listConsents(actor, params.id) })
)

const Body = z.looseObject({ type: z.enum(['ACCOUNT_AGGREGATOR', 'BUREAU']) })

// type ACCOUNT_AGGREGATOR: { mobile, includeGst?, months? } -> consentUrl for the borrower
// type BUREAU: { method, reference, capturedAt? } -> records consent given to the lender
export const POST = v1<{ id: string }>('applications:write', async ({ request, actor, params }) => {
  const { raw, body } = await readJson(request)
  const { type, ...rest } = Body.parse(body)
  const response = await withIdempotency(request, actor.nbfcId, raw, async () => ({
    status: 201,
    body: type === 'BUREAU' ? await recordBureauConsent(actor, params.id, rest) : await requestBankData(actor, params.id, rest),
  }))
  after(dispatchPendingWebhooks)
  return response
})
