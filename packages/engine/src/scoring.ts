import type { CollateralType, CreditPolicy, RiskBand } from './policy'
import type { ApplicationInput, ScoreBreakdown } from './types'

type Band = { threshold: number; points: number }

function scoreBands(value: number, bands: Band[], otherwise: number, direction: 'higher-is-better' | 'lower-is-better'): number {
  const hit = bands.find(b => (direction === 'higher-is-better' ? value >= b.threshold : value <= b.threshold))
  return hit ? hit.points : otherwise
}

/** Standard reducing-balance instalment. */
export function amortizedEMI(principal: number, annualRatePercent: number, months: number): number {
  const r = annualRatePercent / 12 / 100
  if (r === 0) return principal / months
  return (principal * r) / (1 - Math.pow(1 + r, -months))
}

/** Principal that a given EMI can service. Inverse of amortizedEMI. */
export function principalForEMI(emi: number, annualRatePercent: number, months: number): number {
  const r = annualRatePercent / 12 / 100
  if (r === 0) return emi * months
  return (emi * (1 - Math.pow(1 + r, -months))) / r
}

export function monthlyEMI(amount: number, tenure: number, policy: CreditPolicy): number {
  const a = policy.affordability
  return a.method === 'amortized' ? amortizedEMI(amount, a.annualInterestRate, tenure) : amount / tenure
}

export function calculateCashFlowEligibility(freeCashFlow: number, tenure: number, policy: CreditPolicy): number {
  const a = policy.affordability
  const maxEMI = freeCashFlow / a.minEMICoverage
  const principal = a.method === 'amortized'
    ? principalForEMI(maxEMI, a.annualInterestRate, tenure)
    : maxEMI * tenure * a.flatFactor
  return Math.max(0, Math.round(principal))
}

export function calculateCollateralEligibility(collateral: ApplicationInput['collateral'], policy: CreditPolicy): number {
  if (!collateral || collateral.type === 'NONE') return 0
  const limit = policy.collateral.ltvLimits[collateral.type as CollateralType] ?? 0
  const effectiveLTV = Math.min(collateral.ltv, limit)
  return Math.round(collateral.assessedValue * (effectiveLTV / 100))
}

export function industryRisk(industry: string, policy: CreditPolicy): RiskBand {
  return policy.industries.riskBands[industry] ?? policy.industries.defaultBand
}

export function calculateScoreBreakdown(
  input: ApplicationInput,
  emiCoverageRatio: number,
  collateralEligible: number,
  policy: CreditPolicy
): ScoreBreakdown {
  const s = policy.scoring
  const { financial, collateral, borrower, requestedAmount } = input

  const fcfRatio = financial.freeCashFlow / (requestedAmount / 12)
  const cashFlowScore = scoreBands(fcfRatio, s.cashFlow.bands, s.cashFlow.otherwise, s.cashFlow.direction)
  const coverageScore = scoreBands(emiCoverageRatio, s.emiCoverage.bands, s.emiCoverage.otherwise, s.emiCoverage.direction)
  const stabilityScore = scoreBands(financial.inflowVolatility, s.stability.bands, s.stability.otherwise, s.stability.direction)

  let collateralScore = 0
  if (collateral && collateral.type !== 'NONE') {
    const c = s.collateral
    collateralScore = scoreBands(collateralEligible / requestedAmount, c.coverageBands, c.otherwise, 'higher-is-better')
    if (c.preferredTypes.includes(collateral.type)) collateralScore += c.preferredTypeBonus
    if (collateral.hasPersonalGuarantee) collateralScore += c.personalGuaranteeBonus
    collateralScore = Math.min(c.max, collateralScore)
  }

  const p = s.profile
  const profileScore = Math.min(
    p.max,
    scoreBands(borrower.vintage, p.vintageBands, p.vintageOtherwise, 'higher-is-better') +
      p.industryPoints[industryRisk(borrower.industry, policy)]
  )

  return {
    cashFlowScore,
    coverageScore,
    stabilityScore,
    collateralScore,
    profileScore,
    total: cashFlowScore + coverageScore + stabilityScore + collateralScore + profileScore,
  }
}
