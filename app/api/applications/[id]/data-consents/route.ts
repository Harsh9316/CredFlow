import { NextResponse, after } from 'next/server'
import { requireApiSession } from '@/lib/auth'
import { listConsents, requestBankData } from '@/lib/services/data-consents'
import { errorResponse } from '@/lib/services/errors'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  const { session, error } = await requireApiSession()
  if (error) return error
  try {
    const { id } = await params
    return NextResponse.json({ data: await listConsents({ kind: 'user', userId: session.id, role: session.role, nbfcId: session.nbfcId }, id) })
  } catch (e) {
    return errorResponse(e)
  }
}

// Starts an Account Aggregator consent; the borrower approves it at the returned consentUrl
export async function POST(request: Request, { params }: Ctx) {
  const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
  if (error) return error
  try {
    const { id } = await params
    const consent = await requestBankData({ kind: 'user', userId: session.id, role: session.role, nbfcId: session.nbfcId }, id, await request.json())
    after(dispatchPendingWebhooks)
    return NextResponse.json(consent, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
