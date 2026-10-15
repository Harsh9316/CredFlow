// Domain events. Each one is stored as a WebhookEvent (outbox) inside the same transaction
// as the change it describes, with a pending delivery for every subscribed endpoint.

import type { Prisma } from '@prisma/client'

export const EVENT_TYPES = [
  'application.created',
  'application.evaluated',
  'application.pending_approval',
  'application.sanctioned',
  'application.rejected',
  'application.referred',
  'application.returned',
  'webhook.test',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export async function recordEvent(
  tx: Prisma.TransactionClient,
  nbfcId: string,
  type: EventType,
  data: Prisma.InputJsonObject
): Promise<string> {
  const event = await tx.webhookEvent.create({ data: { nbfcId, type, data } })
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { nbfcId, isActive: true, OR: [{ events: { has: type } }, { events: { has: '*' } }] },
    select: { id: true },
  })
  if (endpoints.length > 0) {
    await tx.webhookDelivery.createMany({
      data: endpoints.map(e => ({ endpointId: e.id, eventId: event.id })),
    })
  }
  return event.id
}
