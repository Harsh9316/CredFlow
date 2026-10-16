import { NextResponse, after } from 'next/server'
import { requireApiSession } from '@/lib/auth'
import { getConsent, syncConsent } from '@/lib/services/data-consents'
import { errorResponse, notFound } from '@/lib/services/errors'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

// Re-reads the consent from the provider and collects the data once it is available
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; consentId: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
  if (error) return error
  try {
    const { id, consentId } = await params
    const actor = { kind: 'user' as const, userId: session.id, role: session.role, nbfcId: session.nbfcId }
    if ((await getConsent(actor, consentId)).applicationId !== id) throw notFound('Consent')
    const consent = await syncConsent(actor, consentId)
    after(dispatchPendingWebhooks)
    return NextResponse.json(consent)
  } catch (e) {
    return errorResponse(e)
  }
}
