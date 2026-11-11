import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY,
  evaluateApplication,
  parsePdModel,
  scoreDefaultRisk,
  type ApplicationInput,
  type RiskFeatures,
} from '../src'

const MODELS_DIR = fileURLToPath(new URL('../../../ml/models/', import.meta.url))
const readJson = (file: string): unknown => JSON.parse(readFileSync(MODELS_DIR + file, 'utf8'))

const model = parsePdModel(readJson('uci-taiwan.json'))
const parity = readJson('uci-taiwan.parity.json') as { rows: RiskFeatures[]; probabilities: number[] }

const application: ApplicationInput = {
  requestedAmount: 1_000_000,
  requestedTenure: 24,
  borrower: { vintage: 48, industry: 'Manufacturing' },
  financial: { avgMonthlyInflow: 600_000, avgMonthlyExpenses: 420_000, freeCashFlow: 180_000, inflowVolatility: 0.18 },
  collateral: { type: 'MACHINERY', assessedValue: 1_500_000, ltv: 60, hasPersonalGuarantee: true },
}

describe('probability-of-default model', () => {
  it('reproduces the probabilities computed in Python', () => {
    expect(parity.rows.length).toBeGreaterThan(10)
    parity.rows.forEach((row, i) => {
      expect(scoreDefaultRisk(model, row).probability).toBeCloseTo(parity.probabilities[i], 9)
    })
  })

  it('ranks a repeatedly late account above one that pays in full', () => {
    const late = scoreDefaultRisk(model, { ...parity.rows[0], PAY_0: 2, PAY_2: 2, PAY_3: 2 })
    const clean = scoreDefaultRisk(model, { ...parity.rows[0], PAY_0: -1, PAY_2: -1, PAY_3: -1 })
    expect(late.probability).toBeGreaterThan(clean.probability)
    expect(late.drivers[0].direction).toBe('RAISES_RISK')
  })

  it('scores missing inputs as an average applicant and lists them', () => {
    const result = scoreDefaultRisk(model, {})
    expect(result.missing).toHaveLength(model.features.length)
    expect(result.drivers).toEqual([])
    expect(result.probability).toBeCloseTo(1 / (1 + Math.exp(-model.intercept)), 12)
  })

  it('rejects a model file with the wrong schema', () => {
    expect(() => parsePdModel({ ...model, advisoryOnly: false })).toThrow()
  })
})

describe('evaluateApplication with a PD model', () => {
  it('adds defaultRisk without changing the policy outcome', () => {
    const base = evaluateApplication(application, DEFAULT_POLICY)
    const risky = { ...application, riskFeatures: { ...parity.rows[0], PAY_0: 2, PAY_2: 2, PAY_3: 2, PAY_4: 2 } }
    const withModel = evaluateApplication(risky, DEFAULT_POLICY, { pdModel: model })

    expect(withModel.defaultRisk?.advisory).toBe(true)
    expect(withModel.defaultRisk?.band).toBe('HIGH')
    // Everything except the advisory block is identical to the run without a model.
    expect({ ...withModel, defaultRisk: undefined }).toEqual(base)
  })

  it('omits defaultRisk when there is no model or no riskFeatures', () => {
    expect(evaluateApplication(application, DEFAULT_POLICY, { pdModel: model }).defaultRisk).toBeUndefined()
    expect(evaluateApplication({ ...application, riskFeatures: parity.rows[0] }, DEFAULT_POLICY).defaultRisk).toBeUndefined()
  })
})
