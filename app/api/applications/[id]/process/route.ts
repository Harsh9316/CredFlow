import { NextResponse, after } from 'next/server'
import { requireApiSession } from '@/lib/auth'
import { decideApplication } from '@/lib/services/applications'
import { errorResponse } from '@/lib/services/errors'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
  if (error) return error
  try {
    const { id } = await params
    const b = await request.json()
    // The dashboard sends numbers as strings and conditions as one-per-line text
    const body = b.action === 'APPROVE'
      ? {
          ...b,
          sanctionedAmount: num(b.sanctionedAmount),
          sanctionedTenure: num(b.sanctionedTenure),
          interestRate: num(b.interestRate),
          processingFee: num(b.processingFee),
          conditions: typeof b.conditions === 'string'
            ? b.conditions.split('\n').map((c: string) => c.trim()).filter(Boolean)
            : b.conditions,
          overrideReason: b.overrideReason || undefined,
        }
      : { ...b, overrideReason: b.overrideReason || undefined, remarks: b.remarks || undefined }

    const result = await decideApplication(
      { kind: 'user', userId: session.id, role: session.role, nbfcId: session.nbfcId },
      id,
      body
    )
    after(dispatchPendingWebhooks)
    return NextResponse.json({ success: true, action: b.action, outcome: result.outcome, checkerReasons: result.checkerReasons })
  } catch (e) {
    return errorResponse(e)
  }
}
