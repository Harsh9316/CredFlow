export { evaluateApplication } from './evaluate'
export { runFraudChecks } from './fraud'
export { applyBureauOverlay } from './bureau'
export { checkerRequirements, canActAsChecker } from './approvals'
export { ApplicationInputSchema, parseApplicationInput } from './input'
export {
  amortizedEMI,
  principalForEMI,
  monthlyEMI,
  calculateCashFlowEligibility,
  calculateCollateralEligibility,
  calculateScoreBreakdown,
  industryRisk,
} from './scoring'
export {
  CreditPolicySchema,
  PolicyValidationError,
  parsePolicy,
  COLLATERAL_TYPES,
  RISK_BANDS,
  SEVERITIES,
  type CreditPolicy,
  type CreditPolicyInput,
  type CollateralType,
  type RiskBand,
  type Severity,
} from './policy'
export type {
  ApplicationInput,
  BureauOverlayResult,
  Decision,
  Evaluation,
  FraudCheckResult,
  FraudFlag,
  MonthlyFlow,
  ScoreBreakdown,
} from './types'

import { DEFAULT_POLICY_INPUT } from './default-policy'
import { parsePolicy } from './policy'

/** Credrail's default MSME policy (policies/credrail-default.yaml), validated. */
export const DEFAULT_POLICY = parsePolicy(DEFAULT_POLICY_INPUT)
