import { NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'
import { EVENT_TYPES } from '@/lib/services/events'
import { ServiceError, errorResponse } from '@/lib/services/errors'
import { generateWebhookSecret, validateWebhookUrl } from '@/lib/webhooks'

const SUBSCRIBABLE = ['*', ...EVENT_TYPES.filter(t => t !== 'webhook.test')] as [string, ...string[]]

const CreateEndpointSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(200).optional(),
  events: z.array(z.enum(SUBSCRIBABLE)).min(1),
})

export async function GET() {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { nbfcId: session.nbfcId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, url: true, description: true, events: true, isActive: true, createdAt: true },
  })
  return NextResponse.json({ data: endpoints })
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  try {
    const input = CreateEndpointSchema.parse(await request.json())
    let url: string
    try {
      url = validateWebhookUrl(input.url)
    } catch (e) {
      throw new ServiceError(400, 'invalid_url', (e as Error).message)
    }
    const secret = generateWebhookSecret()
    const endpoint = await prisma.webhookEndpoint.create({
      data: { nbfcId: session.nbfcId, url, description: input.description, events: input.events, secret, createdById: session.id },
    })
    await prisma.auditLog.create({
      data: { userId: session.id, action: 'WEBHOOK_ENDPOINT_CREATED', details: JSON.stringify({ endpointId: endpoint.id, url, events: input.events }) },
    })
    // The signing secret is returned only here, once
    return NextResponse.json({ id: endpoint.id, url, events: endpoint.events, secret }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
