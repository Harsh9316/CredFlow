// Runs the full underwriting pipeline for one application:
//   1. fraud pre-checks  2. bureau overlay  3. credit score  4. loan sizing  5. explanations
// Pure and deterministic: same input + same policy => same output.

import type { CreditPolicy } from './policy'
import type { ApplicationInput, Decision, Evaluation } from './types'
import { atLeast, runFraudChecks } from './fraud'
import { applyBureauOverlay } from './bureau'
import {
  calculateCashFlowEligibility,
  calculateCollateralEligibility,
  calculateScoreBreakdown,
  industryRisk,
  monthlyEMI,
} from './scoring'
import { lakh } from './format'

export function evaluateApplication(input: ApplicationInput, policy: CreditPolicy): Evaluation {
  const fraud = runFraudChecks(input, policy)
  const bureau = applyBureauOverlay(input.bureau, policy)

  const { financial, collateral, borrower, requestedAmount, requestedTenure } = input
  const emi = monthlyEMI(requestedAmount, requestedTenure, policy)
  const emiCoverageRatio = financial.freeCashFlow ? financial.freeCashFlow / emi : 0

  const cashFlowEligible = calculateCashFlowEligibility(financial.freeCashFlow, requestedTenure, policy)
  const collateralEligible = calculateCollateralEligibility(collateral, policy)
  const scoreBreakdown = calculateScoreBreakdown(input, emiCoverageRatio, collateralEligible, policy)
  const creditScore = Math.max(0, Math.min(100, scoreBreakdown.total + bureau.modifier))

  // Lower of what cash flow supports, what collateral covers (with headroom) and what was asked for
  const a = policy.affordability
  const sizedAmount = Math.max(0, Math.round(
    collateralEligible > 0
      ? Math.min(cashFlowEligible, collateralEligible * a.collateralHeadroom, requestedAmount)
      : Math.min(cashFlowEligible * a.unsecuredHaircut, requestedAmount)
  ))

  const { approveThreshold, referThreshold } = policy.decision
  const scoreDecision: Decision =
    creditScore >= approveThreshold ? 'APPROVE' : creditScore >= referThreshold ? 'REFER' : 'REJECT'

  const fraudHardStop = fraud.riskLevel === 'HIGH_RISK'
  const decision: Decision = fraudHardStop ? 'REJECT' : scoreDecision

  // ── Explanations ──
  const e = policy.explanations
  const approvalReasons: string[] = []
  const riskFlags: string[] = []
  const recommendations: string[] = []

  if (emiCoverageRatio >= e.strongEMICoverage) {
    approvalReasons.push(`Strong EMI coverage ratio (≥${e.strongEMICoverage}x)`)
  } else if (emiCoverageRatio >= a.minEMICoverage) {
    approvalReasons.push(`Adequate EMI coverage ratio (≥${a.minEMICoverage}x)`)
  } else {
    riskFlags.push(`Low EMI coverage ratio (${emiCoverageRatio.toFixed(2)}x)`)
  }

  if (financial.freeCashFlow > 0) {
    approvalReasons.push(`Positive free cash flow (${lakh(financial.freeCashFlow)}/month)`)
  } else {
    riskFlags.push('Negative or zero free cash flow')
  }

  if (financial.inflowVolatility <= e.stableInflowCV) {
    approvalReasons.push('Stable cash inflows with low volatility')
  } else if (financial.inflowVolatility > e.maxInflowCV) {
    riskFlags.push(`High inflow volatility (CV: ${(financial.inflowVolatility * 100).toFixed(0)}%)`)
  }

  if (collateral && collateral.type !== 'NONE') {
    approvalReasons.push(`Secured by ${collateral.type.replace('_', ' ')} worth ${lakh(collateral.assessedValue)}`)
    if (collateralEligible >= requestedAmount) {
      approvalReasons.push('Full collateral coverage for requested amount')
    } else if (collateralEligible > 0) {
      recommendations.push(`Consider limiting sanction to ${lakh(collateralEligible)} for full collateral coverage`)
    }
    if (collateral.hasPersonalGuarantee) {
      approvalReasons.push('Personal guarantee provided')
    }
  } else if (scoreDecision !== 'REJECT') {
    riskFlags.push('Unsecured exposure - no collateral provided')
    recommendations.push('Consider obtaining collateral to improve risk profile')
  }

  if (borrower.vintage >= e.establishedVintageMonths) {
    approvalReasons.push(`Established business with ${Math.floor(borrower.vintage / 12)}+ years vintage`)
  } else if (borrower.vintage < e.minBusinessVintageMonths) {
    riskFlags.push(`Business vintage below policy minimum of ${e.minBusinessVintageMonths} months`)
    recommendations.push('Consider shorter tenure or lower quantum for newer businesses')
  }

  const risk = industryRisk(borrower.industry, policy)
  if (risk === 'LOW') {
    approvalReasons.push(`Low-risk industry: ${borrower.industry}`)
  } else if (risk === 'HIGH') {
    riskFlags.push(`High-risk industry: ${borrower.industry}`)
    recommendations.push('Enhanced monitoring recommended for this industry segment')
  }

  if (sizedAmount < requestedAmount) {
    recommendations.push(
      `Recommended amount (${lakh(sizedAmount)}) is lower than requested (${lakh(requestedAmount)}) based on eligibility`
    )
  }

  // Fraud findings lead the risk flags when they block the application
  for (const f of fraud.flags) {
    if (atLeast(f.severity, policy.fraud.hardStopSeverity)) {
      riskFlags.unshift(`🚨 FRAUD: ${f.description}`)
    } else {
      riskFlags.push(`⚠ Fraud Check: ${f.description}`)
    }
    recommendations.push(f.recommendation)
  }
  recommendations.push(...bureau.notes)

  return {
    decision,
    creditScore,
    scoreBreakdown,
    emi: Math.round(emi),
    emiCoverageRatio,
    cashFlowEligible,
    collateralEligible,
    finalRecommendedAmt: fraudHardStop ? 0 : sizedAmount,
    industryRisk: risk,
    approvalReasons,
    riskFlags,
    recommendations,
    fraud,
    bureau,
    policy: { id: policy.id, version: policy.version },
  }
}
