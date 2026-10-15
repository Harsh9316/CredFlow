import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  const { id } = await params
  const res = await prisma.webhookEndpoint.deleteMany({ where: { id, nbfcId: session.nbfcId } })
  if (res.count === 0) return NextResponse.json({ error: 'Webhook endpoint not found' }, { status: 404 })
  await prisma.auditLog.create({ data: { userId: session.id, action: 'WEBHOOK_ENDPOINT_DELETED', details: JSON.stringify({ endpointId: id }) } })
  return NextResponse.json({ success: true })
}
