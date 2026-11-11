import { NextResponse } from 'next/server'
import { evaluateApplication, parseApplicationInput } from '@credrail/engine'
import { v1, readJson } from '@/lib/api-v1'
import { getActivePolicy } from '@/lib/policy'
import { explainDefaultRisk, getPdModel } from '@/lib/default-risk'

// Stateless decisioning: evaluates the posted application under your active credit policy
// and returns the result. Nothing is stored.
// With CREDRAIL_PD_MODEL set and `riskFeatures` in the body, the result also carries an
// advisory `defaultRisk`; `?explain=true` adds a plain-English explanation when enabled.
export const POST = v1('evaluate', async ({ request, actor }) => {
  const { body } = await readJson(request)
  const input = parseApplicationInput(body)
  const { policy, checksum } = await getActivePolicy(actor.nbfcId)
  const evaluation = evaluateApplication(input, policy, { pdModel: getPdModel() })
  const explain = new URL(request.url).searchParams.get('explain') === 'true'
  const defaultRiskExplanation =
    explain && evaluation.defaultRisk ? await explainDefaultRisk(evaluation.defaultRisk, evaluation.decision) : undefined
  return NextResponse.json({
    evaluation,
    ...(defaultRiskExplanation !== undefined && { defaultRiskExplanation }),
    policy: { id: policy.id, version: policy.version, checksum },
  })
})
