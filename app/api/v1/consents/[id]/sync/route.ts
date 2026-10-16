import { NextResponse, after } from 'next/server'
import { v1 } from '@/lib/api-v1'
import { syncConsent } from '@/lib/services/data-consents'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

// Re-reads the consent from the provider and collects the data once available. Idempotent.
export const POST = v1<{ id: string }>('applications:write', async ({ actor, params }) => {
  const consent = await syncConsent(actor, params.id)
  after(dispatchPendingWebhooks)
  return NextResponse.json(consent)
})
