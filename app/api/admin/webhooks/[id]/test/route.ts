import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

// Sends a `webhook.test` event to this endpoint only, and reports the result.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  const { id } = await params
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, nbfcId: session.nbfcId } })
  if (!endpoint) return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 })

  const delivery = await prisma.$transaction(async tx => {
    const event = await tx.webhookEvent.create({
      data: { nbfcId: session.nbfcId, type: 'webhook.test', data: { message: 'Test event from CredFlow', endpointId: id } },
    })
    return tx.webhookDelivery.create({ data: { endpointId: id, eventId: event.id } })
  })
  await dispatchPendingWebhooks()
  const result = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })
  return NextResponse.json({
    delivered: result.status === 'SUCCEEDED',
    responseStatus: result.responseStatus,
    error: result.lastError,
  })
}
