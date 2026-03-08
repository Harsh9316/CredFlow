// Fraud Pre-Check Module
// Identifies fraud signals BEFORE credit assessment
// Fraud risk = must reject. Credit risk = can price.

export type FraudCheckResult = {
  passed: boolean
  riskLevel: 'CLEAR' | 'REVIEW' | 'HIGH_RISK'
  flags: FraudFlag[]
  summary: string
}

export type FraudFlag = {
  code: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  description: string
  recommendation: string
}

type FraudCheckInputs = {
  borrower: {
    pan?: string | null
    gstin?: string | null
    businessName: string
    vintage: number
    annualTurnover?: number | null
  }
  financial: {
    avgMonthlyInflow: number
    avgMonthlyExpenses: number
    inflowVolatility: number
    monthlyData?: { month: string; inflow: number; outflow: number }[]
  }
  requestedAmount: number
  existingBorrowerIds?: string[] // For duplicate detection
}

/**
 * Run fraud pre-checks on a loan application.
 * These checks happen BEFORE credit scoring.
 * 
 * Fraud signals → mandatory reject / escalation
 * Credit risk  → can be priced via scoring engine
 */
/**
 * Run fraud pre-checks on application inputs.
 * 
 * Ownership: Fraud signals are advisory to the analyst except HIGH_RISK flags,
 * which enforce a system-level rejection recommendation. Analysts may still
 * override via the approval workflow (with mandatory override reason).
 */
export function runFraudPreChecks(inputs: FraudCheckInputs): FraudCheckResult {
  const flags: FraudFlag[] = []

  // ── Check 1: PAN/GSTIN Consistency ──
  if (inputs.borrower.pan && inputs.borrower.gstin) {
    // GSTIN contains PAN at positions 2-11
    const panFromGstin = inputs.borrower.gstin.substring(2, 12)
    if (panFromGstin !== inputs.borrower.pan) {
      flags.push({
        code: 'FRAUD_PAN_GSTIN_MISMATCH',
        severity: 'CRITICAL',
        description: `PAN (${inputs.borrower.pan}) does not match PAN embedded in GSTIN (${panFromGstin})`,
        recommendation: 'Verify identity documents. Possible identity fraud.'
      })
    }
  }

  // ── Check 2: Missing identity documents ──
  if (!inputs.borrower.pan && !inputs.borrower.gstin) {
    flags.push({
      code: 'FRAUD_NO_IDENTITY_DOCS',
      severity: 'WARNING',
      description: 'Neither PAN nor GSTIN provided',
      recommendation: 'Request at least one government-issued business identity document.'
    })
  }

  // ── Check 3: Abnormal inflow spikes ──
  if (inputs.financial.monthlyData && inputs.financial.monthlyData.length >= 3) {
    const avgInflow = inputs.financial.avgMonthlyInflow
    const spikeMonths = inputs.financial.monthlyData.filter(
      m => m.inflow > avgInflow * 2.5
    )
    if (spikeMonths.length > 0) {
      flags.push({
        code: 'FRAUD_INFLOW_SPIKE',
        severity: 'WARNING',
        description: `${spikeMonths.length} month(s) show inflow >2.5x average — possible round-tripping or window dressing`,
        recommendation: 'Investigate source of anomalous inflows. Request bank statement narration.'
      })
    }
  }

  // ── Check 4: Turnover vs bank flow mismatch ──
  if (inputs.borrower.annualTurnover && inputs.financial.avgMonthlyInflow) {
    const impliedAnnualFromBank = inputs.financial.avgMonthlyInflow * 12
    const ratio = impliedAnnualFromBank / inputs.borrower.annualTurnover
    
    if (ratio < 0.3) {
      flags.push({
        code: 'FRAUD_TURNOVER_BANK_MISMATCH',
        severity: 'CRITICAL',
        description: `Bank inflows (₹${(impliedAnnualFromBank / 10000000).toFixed(2)} Cr) are <30% of declared turnover (₹${(inputs.borrower.annualTurnover / 10000000).toFixed(2)} Cr)`,
        recommendation: 'Likely inflated turnover. Cross-verify with GST returns and audited financials.'
      })
    } else if (ratio > 3.0) {
      flags.push({
        code: 'FRAUD_EXCESSIVE_BANK_FLOW',
        severity: 'WARNING',
        description: `Bank inflows are 3x+ declared turnover — possible round-tripping`,
        recommendation: 'Investigate circular transactions. Check for self-transfers and accommodation entries.'
      })
    }
  }

  // ── Check 5: Very new business with large loan ──
  if (inputs.borrower.vintage < 6 && inputs.requestedAmount > 2500000) {
    flags.push({
      code: 'FRAUD_NEW_ENTITY_HIGH_LOAN',
      severity: 'WARNING',
      description: `Business vintage <6 months requesting ₹${(inputs.requestedAmount / 100000).toFixed(1)}L`,
      recommendation: 'Enhanced due diligence required. Check promoter background and business proof.'
    })
  }

  // ── Check 6: Loan amount > annual turnover ──
  if (inputs.borrower.annualTurnover && inputs.requestedAmount > inputs.borrower.annualTurnover) {
    flags.push({
      code: 'FRAUD_LOAN_EXCEEDS_TURNOVER',
      severity: 'WARNING',
      description: `Requested amount exceeds annual turnover by ${Math.round(((inputs.requestedAmount / inputs.borrower.annualTurnover) - 1) * 100)}%`,
      recommendation: 'Review purpose of loan and repayment capacity carefully.'
    })
  }

  // ── Determine overall risk level ──
  const criticalCount = flags.filter(f => f.severity === 'CRITICAL').length
  const warningCount = flags.filter(f => f.severity === 'WARNING').length

  let riskLevel: 'CLEAR' | 'REVIEW' | 'HIGH_RISK'
  let passed: boolean
  let summary: string

  if (criticalCount > 0) {
    riskLevel = 'HIGH_RISK'
    passed = false
    summary = `${criticalCount} critical fraud signal(s) detected. Manual investigation required before proceeding.`
  } else if (warningCount >= 2) {
    riskLevel = 'REVIEW'
    passed = true // Can proceed but flagged
    summary = `${warningCount} warning signal(s) found. Analyst review recommended.`
  } else if (warningCount === 1) {
    riskLevel = 'REVIEW'
    passed = true
    summary = '1 minor flag detected. Proceed with awareness.'
  } else {
    riskLevel = 'CLEAR'
    passed = true
    summary = 'No fraud indicators detected. Clear to proceed with credit assessment.'
  }

  return { passed, riskLevel, flags, summary }
}

// ── Bureau Overlay (Optional Module) ──
// Bureau score is used as a NEGATIVE FILTER only.
// Absence of bureau data does NOT imply rejection.

export type BureauOverlayResult = {
  available: boolean
  bureauScore?: number
  delinquencyFlag: boolean
  fraudAlert: boolean
  modifier: number // -10 to +5 adjustment to credit score
  notes: string[]
}

/**
 * Bureau score is a MODIFIER, not a gate.
 * Used only for:
 *  - Fraud flags (CIBIL/CRIF alerts)
 *  - Severe delinquency history (DPD 90+)
 * 
 * Bureau score absence does NOT imply rejection.
 * Cash-flow based underwriting remains primary.
 */
export function applyBureauOverlay(
  bureauScore?: number,
  hasDelinquency?: boolean,
  hasFraudAlert?: boolean
): BureauOverlayResult {
  const notes: string[] = []
  let modifier = 0

  if (bureauScore === undefined || bureauScore === null) {
    return {
      available: false,
      delinquencyFlag: false,
      fraudAlert: false,
      modifier: 0,
      notes: ['Bureau data not available. Proceeding with cash-flow based assessment.']
    }
  }

  // Bureau fraud alert — hard stop
  if (hasFraudAlert) {
    return {
      available: true,
      bureauScore,
      delinquencyFlag: hasDelinquency || false,
      fraudAlert: true,
      modifier: -100, // Effective rejection
      notes: ['BUREAU FRAUD ALERT: Application must be rejected or escalated.']
    }
  }

  // Severe delinquency
  if (hasDelinquency) {
    modifier = -10
    notes.push('Bureau shows DPD 90+ history. Score adjusted by -10.')
  }

  // Bureau score modifiers (subtle, not dominant)
  if (bureauScore >= 750) {
    modifier += 5
    notes.push('Strong bureau score (750+). Positive modifier +5.')
  } else if (bureauScore >= 650) {
    // Neutral — no modifier
    notes.push('Bureau score adequate (650+). No adjustment.')
  } else if (bureauScore >= 500) {
    modifier -= 3
    notes.push('Bureau score below average. Negative modifier -3.')
  } else {
    modifier -= 7
    notes.push('Poor bureau score (<500). Significant negative modifier -7.')
  }

  return {
    available: true,
    bureauScore,
    delinquencyFlag: hasDelinquency || false,
    fraudAlert: false,
    modifier,
    notes
  }
}
