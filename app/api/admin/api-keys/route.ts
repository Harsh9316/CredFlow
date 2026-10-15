import { NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'
import { ALL_SCOPES, generateApiKey } from '@/lib/api-keys'
import { errorResponse } from '@/lib/services/errors'

const CreateKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1),
})

export async function GET() {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  const keys = await prisma.apiKey.findMany({
    where: { nbfcId: session.nbfcId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  })
  return NextResponse.json({ data: keys })
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(['ADMIN'])
  if (error) return error
  try {
    const { name, scopes } = CreateKeySchema.parse(await request.json())
    const { key, prefix, keyHash } = generateApiKey()
    const row = await prisma.$transaction(async tx => {
      const created = await tx.apiKey.create({
        data: { nbfcId: session.nbfcId, name, prefix, keyHash, scopes, createdById: session.id },
      })
      await tx.auditLog.create({
        data: { userId: session.id, action: 'API_KEY_CREATED', details: JSON.stringify({ apiKeyId: created.id, name, prefix, scopes }) },
      })
      return created
    })
    // The full key is returned only here, once
    return NextResponse.json({ id: row.id, name, prefix, scopes, key }, { status: 201 })
  } catch (e) {
    return errorResponse(e)
  }
}
