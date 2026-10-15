import { NextResponse, after } from 'next/server'
import { v1, readJson } from '@/lib/api-v1'
import { withIdempotency } from '@/lib/idempotency'
import { createApplication, listApplications } from '@/lib/services/applications'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

export const GET = v1('applications:read', async ({ request, actor }) => {
  const q = new URL(request.url).searchParams
  const result = await listApplications(actor, {
    status: q.get('status') ?? undefined,
    limit: q.has('limit') ? Number(q.get('limit')) : undefined,
    cursor: q.get('cursor') ?? undefined,
  })
  return NextResponse.json(result)
})

export const POST = v1('applications:write', async ({ request, actor }) => {
  const { raw, body } = await readJson(request)
  const response = await withIdempotency(request, actor.nbfcId, raw, async () => ({
    status: 201,
    body: await createApplication(actor, body),
  }))
  after(dispatchPendingWebhooks)
  return response
})
