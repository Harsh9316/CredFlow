// Fraud pre-checks run BEFORE credit scoring.
// Fraud risk = must reject or escalate. Credit risk = can be priced.

import type { CreditPolicy, Severity } from './policy'
import type { ApplicationInput, FraudCheckResult, FraudFlag } from './types'
import { crore, lakh } from './format'

const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 }

export const atLeast = (severity: Severity, floor: Severity) => SEVERITY_RANK[severity] >= SEVERITY_RANK[floor]

export function runFraudChecks(input: ApplicationInput, policy: CreditPolicy): FraudCheckResult {
  const { borrower, financial, requestedAmount } = input
  const rules = policy.fraud.rules
  const flags: FraudFlag[] = []

  // GSTIN characters 3-12 are the holder's PAN
  if (rules.panGstinMismatch.enabled && borrower.pan && borrower.gstin) {
    const panFromGstin = borrower.gstin.substring(2, 12)
    if (panFromGstin !== borrower.pan) {
      flags.push({
        code: 'FRAUD_PAN_GSTIN_MISMATCH',
        severity: rules.panGstinMismatch.severity,
        description: `PAN (${borrower.pan}) does not match PAN embedded in GSTIN (${panFromGstin})`,
        recommendation: 'Verify identity documents. Possible identity fraud.',
      })
    }
  }

  if (rules.missingIdentity.enabled && !borrower.pan && !borrower.gstin) {
    flags.push({
      code: 'FRAUD_NO_IDENTITY_DOCS',
      severity: rules.missingIdentity.severity,
      description: 'Neither PAN nor GSTIN provided',
      recommendation: 'Request at least one government-issued business identity document.',
    })
  }

  const spike = rules.inflowSpike
  if (spike.enabled && financial.monthlyData && financial.monthlyData.length >= spike.minMonths) {
    const spikeMonths = financial.monthlyData.filter(m => m.inflow > financial.avgMonthlyInflow * spike.multipleOfAverage)
    if (spikeMonths.length > 0) {
      flags.push({
        code: 'FRAUD_INFLOW_SPIKE',
        severity: spike.severity,
        description: `${spikeMonths.length} month(s) show inflow >${spike.multipleOfAverage}x average — possible round-tripping or window dressing`,
        recommendation: 'Investigate source of anomalous inflows. Request bank statement narration.',
      })
    }
  }

  if (borrower.annualTurnover && financial.avgMonthlyInflow) {
    const impliedAnnualFromBank = financial.avgMonthlyInflow * 12
    const ratio = impliedAnnualFromBank / borrower.annualTurnover
    const shortfall = rules.turnoverBankShortfall
    const excess = rules.excessiveBankFlow

    if (shortfall.enabled && ratio < shortfall.minBankToTurnoverRatio) {
      flags.push({
        code: 'FRAUD_TURNOVER_BANK_MISMATCH',
        severity: shortfall.severity,
        description: `Bank inflows (${crore(impliedAnnualFromBank)}) are <${Math.round(shortfall.minBankToTurnoverRatio * 100)}% of declared turnover (${crore(borrower.annualTurnover)})`,
        recommendation: 'Likely inflated turnover. Cross-verify with GST returns and audited financials.',
      })
    } else if (excess.enabled && ratio > excess.maxBankToTurnoverRatio) {
      flags.push({
        code: 'FRAUD_EXCESSIVE_BANK_FLOW',
        severity: excess.severity,
        description: `Bank inflows are ${excess.maxBankToTurnoverRatio}x+ declared turnover — possible round-tripping`,
        recommendation: 'Investigate circular transactions. Check for self-transfers and accommodation entries.',
      })
    }
  }

  const newEntity = rules.newEntityLargeLoan
  if (newEntity.enabled && borrower.vintage < newEntity.maxVintageMonths && requestedAmount > newEntity.amountAbove) {
    flags.push({
      code: 'FRAUD_NEW_ENTITY_HIGH_LOAN',
      severity: newEntity.severity,
      description: `Business vintage <${newEntity.maxVintageMonths} months requesting ${lakh(requestedAmount)}`,
      recommendation: 'Enhanced due diligence required. Check promoter background and business proof.',
    })
  }

  if (rules.loanExceedsTurnover.enabled && borrower.annualTurnover && requestedAmount > borrower.annualTurnover) {
    flags.push({
      code: 'FRAUD_LOAN_EXCEEDS_TURNOVER',
      severity: rules.loanExceedsTurnover.severity,
      description: `Requested amount exceeds annual turnover by ${Math.round((requestedAmount / borrower.annualTurnover - 1) * 100)}%`,
      recommendation: 'Review purpose of loan and repayment capacity carefully.',
    })
  }

  const v = input.verifications
  if (rules.gstinNotActive.enabled && v?.gstinStatus && v.gstinStatus !== 'ACTIVE') {
    flags.push({
      code: 'FRAUD_GSTIN_NOT_ACTIVE',
      severity: rules.gstinNotActive.severity,
      description: `GSTIN ${borrower.gstin ?? ''} is ${v.gstinStatus.replace('_', ' ').toLowerCase()} on the GST network`.replace('  ', ' '),
      recommendation: 'Confirm the business is operating. Do not proceed on a cancelled or suspended registration.',
    })
  }

  if (rules.panNotVerified.enabled && v && v.panValid === false) {
    flags.push({
      code: 'FRAUD_PAN_NOT_VERIFIED',
      severity: rules.panNotVerified.severity,
      description: `PAN ${borrower.pan ?? ''} could not be verified with the issuing authority`.replace('  ', ' '),
      recommendation: 'Obtain a fresh copy of the PAN card and re-verify before proceeding.',
    })
  }

  const hardStop = policy.fraud.hardStopSeverity
  const blocking = flags.filter(f => atLeast(f.severity, hardStop)).length
  const review = flags.filter(f => !atLeast(f.severity, hardStop) && f.severity !== 'INFO').length

  if (blocking > 0) {
    const label = hardStop === 'CRITICAL' ? 'critical' : `${hardStop.toLowerCase()}-or-higher`
    return {
      passed: false,
      riskLevel: 'HIGH_RISK',
      flags,
      summary: `${blocking} ${label} fraud signal(s) detected. Manual investigation required before proceeding.`,
    }
  }
  if (review >= 2) {
    return { passed: true, riskLevel: 'REVIEW', flags, summary: `${review} warning signal(s) found. Analyst review recommended.` }
  }
  if (review === 1) {
    return { passed: true, riskLevel: 'REVIEW', flags, summary: '1 minor flag detected. Proceed with awareness.' }
  }
  return { passed: true, riskLevel: 'CLEAR', flags, summary: 'No fraud indicators detected. Clear to proceed with credit assessment.' }
}
