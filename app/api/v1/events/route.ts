import { NextResponse } from 'next/server'
import { v1 } from '@/lib/api-v1'
import prisma from '@/lib/db'

// Events in the order they happened. Poll with ?after=<last event id> as an alternative to webhooks.
export const GET = v1('events:read', async ({ request, actor }) => {
  const q = new URL(request.url).searchParams
  const limit = Math.min(Math.max(Number(q.get('limit') ?? 50) || 50, 1), 200)
  const after = q.get('after')
  const type = q.get('type')

  let since: Date | undefined
  if (after) {
    const cursor = await prisma.webhookEvent.findFirst({ where: { id: after, nbfcId: actor.nbfcId }, select: { createdAt: true } })
    since = cursor?.createdAt
  }

  const events = await prisma.webhookEvent.findMany({
    where: {
      nbfcId: actor.nbfcId,
      type: { not: 'webhook.test', ...(type && { equals: type }) },
      ...(since && { OR: [{ createdAt: { gt: since } }, { createdAt: since, id: { gt: after! } }] }),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  return NextResponse.json({
    data: events.map(e => ({ id: e.id, type: e.type, createdAt: e.createdAt.toISOString(), data: e.data })),
    hasMore: events.length === limit,
  })
})
