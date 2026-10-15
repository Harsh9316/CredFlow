// Idempotency-Key support for POST endpoints of the public API.
// The key is reserved before the work starts, so two concurrent requests with the same key
// cannot both run. A retry with the same key and body gets the stored response back; the
// same key with a different body is rejected. Failed requests release the key.

import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from './db'
import { ServiceError } from './services/errors'

const IN_PROGRESS = 0

export async function withIdempotency(
  request: Request,
  nbfcId: string,
  rawBody: string,
  handler: () => Promise<{ status: number; body: unknown }>
): Promise<NextResponse> {
  const key = request.headers.get('idempotency-key')
  if (!key) {
    const { status, body } = await handler()
    return NextResponse.json(body, { status })
  }
  if (key.length > 255) throw new ServiceError(400, 'invalid_request', 'Idempotency-Key must be at most 255 characters')

  const requestHash = createHash('sha256').update(`${new URL(request.url).pathname}\n${rawBody}`).digest('hex')

  let reservation
  try {
    reservation = await prisma.idempotencyKey.create({
      data: { nbfcId, key, requestHash, responseStatus: IN_PROGRESS, responseBody: {} },
    })
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    const existing = await prisma.idempotencyKey.findUniqueOrThrow({ where: { nbfcId_key: { nbfcId, key } } })
    if (existing.requestHash !== requestHash) {
      throw new ServiceError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different request')
    }
    if (existing.responseStatus === IN_PROGRESS) {
      throw new ServiceError(409, 'request_in_progress', 'A request with this Idempotency-Key is still being processed; retry shortly')
    }
    return NextResponse.json(existing.responseBody, { status: existing.responseStatus, headers: { 'idempotent-replayed': 'true' } })
  }

  try {
    const { status, body } = await handler()
    if (status >= 300) {
      await prisma.idempotencyKey.delete({ where: { id: reservation.id } })
    } else {
      await prisma.idempotencyKey.update({
        where: { id: reservation.id },
        data: { responseStatus: status, responseBody: body as Prisma.InputJsonValue },
      })
    }
    return NextResponse.json(body, { status })
  } catch (e) {
    await prisma.idempotencyKey.delete({ where: { id: reservation.id } }).catch(() => {})
    throw e
  }
}
