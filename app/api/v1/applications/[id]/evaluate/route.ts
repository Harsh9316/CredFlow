import { NextResponse, after } from 'next/server'
import { v1 } from '@/lib/api-v1'
import { underwriteApplication } from '@/lib/services/applications'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

// Runs the underwriting engine and stores the recommendation. Sanctioning stays with a
// signed-in analyst in the dashboard: the API can recommend, never approve.
export const POST = v1<{ id: string }>('applications:evaluate', async ({ actor, params }) => {
  const { application, evaluation, policy, connectors } = await underwriteApplication(actor, params.id)
  after(dispatchPendingWebhooks)
  return NextResponse.json({ application, evaluation, policy, connectors })
})
