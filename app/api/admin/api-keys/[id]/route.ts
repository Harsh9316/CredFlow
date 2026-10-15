import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'

// Revokes a key. Rows are kept so audit entries made with the key stay attributable.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  const { id } = await params
  const res = await prisma.apiKey.updateMany({
    where: { id, nbfcId: session.nbfcId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (res.count === 0) return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  await prisma.auditLog.create({ data: { userId: session.id, action: 'API_KEY_REVOKED', details: JSON.stringify({ apiKeyId: id }) } })
  return NextResponse.json({ success: true })
}
