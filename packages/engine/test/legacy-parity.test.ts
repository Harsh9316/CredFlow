// The engine running policies/legacy-v0.1.yaml must reproduce, field for field, what the
// hard-coded v0.1 engine returned. Fixtures come from test/generate-legacy-golden.ts.
import { describe, expect, it } from 'vitest'
import golden from './fixtures/legacy-golden.json'
import { evaluateApplication, type ApplicationInput } from '../src'
import { loadPolicy } from './helpers'

const legacy = loadPolicy('legacy-v0.1.yaml')

describe('legacy v0.1 parity', () => {
  it('has a meaningful spread of cases', () => {
    const decisions = new Set(golden.map(g => g.expected.decision))
    expect(golden.length).toBeGreaterThanOrEqual(500)
    expect(decisions).toEqual(new Set(['APPROVE', 'REFER', 'REJECT']))
  })

  it.each(golden.map((g, i) => [i, g] as const))('case %i matches', (_i, { input, expected }) => {
    const result = evaluateApplication(input as ApplicationInput, legacy)
    expect({
      creditScore: result.creditScore,
      decision: result.decision,
      scoreBreakdown: result.scoreBreakdown,
      cashFlowEligible: result.cashFlowEligible,
      collateralEligible: result.collateralEligible,
      finalRecommendedAmt: result.finalRecommendedAmt,
      emiCoverageRatio: result.emiCoverageRatio,
      approvalReasons: result.approvalReasons,
      riskFlags: result.riskFlags,
      recommendations: result.recommendations,
      fraud: result.fraud,
    }).toEqual(expected)
  })
})
