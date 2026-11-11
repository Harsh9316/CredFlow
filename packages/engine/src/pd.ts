// Advisory probability of default (PD) from a model trained in ml/ and exported as JSON.
// The engine never lets this change the policy decision; it is reported alongside it.
// Scoring mirrors ml/credrail_ml/model.py exactly:
//   numeric:      contribution = coef * (clip(x, lo, hi) - mean) / std   (missing -> 0)
//   categorical:  contribution = (levels[value] ?? 0) - baseline        (missing -> 0)
//   PD = 1 / (1 + e^-(intercept + sum of contributions))

import { z } from 'zod'

const SourceSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('raw'), column: z.string() }),
  z.object({ op: z.literal('ratio'), numerator: z.string(), denominator: z.string() }),
])

const NumericFeature = z.object({
  kind: z.literal('numeric'),
  name: z.string(),
  label: z.string(),
  source: SourceSchema,
  clip: z.tuple([z.number(), z.number()]),
  mean: z.number(),
  std: z.number().positive(),
  coef: z.number(),
})

const CategoricalFeature = z.object({
  kind: z.literal('categorical'),
  name: z.string(),
  label: z.string(),
  source: SourceSchema,
  levels: z.record(z.string(), z.number()),
  baseline: z.number(),
})

const Metrics = z.object({ n: z.number(), auc: z.number(), ks: z.number(), brier: z.number() }).passthrough()

export const PdModelSchema = z.object({
  schema: z.literal('credrail.pd-model/v1'),
  id: z.string(),
  version: z.string(),
  algorithm: z.literal('logistic-regression'),
  advisoryOnly: z.literal(true),
  dataset: z.object({ name: z.string(), title: z.string(), source: z.string(), license: z.string() }).passthrough(),
  intercept: z.number(),
  features: z.array(z.discriminatedUnion('kind', [NumericFeature, CategoricalFeature])).min(1),
  bands: z.object({ medium: z.number(), high: z.number() }),
  metrics: z.object({ test: Metrics }).passthrough(),
})

export type PdModel = z.infer<typeof PdModelSchema>

/** Raw values keyed by the model's source columns. Unknown keys are ignored. */
export type RiskFeatures = Record<string, number | string | null | undefined>

export type DefaultRiskDriver = {
  feature: string
  label: string
  /** Change in log-odds versus an average applicant. Positive raises risk. */
  contribution: number
  direction: 'RAISES_RISK' | 'LOWERS_RISK'
  value: number | string | null
}

export type DefaultRiskResult = {
  /** Always true: the policy decision does not depend on this result. */
  advisory: true
  probability: number
  band: 'LOW' | 'MEDIUM' | 'HIGH'
  drivers: DefaultRiskDriver[]
  /** Features the model expected but the input did not provide; scored as average. */
  missing: string[]
  model: { id: string; version: string; dataset: string; auc: number }
}

export function parsePdModel(json: unknown): PdModel {
  return PdModelSchema.parse(json)
}

const isMissing = (v: unknown): v is null | undefined => v === null || v === undefined || v === ''

function featureValue(f: PdModel['features'][number], raw: RiskFeatures): number | string | null {
  const s = f.source
  if (s.op === 'raw') {
    const v = raw[s.column]
    if (isMissing(v)) return null
    if (f.kind === 'categorical') return String(v)
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const num = raw[s.numerator]
  const den = raw[s.denominator]
  if (isMissing(num) || isMissing(den)) return null
  const n = Number(num)
  const d = Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d)) return null
  return d === 0 ? 0 : n / d
}

function contribution(f: PdModel['features'][number], value: number | string | null): number {
  if (value === null) return 0
  if (f.kind === 'numeric') {
    const [lo, hi] = f.clip
    const v = Math.min(Math.max(Number(value), lo), hi)
    return (f.coef * (v - f.mean)) / f.std
  }
  return (f.levels[String(value)] ?? 0) - f.baseline
}

export function scoreDefaultRisk(model: PdModel, raw: RiskFeatures, topN = 3): DefaultRiskResult {
  let logit = model.intercept
  const missing: string[] = []
  const all: DefaultRiskDriver[] = []
  for (const f of model.features) {
    const value = featureValue(f, raw)
    if (value === null) missing.push(f.name)
    const c = contribution(f, value)
    logit += c
    if (c !== 0) {
      all.push({ feature: f.name, label: f.label, contribution: c, direction: c > 0 ? 'RAISES_RISK' : 'LOWERS_RISK', value })
    }
  }
  const probability = 1 / (1 + Math.exp(-logit))
  const { medium, high } = model.bands
  return {
    advisory: true,
    probability,
    band: probability >= high ? 'HIGH' : probability >= medium ? 'MEDIUM' : 'LOW',
    drivers: all.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, topN),
    missing,
    model: { id: model.id, version: model.version, dataset: model.dataset.title, auc: model.metrics.test.auc },
  }
}
