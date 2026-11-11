// Advisory probability-of-default model and its optional plain-English explanation.
// Both are off unless configured, and neither can change a policy decision.
//
//   CREDRAIL_PD_MODEL="ml/models/uci-taiwan.json"   model trained by ml/ (path from the app root)
//   CREDRAIL_LLM_EXPLANATIONS="true"                 explain results with Claude (needs ANTHROPIC_API_KEY)

import { readFileSync } from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { parsePdModel, type Decision, type DefaultRiskResult, type PdModel } from '@credrail/engine'

let cached: { file: string; model: PdModel } | null = null

/** The configured PD model, or null when CREDRAIL_PD_MODEL is not set. */
export function getPdModel(): PdModel | null {
  const file = process.env.CREDRAIL_PD_MODEL?.trim()
  if (!file) return null
  if (cached?.file !== file) {
    const json: unknown = JSON.parse(readFileSync(path.resolve(process.cwd(), file), 'utf8'))
    cached = { file, model: parsePdModel(json) }
  }
  return cached.model
}

export function llmExplanationsEnabled(): boolean {
  return process.env.CREDRAIL_LLM_EXPLANATIONS === 'true' && Boolean(process.env.ANTHROPIC_API_KEY)
}

const ExplanationSchema = z.object({
  summary: z.string(),
  keyFactors: z.array(z.string()),
  suggestedChecks: z.array(z.string()),
})

export type DefaultRiskExplanation = z.infer<typeof ExplanationSchema> & { model: string }

const EXPLANATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences for a credit officer.' },
    keyFactors: { type: 'array', items: { type: 'string' }, description: 'One line per driver, most important first.' },
    suggestedChecks: { type: 'array', items: { type: 'string' }, description: 'Up to three things to verify before sanction.' },
  },
  required: ['summary', 'keyFactors', 'suggestedChecks'],
  additionalProperties: false,
}

const SYSTEM = [
  'You explain the output of a probability-of-default model to a credit officer at an Indian NBFC.',
  'The model is advisory. The lending decision comes from the lender\'s credit policy and you must not',
  'recommend approving or rejecting, or contradict that decision. Use only the numbers you are given;',
  'do not invent facts about the borrower. Plain, short sentences. Use percentages, not log-odds.',
].join(' ')

const EXPLAIN_MODEL = 'claude-opus-5-5'

let client: Anthropic | null = null

/**
 * Plain-English explanation of an advisory default-risk result, or null when explanations are off,
 * the model declines, or the call fails. Only the model output and the policy decision are sent;
 * no borrower identifiers.
 */
export async function explainDefaultRisk(risk: DefaultRiskResult, decision: Decision): Promise<DefaultRiskExplanation | null> {
  if (!llmExplanationsEnabled()) return null
  client ??= new Anthropic()

  const facts = {
    policyDecision: decision,
    probabilityOfDefault: `${(risk.probability * 100).toFixed(1)}%`,
    riskBand: risk.band,
    model: risk.model,
    drivers: risk.drivers.map(d => ({
      factor: d.label,
      value: d.value,
      effect: d.direction === 'RAISES_RISK' ? 'raises risk' : 'lowers risk',
      strength: Math.abs(d.contribution).toFixed(2),
    })),
    notProvided: risk.missing,
  }

  try {
    const response = await client.beta.messages.create({
      model: EXPLAIN_MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXPLANATION_JSON_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Explain this result:\n${JSON.stringify(facts, null, 2)}` }],
    })
    if (response.stop_reason !== 'end_turn') return null
    const text = response.content.find(b => b.type === 'text')
    if (!text || text.type !== 'text') return null
    const parsed = ExplanationSchema.safeParse(JSON.parse(text.text))
    return parsed.success ? { ...parsed.data, model: response.model } : null
  } catch (e) {
    if (e instanceof Anthropic.APIError || e instanceof SyntaxError) {
      console.error('Default-risk explanation failed:', e.message)
      return null
    }
    throw e
  }
}
