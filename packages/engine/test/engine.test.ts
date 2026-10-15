import { describe, expect, it } from 'vitest'
import {
  DEFAULT_POLICY,
  amortizedEMI,
  canActAsChecker,
  checkerRequirements,
  evaluateApplication,
  parsePolicy,
  principalForEMI,
  type ApplicationInput,
  type CreditPolicy,
} from '../src'
import { loadPolicy } from './helpers'

const healthy: ApplicationInput = {
  requestedAmount: 1_000_000,
  requestedTenure: 24,
  borrower: { pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5', vintage: 48, industry: 'Manufacturing', annualTurnover: 7_200_000 },
  financial: { avgMonthlyInflow: 600_000, avgMonthlyExpenses: 420_000, freeCashFlow: 180_000, inflowVolatility: 0.18 },
  collateral: { type: 'MACHINERY', assessedValue: 1_500_000, ltv: 60, hasPersonalGuarantee: true },
}

const withPolicy = (changes: (p: CreditPolicy) => void): CreditPolicy => {
  const p = structuredClone(DEFAULT_POLICY)
  changes(p)
  return parsePolicy(p)
}

describe('loan maths', () => {
  it('computes a reducing-balance EMI', () => {
    // ₹10L at 14% for 24 months
    expect(amortizedEMI(1_000_000, 14, 24)).toBeCloseTo(48_012.89, 1)
  })

  it('principalForEMI is the inverse of amortizedEMI', () => {
    for (const [p, r, n] of [[500_000, 12, 12], [2_500_000, 18, 60], [100_000, 0, 6]]) {
      expect(principalForEMI(amortizedEMI(p, r, n), r, n)).toBeCloseTo(p, 4)
    }
  })

  it('amortized sizing accounts for interest; flat-factor does not', () => {
    const amortized = evaluateApplication(healthy, DEFAULT_POLICY)
    const legacy = evaluateApplication(healthy, loadPolicy('legacy-v0.1.yaml'))
    // max EMI = 180000 / 1.5 = 120000
    expect(amortized.cashFlowEligible).toBe(Math.round(principalForEMI(120_000, 14, 24)))
    expect(legacy.cashFlowEligible).toBe(Math.round(120_000 * 24 * 0.85))
    expect(amortized.emi).toBe(48_013)
    expect(legacy.emi).toBe(41_667)
  })
})

describe('evaluateApplication', () => {
  it('is deterministic', () => {
    expect(evaluateApplication(healthy, DEFAULT_POLICY)).toEqual(evaluateApplication(healthy, DEFAULT_POLICY))
  })

  it('approves a healthy secured application and explains why', () => {
    const r = evaluateApplication(healthy, DEFAULT_POLICY)
    expect(r.decision).toBe('APPROVE')
    expect(r.fraud.riskLevel).toBe('CLEAR')
    expect(r.approvalReasons).toContain('Low-risk industry: Manufacturing')
    expect(r.approvalReasons).toContain('Personal guarantee provided')
    expect(r.policy).toEqual({ id: 'credflow-default', version: '1.1.0' })
    expect(r.scoreBreakdown.total).toBe(
      r.scoreBreakdown.cashFlowScore + r.scoreBreakdown.coverageScore + r.scoreBreakdown.stabilityScore +
      r.scoreBreakdown.collateralScore + r.scoreBreakdown.profileScore
    )
  })

  it('never recommends more than requested', () => {
    const r = evaluateApplication({ ...healthy, requestedAmount: 100_000 }, DEFAULT_POLICY)
    expect(r.finalRecommendedAmt).toBeLessThanOrEqual(100_000)
  })

  it('applies the policy decision thresholds', () => {
    const score = evaluateApplication(healthy, DEFAULT_POLICY).creditScore
    expect(evaluateApplication(healthy, withPolicy(p => { p.decision.approveThreshold = score + 1 })).decision).toBe('REFER')
    expect(evaluateApplication(healthy, withPolicy(p => {
      p.decision.approveThreshold = score + 2
      p.decision.referThreshold = score + 1
    })).decision).toBe('REJECT')
  })

  it('applies the policy LTV limits', () => {
    const r = evaluateApplication(healthy, withPolicy(p => { p.collateral.ltvLimits.MACHINERY = 40 }))
    expect(r.collateralEligible).toBe(600_000)
  })

  it('applies industry bands, falling back to the default band', () => {
    const p = withPolicy(p => { p.industries.riskBands['Manufacturing'] = 'HIGH' })
    expect(evaluateApplication(healthy, p).riskFlags).toContain('High-risk industry: Manufacturing')
    const unknown = evaluateApplication({ ...healthy, borrower: { ...healthy.borrower, industry: 'Space Mining' } }, DEFAULT_POLICY)
    expect(unknown.industryRisk).toBe('MEDIUM')
  })
})

describe('fraud pre-checks', () => {
  const mismatch: ApplicationInput = { ...healthy, borrower: { ...healthy.borrower, gstin: '27ZZZZZ9999Z1Z5' } }

  it('a critical flag forces REJECT and zero recommended amount', () => {
    const r = evaluateApplication(mismatch, DEFAULT_POLICY)
    expect(r.fraud.riskLevel).toBe('HIGH_RISK')
    expect(r.decision).toBe('REJECT')
    expect(r.finalRecommendedAmt).toBe(0)
    expect(r.riskFlags[0]).toMatch(/^🚨 FRAUD: PAN \(ABCDE1234F\) does not match/)
  })

  it('rules can be downgraded or disabled by policy', () => {
    const downgraded = evaluateApplication(mismatch, withPolicy(p => { p.fraud.rules.panGstinMismatch.severity = 'WARNING' }))
    expect(downgraded.fraud.riskLevel).toBe('REVIEW')
    expect(downgraded.decision).toBe('APPROVE')

    const disabled = evaluateApplication(mismatch, withPolicy(p => { p.fraud.rules.panGstinMismatch.enabled = false }))
    expect(disabled.fraud.flags).toEqual([])
  })

  it('hard-stop severity is configurable', () => {
    const noIds = { ...healthy, borrower: { ...healthy.borrower, pan: null, gstin: null } }
    expect(evaluateApplication(noIds, DEFAULT_POLICY).decision).toBe('APPROVE')
    const strict = evaluateApplication(noIds, withPolicy(p => { p.fraud.hardStopSeverity = 'WARNING' }))
    expect(strict.decision).toBe('REJECT')
    expect(strict.fraud.summary).toMatch(/^1 warning-or-higher fraud signal/)
  })

  it('flags inflow spikes only with enough months of data', () => {
    const months = (n: number) => Array.from({ length: n }, (_, i) => ({ month: `M${i}`, inflow: i === 0 ? 2_000_000 : 500_000, outflow: 400_000 }))
    const spiky = (n: number) => evaluateApplication({ ...healthy, financial: { ...healthy.financial, monthlyData: months(n) } }, DEFAULT_POLICY)
    expect(spiky(2).fraud.flags.map(f => f.code)).not.toContain('FRAUD_INFLOW_SPIKE')
    expect(spiky(6).fraud.flags.map(f => f.code)).toContain('FRAUD_INFLOW_SPIKE')
  })
})

describe('bureau overlay', () => {
  it('missing bureau data does not change the score', () => {
    const r = evaluateApplication(healthy, DEFAULT_POLICY)
    expect(r.bureau.available).toBe(false)
    expect(r.creditScore).toBe(r.scoreBreakdown.total)
  })

  it('applies band and delinquency modifiers, and the decision uses the adjusted score', () => {
    const base = evaluateApplication(healthy, DEFAULT_POLICY).creditScore
    const good = evaluateApplication({ ...healthy, bureau: { score: 780 } }, DEFAULT_POLICY)
    expect(good.creditScore).toBe(Math.min(100, base + 5))
    const bad = evaluateApplication({ ...healthy, bureau: { score: 480, hasDelinquency: true } }, DEFAULT_POLICY)
    expect(bad.bureau.modifier).toBe(-17)
    expect(bad.creditScore).toBe(base - 17)
    expect(bad.decision).toBe(base - 17 >= 70 ? 'APPROVE' : base - 17 >= 50 ? 'REFER' : 'REJECT')
  })

  it('a bureau fraud alert drives the score to zero', () => {
    const r = evaluateApplication({ ...healthy, bureau: { score: 800, hasFraudAlert: true } }, DEFAULT_POLICY)
    expect(r.creditScore).toBe(0)
    expect(r.decision).toBe('REJECT')
  })
})

describe('docs/UNDERWRITING_EXPLAINED.md worked example', () => {
  it('matches the documented numbers', () => {
    const r = evaluateApplication({
      requestedAmount: 2_500_000,
      requestedTenure: 24,
      borrower: { pan: 'AAGCG1234K', gstin: '27AAGCG1234K1Z5', vintage: 48, industry: 'Manufacturing', annualTurnover: 9_600_000 },
      financial: { avgMonthlyInflow: 800_000, avgMonthlyExpenses: 550_000, freeCashFlow: 250_000, inflowVolatility: 0.18 },
      collateral: { type: 'MACHINERY', assessedValue: 3_000_000, ltv: 60, hasPersonalGuarantee: false },
    }, DEFAULT_POLICY)
    expect(r.scoreBreakdown).toEqual({ cashFlowScore: 20, coverageScore: 22, stabilityScore: 17, collateralScore: 7, profileScore: 9, total: 75 })
    expect(r.decision).toBe('APPROVE')
    expect(r.emi).toBe(120_032)
    expect(r.cashFlowEligible).toBe(3_471_291)
    expect(r.collateralEligible).toBe(1_800_000)
    expect(r.finalRecommendedAmt).toBe(1_980_000)
    expect(r.riskFlags).toEqual([])
    expect(r.fraud.riskLevel).toBe('CLEAR')
  })
})

describe('maker-checker', () => {
  it('requires a checker above the amount limit and for overrides', () => {
    // credflow-default: checker above ₹25L and for overrides
    expect(checkerRequirements(DEFAULT_POLICY, { sanctionedAmount: 2_500_000, isOverride: false })).toEqual([])
    expect(checkerRequirements(DEFAULT_POLICY, { sanctionedAmount: 2_500_001, isOverride: false })).toEqual([
      'Sanction of ₹25.0L exceeds the single-approver limit of ₹25.0L',
    ])
    expect(checkerRequirements(DEFAULT_POLICY, { sanctionedAmount: 100_000, isOverride: true })).toEqual([
      'Decision overrides the system recommendation',
    ])
  })

  it('defaults to no checker when a policy has no approvals section', () => {
    const legacy = loadPolicy('legacy-v0.1.yaml')
    expect(legacy.approvals).toEqual({ checkerRequiredAbove: null, checkerRequiredForOverrides: false, checkerRoles: ['ADMIN'] })
    expect(checkerRequirements(legacy, { sanctionedAmount: 1e9, isOverride: true })).toEqual([])
  })

  it('the checker must be a different user with an allowed role', () => {
    expect(canActAsChecker(DEFAULT_POLICY, { userId: 'b', role: 'ADMIN' }, 'a')).toBe(true)
    expect(canActAsChecker(DEFAULT_POLICY, { userId: 'a', role: 'ADMIN' }, 'a')).toBe(false)
    expect(canActAsChecker(DEFAULT_POLICY, { userId: 'b', role: 'ANALYST' }, 'a')).toBe(false)
    expect(canActAsChecker(DEFAULT_POLICY, { userId: 'b', role: 'VIEWER' }, 'a')).toBe(false)
  })
})

describe('verification-based fraud rules', () => {
  it('flag a cancelled GSTIN and an unverified PAN as critical', () => {
    const r = evaluateApplication({ ...healthy, verifications: { gstinStatus: 'CANCELLED', panValid: false } }, DEFAULT_POLICY)
    expect(r.fraud.flags.map(f => f.code)).toEqual(['FRAUD_GSTIN_NOT_ACTIVE', 'FRAUD_PAN_NOT_VERIFIED'])
    expect(r.fraud.flags[0].description).toBe('GSTIN 27ABCDE1234F1Z5 is cancelled on the GST network')
    expect(r.decision).toBe('REJECT')
  })

  it('do nothing when verification passes or was not performed', () => {
    expect(evaluateApplication({ ...healthy, verifications: { gstinStatus: 'ACTIVE', panValid: true } }, DEFAULT_POLICY).fraud.flags).toEqual([])
    expect(evaluateApplication(healthy, DEFAULT_POLICY).fraud.flags).toEqual([])
  })
})
