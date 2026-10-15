// One-off: records what the pre-refactor engine (lib/decision-engine.ts + lib/fraud-checks.ts,
// orchestrated as in the decide route at commit f087f15) returns for a deterministic set of
// applications. test/legacy-parity.test.ts asserts the new engine reproduces these exactly.
//
// Run from the repo root at commit f087f15:  npx tsx packages/engine/test/generate-legacy-golden.ts
import { writeFileSync } from 'node:fs'
import { generateDecision } from '../../../lib/decision-engine'
import { runFraudPreChecks, applyBureauOverlay } from '../../../lib/fraud-checks'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(42)
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
const between = (a: number, b: number) => a + rnd() * (b - a)

const INDUSTRIES = ['Manufacturing', 'IT Services', 'Healthcare', 'Retail', 'Construction', 'Agriculture', 'Real Estate', 'Hospitality', 'Trading', 'Unlisted Industry']
const COLLATERAL = ['NONE', 'LAP', 'MACHINERY', 'INVOICE', 'STOCK', 'FD', null] as const

const cases = []
for (let i = 0; i < 500; i++) {
  const clean = i % 2 === 0 // half the cases avoid fraud triggers so approve/refer paths get exercised
  const avgMonthlyInflow = Math.round(between(50_000, 5_000_000))
  const avgMonthlyExpenses = Math.round(avgMonthlyInflow * (clean ? between(0.3, 0.85) : between(0.4, 1.15)))
  const freeCashFlow = avgMonthlyInflow - avgMonthlyExpenses
  const inflowVolatility = Math.round(between(0.05, 0.8) * 100) / 100
  const requestedTenure = pick([6, 12, 18, 24, 36, 48, 60])
  const requestedAmount = clean
    ? Math.max(100_000, Math.round(Math.max(freeCashFlow, 50_000) * requestedTenure * between(0.2, 1.2) / 10_000) * 10_000)
    : Math.round(between(200_000, 50_000_000) / 10_000) * 10_000
  const vintage = Math.floor(clean ? between(6, 120) : between(1, 120))
  const pan = clean || rnd() < 0.85 ? 'ABCDE1234F' : null
  const gstinRoll = rnd()
  const gstin = clean ? (gstinRoll < 0.7 ? '27ABCDE1234F1Z5' : null) : gstinRoll < 0.6 ? '27ABCDE1234F1Z5' : gstinRoll < 0.75 ? '27ZZZZZ9999Z1Z5' : null
  const annualTurnover = rnd() < 0.85 ? Math.round(avgMonthlyInflow * 12 * (clean ? between(0.5, 2.5) : between(0.2, 4))) : null
  const collateralType = pick([...COLLATERAL])
  const collateral = collateralType === null ? null : {
    type: collateralType,
    assessedValue: Math.round(requestedAmount * between(0.2, 2.5)),
    ltv: pick([40, 50, 60, 70, 80, 90, 100]),
    hasPersonalGuarantee: rnd() < 0.4,
  }
  const monthlyData = rnd() < 0.7
    ? Array.from({ length: pick([2, 3, 6, 12]) }, (_, m) => ({
        month: `M${m + 1}`,
        inflow: Math.round(avgMonthlyInflow * (rnd() < 0.1 ? between(2.6, 4) : between(0.6, 1.4))),
        outflow: Math.round(avgMonthlyExpenses * between(0.8, 1.2)),
      }))
    : []

  cases.push({
    requestedAmount, requestedTenure,
    borrower: { pan, gstin, businessName: `Case ${i}`, vintage, industry: pick(INDUSTRIES), annualTurnover },
    financial: { avgMonthlyInflow, avgMonthlyExpenses, freeCashFlow, inflowVolatility, monthlyData },
    collateral,
  })
}

const golden = cases.map(input => {
  const fraud = runFraudPreChecks({
    borrower: input.borrower,
    financial: input.financial,
    requestedAmount: input.requestedAmount,
  })
  const bureau = applyBureauOverlay(undefined, false, false)
  const monthlyEMI = input.requestedAmount / input.requestedTenure
  const emiCoverageRatio = input.financial.freeCashFlow ? input.financial.freeCashFlow / monthlyEMI : 0
  const result = generateDecision({
    requestedAmount: input.requestedAmount,
    requestedTenure: input.requestedTenure,
    financial: { ...input.financial, emiCoverageRatio },
    collateral: input.collateral,
    borrower: { vintage: input.borrower.vintage, industry: input.borrower.industry, annualTurnover: input.borrower.annualTurnover ?? undefined },
  })
  const riskFlags = [...result.riskFlags]
  const recommendations = [...result.recommendations]
  fraud.flags.forEach(f => {
    if (f.severity === 'CRITICAL') riskFlags.unshift(`🚨 FRAUD: ${f.description}`)
    else riskFlags.push(`⚠ Fraud Check: ${f.description}`)
    recommendations.push(f.recommendation)
  })
  bureau.notes.forEach(n => recommendations.push(n))
  const highRisk = fraud.riskLevel === 'HIGH_RISK'
  return {
    input,
    expected: {
      creditScore: Math.max(0, Math.min(100, result.creditScore + bureau.modifier)),
      decision: highRisk ? 'REJECT' : result.decision,
      scoreBreakdown: result.scoreBreakdown,
      cashFlowEligible: result.cashFlowEligible,
      collateralEligible: result.collateralEligible,
      finalRecommendedAmt: highRisk ? 0 : result.finalRecommendedAmt,
      emiCoverageRatio,
      approvalReasons: result.approvalReasons,
      riskFlags,
      recommendations,
      fraud,
    },
  }
})

writeFileSync(new URL('./fixtures/legacy-golden.json', import.meta.url), JSON.stringify(golden))
const tally = golden.reduce<Record<string, number>>((t, g) => ((t[g.expected.decision] = (t[g.expected.decision] ?? 0) + 1), t), {})
console.log(`wrote ${golden.length} cases`, tally)
