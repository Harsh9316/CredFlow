import { NextResponse, after } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { handleSetuNotification } from '@/lib/services/data-consents'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

// Setu Account Aggregator notifications (CONSENT_STATUS_UPDATE, SESSION_STATUS_UPDATE).
// Setu does not sign notifications, so the URL carries a secret (SETU_AA_WEBHOOK_SECRET) and the
// payload is only used to find the consent: its status is then re-read from Setu's API.
// Configure in Setu Bridge as: https://<your-host>/api/connectors/setu/notifications/<secret>

const digest = (s: string) => createHash('sha256').update(s).digest()

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const secret = process.env.SETU_AA_WEBHOOK_SECRET ?? ''
  const { token } = await params
  if (secret.length < 16 || !timingSafeEqual(digest(token), digest(secret))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  try {
    const { matched } = await handleSetuNotification(payload)
    after(dispatchPendingWebhooks)
    return NextResponse.json({ received: true, matched })
  } catch (e) {
    // Setu retries on errors; a later sync (or the analyst's refresh) also picks the change up
    console.error('setu notification', e)
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
