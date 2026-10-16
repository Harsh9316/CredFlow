<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/credrail-logo-dark.svg">
    <img alt="Credrail" src="public/brand/credrail-logo.svg" height="56">
  </picture>
</h1>

<p align="center"><strong>Open-source, explainable credit underwriting for Indian NBFCs.</strong></p>

Credrail takes an SME loan application through fraud pre-checks, an optional bureau overlay and a cash-flow-first credit score, then recommends approve / refer / reject with the reasons behind it. Analysts make the final call, and every step is written to an audit trail.

> Credrail does not replace your credit policy, it runs it. Each NBFC's policy is a versioned YAML file covering thresholds, scorecard bands, LTV limits, industry risk, fraud rules and bureau modifiers, and every decision records the exact version it used.

## Why Credrail

- **Explainable by default.** Every decision includes a 100-point score breakdown, approval reasons, risk flags and recommendations, so you never get a bare number.
- **Fraud is handled separately from credit risk.** Critical fraud signals such as a PAN/GSTIN mismatch or turnover that doesn't match bank flows force a reject recommendation before scoring. Credit risk is scored and priced.
- **Cash flow first.** Bureau data adjusts the score but never gates it on its own, so thin-file MSMEs still get assessed.
- **Multi-tenant.** Multiple NBFCs share one deployment, and each sees only its own borrowers, applications and policy.
- **Policy as code.** Credit policy lives in validated, versioned YAML. Versions are immutable, and every decision links to the exact one it ran under.
- **Use just the engine.** [`@credrail/engine`](packages/engine) is a pure TypeScript package with no database or framework, so you can drop it into an existing loan system.
- **API-first.** A REST API with an OpenAPI 3.1 spec, scoped API keys, idempotent writes, signed webhooks and an event feed, so you can plug Credrail into your LOS, ERP or marketplace. See [docs/API.md](docs/API.md).
- **Maker-checker.** Your policy decides which sanctions need a second approver (by amount, or whenever the system is overridden), and the checker must be a different user.
- **Real data, with consent.** Account Aggregator bank statements and GST returns, plus GSTIN and PAN verification, through Setu. A bureau adapter works with any commercial bureau (CIBIL, CRIF, Experian, Equifax) through your own gateway. Bureau pulls require a recorded borrower consent, and only derived figures are stored. Mocks are included for development. See [docs/CONNECTORS.md](docs/CONNECTORS.md).
- **Auditable.** Overrides need a reason, and every action (by a user or an API key) goes into an audit log that Postgres refuses to edit or delete.

## Quick start

### With Docker (about a minute)

```bash
git clone https://github.com/Harsh9316/CredFlow.git
cd CredFlow
docker compose up --build
```

Open http://localhost:3000. The demo data and logins are created on first start.

### Local development

Requires Node.js 20 or later and Postgres (the command below starts one in Docker).

```bash
npm install
cp .env.example .env          # then set SESSION_SECRET (openssl rand -base64 48)
npm run db:up                 # Postgres 16 in Docker on localhost:5432
npm run setup                 # applies migrations and loads demo data
npm run dev
```

### Demo logins

| Email | Password | Role | NBFC |
|---|---|---|---|
| admin@credrail.dev | Admin@123 | Admin (checker) | FinFirst Capital |
| analyst@credrail.dev | Analyst@123 | Analyst | FinFirst Capital |
| analyst2@credrail.dev | Analyst@123 | Analyst | FinFirst Capital |
| viewer@credrail.dev | Viewer@123 | Viewer | FinFirst Capital |
| admin@smegrowth.in | Admin@123 | Admin | SME Growth Finance |

To check tenant isolation, log in as the two admins: each sees only their own NBFC's applications and policy. Demo logins appear on the sign-in page only when `NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=true`.

## How a decision is made

```
Application ──► 1. Fraud pre-checks ──► 2. Bureau overlay ──► 3. Credit score ──► Recommendation ──► Maker ──► Checker
                 (hard stop on            (modifier only,       (cash flow, EMI       APPROVE / REFER     approve /  (when policy
                  critical flags; GST/     never a gate)         coverage, stability,  / REJECT + amount   reject /   requires a
                  PAN checks via                                 collateral, profile)                      refer      second approver)
                  connectors)
```

The scoring model, thresholds and a worked example are in [docs/UNDERWRITING_EXPLAINED.md](docs/UNDERWRITING_EXPLAINED.md).

## Credit policies

Policies live in [`policies/`](policies):

| Policy | For |
|---|---|
| [`credrail-default`](policies/credrail-default.yaml) | General MSME lending (the built-in default) |
| [`unsecured-working-capital`](policies/unsecured-working-capital.yaml) | Unsecured lines; stricter, stability-weighted |
| [`secured-lap`](policies/secured-lap.yaml) | Loan against property; collateral-led |
| [`invoice-discounting`](policies/invoice-discounting.yaml) | Short-tenure receivables finance |
| [`legacy-v0.1`](policies/legacy-v0.1.yaml) | Reproduces Credrail v0.1 exactly |

The sample policies are illustrative starting points, not credit advice. Calibrate them against your own portfolio.

```bash
npm run policy -- validate policies/*.yaml                    # schema-check policy files
npm run policy -- apply policies/secured-lap.yaml --nbfc FFC  # store a new version and activate it
npm run policy -- list --nbfc FFC                             # version history
```

To change a policy, copy a file, edit it, bump `version` and apply it. The Settings page shows the active policy in full. See [docs/TECHNICAL.md](docs/TECHNICAL.md#9-credit-policies) for the schema.

## Using the engine on its own

```ts
import { evaluateApplication, DEFAULT_POLICY } from '@credrail/engine'

const result = evaluateApplication(application, DEFAULT_POLICY)
// result.decision, result.creditScore, result.finalRecommendedAmt,
// result.approvalReasons, result.riskFlags, result.fraud, ...
```

See [packages/engine](packages/engine) for details.

## Development

```bash
npm test                   # engine tests (incl. 500-case parity with v0.1) and app unit tests
npm run typecheck
npm run lint
npm run db:migrate         # create a migration after changing prisma/schema.prisma
npm run smoke              # end-to-end checks against a running instance (BASE_URL, default http://localhost:3000)
npm run webhooks:dispatch  # send due webhook retries (run on a schedule in production)
```

CI runs all of these against Postgres on every pull request, plus a production build, a migration drift check and a Docker boot test.

## Tech stack

Next.js 16 (App Router) · TypeScript · Prisma · PostgreSQL 16 · Zod · signed JWT sessions (`jose`) · bcrypt

## Documentation

- [API guide](docs/API.md), plus the interactive reference at `/docs/api` on any running instance
- [Data connectors](docs/CONNECTORS.md)
- [Brand guidelines and logo files](docs/BRAND.md)
- [Functional specification](docs/FUNCTIONAL.md)
- [Technical documentation](docs/TECHNICAL.md)
- [Underwriting engine explained](docs/UNDERWRITING_EXPLAINED.md)

## Roadmap

- RBI Key Fact Statement / APR and DPDP consent records
- More Account Aggregator FIU gateways (Finvu, OneMoney) and ready-made CIBIL / CRIF gateways
- Bank-statement signals (bounces, EMI obligations) as policy rules
- Policy editing and side-by-side backtesting in the UI
- Publish `@credrail/engine` to npm
- API rate limiting and a TypeScript SDK

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[Apache License 2.0](LICENSE)
