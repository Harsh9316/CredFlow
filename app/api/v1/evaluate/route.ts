import { NextResponse } from 'next/server'
import { evaluateApplication, parseApplicationInput } from '@credflow/engine'
import { v1, readJson } from '@/lib/api-v1'
import { getActivePolicy } from '@/lib/policy'

// Stateless decisioning: evaluates the posted application under your active credit policy
// and returns the result. Nothing is stored.
export const POST = v1('evaluate', async ({ request, actor }) => {
  const { body } = await readJson(request)
  const input = parseApplicationInput(body)
  const { policy, checksum } = await getActivePolicy(actor.nbfcId)
  const evaluation = evaluateApplication(input, policy)
  return NextResponse.json({ evaluation, policy: { id: policy.id, version: policy.version, checksum } })
})
