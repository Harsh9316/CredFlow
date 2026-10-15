# CredFlow

**Open-source, explainable credit underwriting for Indian NBFCs.**

CredFlow takes an SME loan application through fraud pre-checks, an optional bureau overlay and a cash-flow-first credit score, then recommends approve / refer / reject with the reasons behind it. Analysts make the final call, and every step is written to an audit trail.

> CredFlow does not replace your credit policy, it runs it. Each NBFC's policy is a versioned YAML file covering thresholds, scorecard bands, LTV limits, industry risk, fraud rules and bureau modifiers, and every decision records the exact version it used.

## Why CredFlow

- **Explainable by default.** Every decision includes a 100-point score breakdown, approval reasons, risk flags and recommendations, so you never get a bare number.
- **Fraud is handled separately from credit risk.** Critical fraud signals such as a PAN/GSTIN mismatch or turnover that doesn't match bank flows force a reject recommendation before scoring. Credit risk is scored and priced.
- **Cash flow first.** Bureau data adjusts the score but never gates it on its own, so thin-file MSMEs still get assessed.
- **Multi-tenant.** Multiple NBFCs share one deployment, and each sees only its own borrowers, applications and policy.
- **Policy as code.** Credit policy lives in validated, versioned YAML. Versions are immutable, and every decision links to the exact one it ran under.
- **Use just the engine.** [`@credflow/engine`](packages/engine) is a pure TypeScript package with no database or framework, so you can drop it into an existing loan system.
- **Auditable.** Analyst overrides require a reason and are logged.

## Quick start

### With Docker (about a minute)

```bash
git clone https://github.com/Harsh9316/CredFlow.git
cd CredFlow
docker compose up --build
```

Open http://localhost:3000. The demo data and logins are created on first start.

### Local development

Requires Node.js 20 or later.

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET (openssl rand -base64 48)
npm run setup                 # creates the SQLite DB and loads demo data
npm run dev
```

### Demo logins

| Email | Password | Role | NBFC |
|---|---|---|---|
| admin@credflow.io | Admin@123 | Admin | FinFirst Capital |
| analyst@credflow.io | Analyst@123 | Analyst | FinFirst Capital |
| viewer@credflow.io | Viewer@123 | Viewer | FinFirst Capital |
| admin@smegrowth.in | Admin@123 | Admin | SME Growth Finance |

To check tenant isolation, log in as the two admins: each sees only their own NBFC's applications and policy. Demo logins appear on the sign-in page only when `NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=true`.

## How a decision is made

```
Application ──► 1. Fraud pre-checks ──► 2. Bureau overlay ──► 3. Credit score ──► Recommendation ──► Analyst decision
                 (hard stop on            (modifier only,       (cash flow, EMI       APPROVE / REFER     approve / reject /
                  critical flags)          never a gate)         coverage, stability,  / REJECT + amount   refer, with override
                                                                 collateral, profile)                      reason if it differs
```

The scoring model, thresholds and a worked example are in [docs/UNDERWRITING_EXPLAINED.md](docs/UNDERWRITING_EXPLAINED.md).

## Credit policies

Policies live in [`policies/`](policies):

| Policy | For |
|---|---|
| [`credflow-default`](policies/credflow-default.yaml) | General MSME lending (the built-in default) |
| [`unsecured-working-capital`](policies/unsecured-working-capital.yaml) | Unsecured lines; stricter, stability-weighted |
| [`secured-lap`](policies/secured-lap.yaml) | Loan against property; collateral-led |
| [`invoice-discounting`](policies/invoice-discounting.yaml) | Short-tenure receivables finance |
| [`legacy-v0.1`](policies/legacy-v0.1.yaml) | Reproduces CredFlow v0.1 exactly |

The sample policies are illustrative starting points, not credit advice. Calibrate them against your own portfolio.

```bash
npm run policy -- validate policies/*.yaml                    # schema-check policy files
npm run policy -- apply policies/secured-lap.yaml --nbfc FFC  # store a new version and activate it
npm run policy -- list --nbfc FFC                             # version history
```

To change a policy, copy a file, edit it, bump `version` and apply it. The Settings page shows the active policy in full. See [docs/TECHNICAL.md](docs/TECHNICAL.md#9-credit-policies) for the schema.

## Using the engine on its own

```ts
import { evaluateApplication, DEFAULT_POLICY } from '@credflow/engine'

const result = evaluateApplication(application, DEFAULT_POLICY)
// result.decision, result.creditScore, result.finalRecommendedAmt,
// result.approvalReasons, result.riskFlags, result.fraud, ...
```

See [packages/engine](packages/engine) for details.

## Development

```bash
npm test             # engine tests, including 500-case parity with v0.1
npm run typecheck
npm run lint
npm run smoke        # end-to-end checks against a running instance (BASE_URL, default http://localhost:3000)
```

CI runs all of these, plus a production build and a Docker boot test, on every pull request.

## Tech stack

Next.js 16 (App Router) · TypeScript · Prisma · SQLite (Postgres support planned) · signed JWT sessions (`jose`) · bcrypt

## Documentation

- [Functional specification](docs/FUNCTIONAL.md)
- [Technical documentation](docs/TECHNICAL.md)
- [Underwriting engine explained](docs/UNDERWRITING_EXPLAINED.md)

## Roadmap

- Policy editing and side-by-side backtesting in the UI
- Publish `@credflow/engine` to npm
- Public REST API (OpenAPI), per-NBFC API keys and webhooks
- Connector interfaces for bureau, Account Aggregator, GST and KYC providers
- Postgres as the default database; maker-checker approvals
- RBI Key Fact Statement / APR and DPDP consent records

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[Apache License 2.0](LICENSE)
