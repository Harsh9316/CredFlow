import type { CollateralType, RiskBand, Severity } from './policy'

export type MonthlyFlow = { month: string; inflow: number; outflow: number }

export type ApplicationInput = {
  requestedAmount: number
  /** Months. */
  requestedTenure: number
  borrower: {
    pan?: string | null
    gstin?: string | null
    /** Months in business. */
    vintage: number
    industry: string
    annualTurnover?: number | null
  }
  financial: {
    avgMonthlyInflow: number
    avgMonthlyExpenses: number
    freeCashFlow: number
    /** Coefficient of variation of monthly inflows (0.2 = 20%). */
    inflowVolatility: number
    monthlyData?: MonthlyFlow[]
  }
  collateral?: {
    type: CollateralType
    assessedValue: number
    /** Requested LTV, percent. Capped at the policy limit for the collateral type. */
    ltv: number
    hasPersonalGuarantee: boolean
  } | null
  bureau?: {
    /** Score where higher is better (e.g. a 300-900 bureau score). */
    score?: number | null
    /** Commercial rank where 1 is the lowest risk (e.g. CIBIL MSME Rank, 1-10). Used when no score is given. */
    rank?: number | null
    hasDelinquency?: boolean
    hasFraudAlert?: boolean
  } | null
  /** Results from GST / PAN verification providers, when available. */
  verifications?: {
    gstinStatus?: 'ACTIVE' | 'CANCELLED' | 'SUSPENDED' | 'NOT_FOUND'
    panValid?: boolean
    /** 0-1 similarity between the name on the PAN and the business's legal name. */
    panNameMatch?: number
  } | null
}

export type Decision = 'APPROVE' | 'REFER' | 'REJECT'

export type FraudFlag = {
  code: string
  severity: Severity
  description: string
  recommendation: string
}

export type FraudCheckResult = {
  passed: boolean
  riskLevel: 'CLEAR' | 'REVIEW' | 'HIGH_RISK'
  flags: FraudFlag[]
  summary: string
}

export type BureauOverlayResult = {
  available: boolean
  bureauScore?: number
  bureauRank?: number
  delinquencyFlag: boolean
  fraudAlert: boolean
  modifier: number
  notes: string[]
}

export type ScoreBreakdown = {
  cashFlowScore: number
  coverageScore: number
  stabilityScore: number
  collateralScore: number
  profileScore: number
  total: number
}

export type Evaluation = {
  decision: Decision
  /** Score after the bureau modifier, clamped to 0-100. */
  creditScore: number
  scoreBreakdown: ScoreBreakdown
  emi: number
  emiCoverageRatio: number
  cashFlowEligible: number
  collateralEligible: number
  finalRecommendedAmt: number
  industryRisk: RiskBand
  approvalReasons: string[]
  riskFlags: string[]
  recommendations: string[]
  fraud: FraudCheckResult
  bureau: BureauOverlayResult
  policy: { id: string; version: string }
}
