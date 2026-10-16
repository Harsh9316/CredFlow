// Webhook delivery.
//
// Events are written to WebhookEvent/WebhookDelivery inside the same transaction as the change
// (lib/services/events.ts). This module sends pending deliveries: right after a request
// (via `after()`), and from `npm run webhooks:dispatch` on a schedule as a safety net.
//
// Each request carries:
//   Credrail-Event:      application.sanctioned
//   Credrail-Delivery:   <delivery id>   (stable across retries; use it to de-duplicate)
//   Credrail-Signature:  t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the endpoint secret>

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import prisma from './db'

export const MAX_ATTEMPTS = 8
// Delay before attempt n+1, in seconds
const BACKOFF = [60, 5 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600, 24 * 3600]
const LEASE_SECONDS = 120
const TIMEOUT_MS = 10_000

export const generateWebhookSecret = () => `whsec_${randomBytes(24).toString('base64url')}`

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${v1}`
}

/** For receivers (and tests): checks the signature and rejects stale timestamps. */
export function verifySignature(secret: string, body: string, header: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false
  const expected = Buffer.from(signPayload(secret, body, t).split('v1=')[1], 'hex')
  const actual = Buffer.from(parts.v1, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// ── Destination checks (SSRF) ──

const allowPrivate = () => process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true'

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

/** Validates an endpoint URL when it is registered. Throws with a user-facing message. */
export function validateWebhookUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Webhook URL is not a valid URL')
  }
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials')
  if (url.protocol !== 'https:' && !(allowPrivate() && url.protocol === 'http:')) {
    throw new Error('Webhook URL must use https')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!allowPrivate() && (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isPrivateAddress(host)))) {
    throw new Error('Webhook URL must point to a public address')
  }
  return url.toString()
}

// Re-checked at send time, because DNS can change after registration
async function assertPublicDestination(url: URL) {
  if (allowPrivate()) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.some(a => isPrivateAddress(a.address))) {
    throw new Error(`${host} resolves to a private address`)
  }
}

// ── Dispatch ──

async function deliver(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true, event: true },
  })
  if (!delivery) return

  const body = JSON.stringify({
    id: delivery.event.id,
    type: delivery.event.type,
    createdAt: delivery.event.createdAt.toISOString(),
    data: delivery.event.data,
  })
  const attempts = delivery.attempts + 1
  let responseStatus: number | null = null
  let error: string | null = null

  if (!delivery.endpoint.isActive) {
    error = 'Endpoint disabled'
  } else {
    try {
      const url = new URL(delivery.endpoint.url)
      await assertPublicDestination(url)
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Credrail-Webhooks/1.0',
          'credrail-event': delivery.event.type,
          'credrail-delivery': delivery.id,
          'credrail-signature': signPayload(delivery.endpoint.secret, body),
        },
        body,
      })
      responseStatus = res.status
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  const succeeded = error === null
  const giveUp = !succeeded && (attempts >= MAX_ATTEMPTS || !delivery.endpoint.isActive)
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      lastAttemptAt: new Date(),
      responseStatus,
      lastError: error?.slice(0, 500) ?? null,
      status: succeeded ? 'SUCCEEDED' : giveUp ? 'FAILED' : 'PENDING',
      nextAttemptAt: succeeded || giveUp
        ? new Date()
        : new Date(Date.now() + BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)] * 1000),
    },
  })
}

/**
 * Sends deliveries that are due. Safe to run from several processes at once:
 * each delivery is claimed with a conditional update before it is sent.
 */
export async function dispatchPendingWebhooks(limit = 50): Promise<{ attempted: number }> {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true, nextAttemptAt: true },
  })

  let attempted = 0
  for (const d of due) {
    const claimed = await prisma.webhookDelivery.updateMany({
      where: { id: d.id, status: 'PENDING', nextAttemptAt: d.nextAttemptAt },
      data: { nextAttemptAt: new Date(Date.now() + LEASE_SECONDS * 1000) },
    })
    if (claimed.count === 0) continue // another worker has it
    attempted++
    await deliver(d.id)
  }
  return { attempted }
}
