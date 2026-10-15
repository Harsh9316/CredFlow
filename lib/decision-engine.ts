// Credit Decision Engine
// Rule-based scoring with explainable outputs

export type CollateralType = 'LAP' | 'MACHINERY' | 'INVOICE' | 'STOCK' | 'FD' | 'NONE'
export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH'

export type FinancialMetrics = {
  avgMonthlyInflow: number
  avgMonthlyExpenses: number
  freeCashFlow: number
  inflowVolatility: number // CV (Coefficient of Variation)
  emiCoverageRatio: number
}

export type CollateralInfo = {
  type: CollateralType
  assessedValue: number
  ltv: number
  hasPersonalGuarantee: boolean
}

export type BorrowerProfile = {
  vintage: number // months
  industry: string
  annualTurnover?: number
}

export type DecisionInputs = {
  requestedAmount: number
  requestedTenure: number
  financial: FinancialMetrics
  collateral: CollateralInfo | null
  borrower: BorrowerProfile
}

export type ScoreBreakdown = {
  cashFlowScore: number    // 0-30
  coverageScore: number    // 0-25
  stabilityScore: number   // 0-20
  collateralScore: number  // 0-15
  profileScore: number     // 0-10
  total: number            // 0-100
}

export type DecisionOutput = {
  creditScore: number
  decision: 'APPROVE' | 'REFER' | 'REJECT'
  cashFlowEligible: number
  collateralEligible: number
  finalRecommendedAmt: number
  scoreBreakdown: ScoreBreakdown
  approvalReasons: string[]
  riskFlags: string[]
  recommendations: string[]
}

export type EngineConfig = {
  approveThreshold: number
  referThreshold: number
  minEMICoverage: number
  maxInflowCV: number
  minBusinessVintage: number
  ltvLimits: Record<CollateralType, number>
  industryRiskBands: Record<string, RiskBand>
}

// Configuration defaults (overridden per NBFC via the Settings table, see lib/policy.ts)
export const DEFAULT_CONFIG: EngineConfig = {
  approveThreshold: 70,
  referThreshold: 50,
  minEMICoverage: 1.5,
  maxInflowCV: 0.5,
  minBusinessVintage: 12,
  ltvLimits: {
    LAP: 70,
    MACHINERY: 60,
    INVOICE: 80,
    STOCK: 50,
    FD: 90,
    NONE: 0
  },
  industryRiskBands: {
    'Manufacturing': 'LOW',
    'IT Services': 'LOW',
    'Healthcare': 'LOW',
    'Retail': 'MEDIUM',
    'Construction': 'MEDIUM',
    'Agriculture': 'MEDIUM',
    'Real Estate': 'HIGH',
    'Hospitality': 'HIGH',
    'Trading': 'MEDIUM'
  }
}

export function calculateCashFlowEligibility(
  freeCashFlow: number,
  requestedTenure: number,
  minEMICoverage: number = DEFAULT_CONFIG.minEMICoverage
): number {
  // Calculate max EMI borrower can afford
  const maxEMI = freeCashFlow / minEMICoverage
  
  // Simple calculation: eligible amount = maxEMI * tenure * factor
  // Using a simplified EMI-to-Principal factor (assumes ~12% interest rate)
  const emiFactor = requestedTenure * 0.85
  
  return Math.max(0, Math.round(maxEMI * emiFactor))
}

export function calculateCollateralEligibility(
  collateral: CollateralInfo | null,
  ltvLimits: Record<CollateralType, number> = DEFAULT_CONFIG.ltvLimits
): number {
  if (!collateral || collateral.type === 'NONE') {
    return 0
  }
  
  const effectiveLTV = Math.min(
    collateral.ltv,
    ltvLimits[collateral.type] ?? 0
  )
  
  return Math.round(collateral.assessedValue * (effectiveLTV / 100))
}

export function calculateScoreBreakdown(
  inputs: DecisionInputs,
  config: EngineConfig = DEFAULT_CONFIG
): ScoreBreakdown {
  const { financial, collateral, borrower, requestedAmount } = inputs
  
  // 1. Cash Flow Score (0-30)
  let cashFlowScore = 0
  const fcfRatio = financial.freeCashFlow / (requestedAmount / 12)
  if (fcfRatio >= 2) cashFlowScore = 30
  else if (fcfRatio >= 1.5) cashFlowScore = 25
  else if (fcfRatio >= 1.2) cashFlowScore = 20
  else if (fcfRatio >= 1) cashFlowScore = 15
  else if (fcfRatio >= 0.8) cashFlowScore = 10
  else cashFlowScore = 5
  
  // 2. EMI Coverage Score (0-25)
  let coverageScore = 0
  const coverage = financial.emiCoverageRatio
  if (coverage >= 2.5) coverageScore = 25
  else if (coverage >= 2) coverageScore = 22
  else if (coverage >= 1.75) coverageScore = 18
  else if (coverage >= 1.5) coverageScore = 15
  else if (coverage >= 1.25) coverageScore = 10
  else coverageScore = 5
  
  // 3. Stability Score based on volatility (0-20)
  let stabilityScore = 0
  const cv = financial.inflowVolatility
  if (cv <= 0.15) stabilityScore = 20
  else if (cv <= 0.25) stabilityScore = 17
  else if (cv <= 0.35) stabilityScore = 14
  else if (cv <= 0.5) stabilityScore = 10
  else stabilityScore = 5
  
  // 4. Collateral Score (0-15)
  let collateralScore = 0
  if (collateral && collateral.type !== 'NONE') {
    const collateralCap = calculateCollateralEligibility(collateral, config.ltvLimits)
    const collateralCoverage = collateralCap / requestedAmount
    
    if (collateralCoverage >= 1.2) collateralScore = 15
    else if (collateralCoverage >= 1) collateralScore = 12
    else if (collateralCoverage >= 0.8) collateralScore = 10
    else if (collateralCoverage >= 0.5) collateralScore = 7
    else collateralScore = 4
    
    // Bonus for certain collateral types
    if (collateral.type === 'LAP' || collateral.type === 'FD') {
      collateralScore = Math.min(15, collateralScore + 2)
    }
    
    // Bonus for personal guarantee
    if (collateral.hasPersonalGuarantee) {
      collateralScore = Math.min(15, collateralScore + 1)
    }
  }
  
  // 5. Business Profile Score (0-10)
  let profileScore = 0
  
  // Vintage component (0-5)
  if (borrower.vintage >= 60) profileScore += 5
  else if (borrower.vintage >= 36) profileScore += 4
  else if (borrower.vintage >= 24) profileScore += 3
  else if (borrower.vintage >= 12) profileScore += 2
  else profileScore += 1
  
  // Industry risk component (0-5)
  const industryRisk = config.industryRiskBands[borrower.industry] || 'MEDIUM'
  if (industryRisk === 'LOW') profileScore += 5
  else if (industryRisk === 'MEDIUM') profileScore += 3
  else profileScore += 1
  
  const total = cashFlowScore + coverageScore + stabilityScore + collateralScore + profileScore
  
  return {
    cashFlowScore,
    coverageScore,
    stabilityScore,
    collateralScore,
    profileScore,
    total
  }
}

export function generateDecision(
  inputs: DecisionInputs,
  config: EngineConfig = DEFAULT_CONFIG
): DecisionOutput {
  const scoreBreakdown = calculateScoreBreakdown(inputs, config)
  const creditScore = scoreBreakdown.total
  
  // Calculate eligibility amounts
  const cashFlowEligible = calculateCashFlowEligibility(
    inputs.financial.freeCashFlow,
    inputs.requestedTenure,
    config.minEMICoverage
  )
  
  const collateralEligible = calculateCollateralEligibility(inputs.collateral, config.ltvLimits)
  
  // Final recommended amount is lower of:
  // - Cash flow eligible
  // - Collateral eligible (if secured) + some unsecured component
  // - Requested amount
  let finalRecommendedAmt: number
  
  if (collateralEligible > 0) {
    // For secured loans: min of cash flow, collateral cap, requested
    finalRecommendedAmt = Math.min(
      cashFlowEligible,
      collateralEligible * 1.1, // Allow 10% above collateral for strong cash flow
      inputs.requestedAmount
    )
  } else {
    // For unsecured: min of cash flow eligible, requested
    finalRecommendedAmt = Math.min(
      cashFlowEligible * 0.8, // More conservative for unsecured
      inputs.requestedAmount
    )
  }
  
  finalRecommendedAmt = Math.max(0, Math.round(finalRecommendedAmt))
  
  // Determine decision
  let decision: 'APPROVE' | 'REFER' | 'REJECT'
  if (creditScore >= config.approveThreshold) {
    decision = 'APPROVE'
  } else if (creditScore >= config.referThreshold) {
    decision = 'REFER'
  } else {
    decision = 'REJECT'
  }
  
  // Generate approval reasons
  const approvalReasons: string[] = []
  const riskFlags: string[] = []
  const recommendations: string[] = []
  
  // Cash flow related
  if (inputs.financial.emiCoverageRatio >= 2) {
    approvalReasons.push('Strong EMI coverage ratio (≥2x)')
  } else if (inputs.financial.emiCoverageRatio >= config.minEMICoverage) {
    approvalReasons.push(`Adequate EMI coverage ratio (≥${config.minEMICoverage}x)`)
  } else {
    riskFlags.push(`Low EMI coverage ratio (${inputs.financial.emiCoverageRatio.toFixed(2)}x)`)
  }
  
  if (inputs.financial.freeCashFlow > 0) {
    approvalReasons.push(`Positive free cash flow (₹${(inputs.financial.freeCashFlow / 100000).toFixed(1)}L/month)`)
  } else {
    riskFlags.push('Negative or zero free cash flow')
  }
  
  // Volatility
  if (inputs.financial.inflowVolatility <= 0.25) {
    approvalReasons.push('Stable cash inflows with low volatility')
  } else if (inputs.financial.inflowVolatility > config.maxInflowCV) {
    riskFlags.push(`High inflow volatility (CV: ${(inputs.financial.inflowVolatility * 100).toFixed(0)}%)`)
  }
  
  // Collateral
  if (inputs.collateral && inputs.collateral.type !== 'NONE') {
    approvalReasons.push(`Secured by ${inputs.collateral.type.replace('_', ' ')} worth ₹${(inputs.collateral.assessedValue / 100000).toFixed(1)}L`)
    
    if (collateralEligible >= inputs.requestedAmount) {
      approvalReasons.push('Full collateral coverage for requested amount')
    } else if (collateralEligible > 0) {
      recommendations.push(`Consider limiting sanction to ₹${(collateralEligible / 100000).toFixed(1)}L for full collateral coverage`)
    }
    
    if (inputs.collateral.hasPersonalGuarantee) {
      approvalReasons.push('Personal guarantee provided')
    }
  } else {
    if (decision !== 'REJECT') {
      riskFlags.push('Unsecured exposure - no collateral provided')
      recommendations.push('Consider obtaining collateral to improve risk profile')
    }
  }
  
  // Business profile
  if (inputs.borrower.vintage >= 36) {
    approvalReasons.push(`Established business with ${Math.floor(inputs.borrower.vintage / 12)}+ years vintage`)
  } else if (inputs.borrower.vintage < config.minBusinessVintage) {
    riskFlags.push(`Business vintage below policy minimum of ${config.minBusinessVintage} months`)
    recommendations.push('Consider shorter tenure or lower quantum for newer businesses')
  }
  
  // Industry
  const industryRisk = config.industryRiskBands[inputs.borrower.industry] || 'MEDIUM'
  if (industryRisk === 'LOW') {
    approvalReasons.push(`Low-risk industry: ${inputs.borrower.industry}`)
  } else if (industryRisk === 'HIGH') {
    riskFlags.push(`High-risk industry: ${inputs.borrower.industry}`)
    recommendations.push('Enhanced monitoring recommended for this industry segment')
  }
  
  // Amount recommendations
  if (finalRecommendedAmt < inputs.requestedAmount) {
    recommendations.push(
      `Recommended amount (₹${(finalRecommendedAmt / 100000).toFixed(1)}L) is lower than requested (₹${(inputs.requestedAmount / 100000).toFixed(1)}L) based on eligibility`
    )
  }
  
  return {
    creditScore,
    decision,
    cashFlowEligible,
    collateralEligible,
    finalRecommendedAmt,
    scoreBreakdown,
    approvalReasons,
    riskFlags,
    recommendations
  }
}
