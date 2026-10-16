import { NextResponse, after } from 'next/server'
import { requireApiSession } from '@/lib/auth'
import { recordBureauConsent } from '@/lib/services/data-consents'
import { errorResponse } from '@/lib/services/errors'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

// Records that the borrower consented to a bureau pull; underwriting pulls a report only after this
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
  if (error) return error
  try {
    const { id } = await params
    const consent = await recordBureauConsent({ kind: 'user', userId: session.id, role: session.role, nbfcId: session.nbfcId }, id, await request.json())
    after(dispatchPendingWebhooks)
    return NextResponse.json(consent, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
