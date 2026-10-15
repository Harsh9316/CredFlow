# CredFlow

**Open-source, explainable credit underwriting for Indian NBFCs.**

CredFlow takes an SME loan application through fraud pre-checks, an optional bureau overlay and a cash-flow-first credit score, then recommends approve / refer / reject with the reasons behind it. Analysts make the final call, and every step is written to an audit trail.

> CredFlow does not replace your credit policy. Each NBFC configures its own thresholds, LTV limits and industry risk bands, and the engine applies them.

## Why CredFlow

- **Explainable by default.** Every decision includes a 100-point score breakdown, approval reasons, risk flags and recommendations, so you never get a bare number.
- **Fraud is handled separately from credit risk.** Critical fraud signals such as a PAN/GSTIN mismatch or turnover that doesn't match bank flows force a reject recommendation before scoring. Credit risk is scored and priced.
- **Cash flow first.** Bureau data adjusts the score but never gates it on its own, so thin-file MSMEs still get assessed.
- **Multi-tenant.** Multiple NBFCs share one deployment, and each sees only its own borrowers, applications and policy.
- **Auditable.** The policy version is stored with every decision. Analyst overrides require a reason and are logged.

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

## Configuring credit policy

Each NBFC has a `Settings` row containing approve/refer thresholds, minimum EMI coverage, maximum inflow volatility, minimum business vintage, LTV limits by collateral type and industry risk bands. Any value an NBFC hasn't set falls back to the engine defaults in [`lib/decision-engine.ts`](lib/decision-engine.ts). The merged policy is loaded in [`lib/policy.ts`](lib/policy.ts), and its version is stored with every decision.

## Tech stack

Next.js 16 (App Router) · TypeScript · Prisma · SQLite (Postgres support planned) · signed JWT sessions (`jose`) · bcrypt

## Documentation

- [Functional specification](docs/FUNCTIONAL.md)
- [Technical documentation](docs/TECHNICAL.md)
- [Underwriting engine explained](docs/UNDERWRITING_EXPLAINED.md)

## Roadmap

- Credit policy as versioned config files, validated against a schema
- Decision engine published as a standalone npm package
- Public REST API (OpenAPI), per-NBFC API keys and webhooks
- Connector interfaces for bureau, Account Aggregator, GST and KYC providers
- Postgres as the default database; maker-checker approvals
- RBI Key Fact Statement / APR and DPDP consent records

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[Apache License 2.0](LICENSE)
