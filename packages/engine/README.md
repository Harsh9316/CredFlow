# @credflow/engine

Explainable, policy-driven credit decisioning for SME lending. This is the engine behind [CredFlow](https://github.com/Harsh9316/CredFlow), packaged so you can use it inside your own loan origination system.

- **Pure and deterministic.** It has no database, no framework and no network calls, and the same input and policy always give the same output.
- **Policy as data.** Thresholds, scorecard bands, LTV limits, industry risk, fraud rules and bureau modifiers all live in one validated policy document.
- **Explainable.** Every result includes a score breakdown, approval reasons, risk flags and recommendations.

## Install

```bash
npm install @credflow/engine
```

## Use

```ts
import { evaluateApplication, DEFAULT_POLICY } from '@credflow/engine'

const result = evaluateApplication(
  {
    requestedAmount: 2_500_000,
    requestedTenure: 24, // months
    borrower: { pan: 'AAGCG1234K', gstin: '27AAGCG1234K1Z5', vintage: 48, industry: 'Manufacturing', annualTurnover: 9_600_000 },
    financial: { avgMonthlyInflow: 800_000, avgMonthlyExpenses: 550_000, freeCashFlow: 250_000, inflowVolatility: 0.18 },
    collateral: { type: 'MACHINERY', assessedValue: 3_000_000, ltv: 60, hasPersonalGuarantee: false },
    bureau: null, // optional: { score, hasDelinquency, hasFraudAlert }
  },
  DEFAULT_POLICY
)

result.decision            // 'APPROVE'
result.creditScore         // 75
result.finalRecommendedAmt // 1980000
result.approvalReasons     // ['Strong EMI coverage ratio (≥2x)', ...]
result.fraud.riskLevel     // 'CLEAR'
```

## Pipeline

1. **Fraud pre-checks:** PAN/GSTIN consistency, missing identity, inflow spikes, turnover vs bank-flow mismatch, new entity with a large loan, and a loan larger than turnover. Any flag at or above the policy's `hardStopSeverity` forces `REJECT` with a recommended amount of 0.
2. **Bureau overlay:** a score modifier only. Missing bureau data is neutral.
3. **Scorecard:** five components whose maximum points add up to 100, scored against the policy's bands.
4. **Loan sizing:** the lowest of cash-flow eligibility (amortized EMI at the policy rate), the collateral cap with headroom, and the requested amount.
5. **Explanations:** reasons, flags and recommendations worded from the policy's thresholds.

## Your own policy

Write a policy as YAML or JSON, then validate it with `parsePolicy`:

```ts
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { parsePolicy, PolicyValidationError } from '@credflow/engine'

try {
  const policy = parsePolicy(parse(readFileSync('my-policy.yaml', 'utf8')))
} catch (e) {
  if (e instanceof PolicyValidationError) console.error(e.issues) // [{ path, message }]
}
```

Example policies are in the [`policies/`](https://github.com/Harsh9316/CredFlow/tree/main/policies) folder of the CredFlow repo. They are illustrative starting points, not credit advice, so calibrate them against your own portfolio.

## License

Apache-2.0
