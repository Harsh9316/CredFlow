# CredFlow — Technical Documentation

## Positioning Statement

> *CredFlow does not replace NBFC credit policy. It standardizes analysis, improves speed, and strengthens auditability — with full analyst control at every step.*

### Out of Scope (v1)

- Loan disbursement & repayment processing
- Collections & recovery workflows
- Legal documentation generation
- Asset valuation & charge registration
- Borrower-facing portals

---

## 1. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Framework** | Next.js (App Router) | 16.x |
| **Language** | TypeScript | 5.x |
| **Database** | PostgreSQL (migrations in `prisma/migrations`) | 16.x |
| **ORM** | Prisma | 5.x |
| **Styling** | Vanilla CSS (CSS Variables) | — |
| **Runtime** | Node.js | 22.x |
| **Authentication** | Signed JWT session cookie (`jose`, HS256) + bcrypt | — |

---

## 2. Project Structure

```
credflow/
├── app/
│   ├── layout.tsx                    # Root layout + global CSS
│   ├── page.tsx                      # Login page
│   ├── globals.css                   # Design system & all styles
│   ├── api/
│   │   ├── auth/
│   │   │   ├── login/route.ts        # POST — user login
│   │   │   ├── logout/route.ts       # POST — session clear
│   │   │   └── session/route.ts      # GET — session for client
│   │   └── applications/
│   │       ├── route.ts              # POST — create application
│   │       └── [id]/
│   │           ├── decide/route.ts   # POST — run underwriting engine
│   │           └── process/route.ts  # POST — approve/reject/refer
│   └── (dashboard)/
│       ├── layout.tsx                # Dashboard layout + sidebar
│       ├── dashboard/page.tsx        # Dashboard with stats
│       ├── applications/
│       │   ├── page.tsx              # Application list
│       │   ├── new/page.tsx          # New application wizard
│       │   └── [id]/page.tsx         # Application detail + actions
│       ├── portfolio/page.tsx        # Active loans portfolio + risk governance
│       └── settings/page.tsx         # NBFC configuration
├── components/
│   ├── Sidebar.tsx                   # Navigation sidebar
│   └── DecisionPanel.tsx             # Underwriting action panel
├── lib/
│   ├── db.ts                         # Prisma client singleton
│   ├── auth.ts                       # Session helpers & RBAC
│   ├── session-token.ts              # Signed session tokens (edge-safe)
│   ├── policy.ts                     # Load / apply versioned credit policies
│   ├── services/                     # Use cases shared by dashboard routes and the public API
│   │   ├── applications.ts           # create, underwrite, decide (maker-checker), serialize
│   │   ├── events.ts                 # Domain events → webhook outbox
│   │   └── errors.ts, actor.ts
│   ├── connectors/                   # Bureau / GST / KYC / bank-data interfaces + mocks
│   ├── api-keys.ts, api-v1.ts        # API key auth and /api/v1 plumbing
│   ├── idempotency.ts                # Idempotency-Key handling
│   ├── webhooks.ts                   # Signing, SSRF checks, delivery with retries
│   └── openapi.ts                    # OpenAPI 3.1 document
├── packages/
│   └── engine/                       # @credflow/engine: pure decision engine (no DB, no Next.js)
│       ├── src/                      # policy schema, fraud checks, bureau, scoring, evaluate
│       └── test/                     # unit, schema, policy and legacy-parity tests
├── policies/                         # Versioned credit policies (YAML)
├── scripts/
│   ├── policy.ts                     # Policy CLI: validate / apply / list
│   ├── smoke-test.ts                 # End-to-end checks against a running instance
│   └── generate-default-policy.ts    # Syncs the engine default from credflow-default.yaml
├── proxy.ts                          # Rejects unauthenticated requests
├── prisma/
│   └── schema.prisma                 # Database schema
├── seed.ts                           # Database seeder
└── docs/
    ├── TECHNICAL.md                  # This file
    └── FUNCTIONAL.md                 # Functional specification
```

---

## 3. Database Schema

### Entity-Relationship Overview

```
NBFC (1) ─── (*) User
     (1) ─── (*) Borrower
     (1) ─── (*) LoanApplication
     (1) ─── (*) CreditPolicy (one active)

Borrower (1) ─── (*) LoanApplication
         (1) ─── (*) FinancialData

LoanApplication (1) ─── (0..1) Collateral
                (1) ─── (0..1) CreditDecision
                (1) ─── (0..1) Approval
                (1) ─── (*)    AuditLog

CreditPolicy (1) ─── (*) CreditDecision

NBFC (1) ─── (*) ApiKey ─── (*) AuditLog
     (1) ─── (*) WebhookEndpoint (1) ─── (*) WebhookDelivery (*) ─── (1) WebhookEvent
     (1) ─── (*) WebhookEvent
     (1) ─── (*) IdempotencyKey
```

### Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `NBFC` | Multi-tenant organization | `code`, `licenseNo`, `isActive` |
| `User` | System users with roles | `email`, `role` (ADMIN/ANALYST/VIEWER) |
| `Borrower` | SME borrower profile | `businessName`, `industry`, `vintage`, `gstin` |
| `LoanApplication` | Loan request (LOS-Lite) | `applicationNo`, `requestedAmount`, `status`, `priority` |
| `FinancialData` | Bank statement metrics | `avgMonthlyInflow`, `freeCashFlow`, `inflowVolatility` |
| `Collateral` | Security details | `collateralType`, `assessedValue`, `ltv`, `collateralCap` |
| `CreditDecision` | Engine output | `creditScore`, `decision`, `scoreBreakdown` (JSON) |
| `Approval` | NBFC final decision with maker-checker | `finalDecision`, `sanctionedAmount`, `overrideSystem`, `status` (CONFIRMED / PENDING_CHECKER / RETURNED), `approvedBy` (maker), `checkedBy` |
| `AuditLog` | Append-only event trail (DB trigger blocks UPDATE/DELETE) | `action`, `details` (JSON), `userId` or `apiKeyId`, `timestamp` |
| `ApiKey` | Public API credential | `prefix`, `keyHash` (SHA-256), `scopes[]`, `revokedAt` |
| `IdempotencyKey` | Stored responses for retried POSTs | `key`, `requestHash`, `responseStatus`, `responseBody` |
| `WebhookEndpoint` | Subscriber URL | `url`, `secret`, `events[]` |
| `WebhookEvent` | Outbox: every domain event | `type`, `data` (JSON) |
| `WebhookDelivery` | One event to one endpoint | `status`, `attempts`, `nextAttemptAt`, `lastError` |
| `CreditPolicy` | Immutable, versioned credit policy per NBFC | `policyKey`, `version`, `document` (JSON), `checksum`, `isActive` |

> **Note:** Status and role fields are stored as `String`, and the original JSON columns are still text (newer tables use `jsonb`). Converting both is tracked on the roadmap.

**Application statuses:** `APPLIED` → `UNDER_REVIEW` (after evaluation) → `PENDING_APPROVAL` (maker approved; a checker is required) → `SANCTIONED`, or `REJECTED`. A checker can return a pending sanction to `UNDER_REVIEW`. Every transition is a guarded update, so double-clicks and concurrent requests cannot apply twice.

---

## 4. API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Validates credentials, creates `httpOnly` session cookie |
| `POST` | `/api/auth/logout` | Clears session cookie |
| `GET` | `/api/auth/session` | Returns current user session (reads `httpOnly` cookie server-side) |

### Applications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/applications` | Creates new loan application with borrower, financial data, and collateral |
| `POST` | `/api/applications/[id]/decide` | Runs 3-stage underwriting pipeline: fraud pre-checks → bureau overlay → credit scoring |
| `POST` | `/api/applications/[id]/process` | `APPROVE` / `REJECT` / `REFER` (maker), `CONFIRM` / `RETURN` (checker) |

All three call `lib/services/applications.ts`, the same code the public API uses.

### Admin (session, ADMIN only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` / `POST` | `/api/admin/api-keys` | List / create API keys (the full key is returned once) |
| `DELETE` | `/api/admin/api-keys/[id]` | Revoke a key |
| `GET` / `POST` | `/api/admin/webhooks` | List / register webhook endpoints (the secret is returned once) |
| `DELETE` | `/api/admin/webhooks/[id]` | Remove an endpoint |
| `POST` | `/api/admin/webhooks/[id]/test` | Send a `webhook.test` event |

### Public API (`/api/v1`, API key)

See [API.md](API.md) and the interactive reference at `/docs/api` (spec at `/api/v1/openapi.json`).

| Method | Endpoint | Scope |
|--------|----------|-------|
| `POST` | `/api/v1/applications` | `applications:write` (supports `Idempotency-Key`) |
| `GET` | `/api/v1/applications`, `/api/v1/applications/{id}` | `applications:read` |
| `POST` | `/api/v1/applications/{id}/evaluate` | `applications:evaluate` |
| `POST` | `/api/v1/evaluate` | `evaluate` (stateless) |
| `GET` | `/api/v1/policy` | `policy:read` |
| `GET` | `/api/v1/events` | `events:read` |

The API cannot sanction. Approvals require a signed-in user.

### Maker-checker

The policy's `approvals` section decides when a second approver is needed (`checkerRequiredAbove`, `checkerRequiredForOverrides`) and who may act as checker (`checkerRoles`). The checker must be a different user from the maker. Rules are taken from the policy the application was **evaluated** under, so a policy change mid-review cannot alter them.

---

## 5. Underwriting Recommendation Engine

> System-assisted underwriting with analyst control. The engine does not make decisions — it produces recommendations that analysts evaluate.

Lives in `packages/engine` as the standalone package `@credflow/engine`. It is pure and deterministic: `evaluateApplication(input, policy)` takes plain data and returns the full evaluation, with no database or framework dependencies. The app imports it through a TypeScript path alias, and external users can install the built package.

Every number below comes from the **credit policy**. The tables show the values in `policies/credflow-default.yaml`. See [section 9](#9-credit-policies) for how policies work.

### 3-Stage Pipeline

```
┌──────────────────────┐
│  Stage 1: FRAUD      │ ← Must CLEAR before credit assessment
│  Pre-Checks          │   (6 checks: PAN/GSTIN, inflow spikes,
│                      │    turnover mismatch, new entity risk...)
│  Result: CLEAR /     │
│  REVIEW / HIGH_RISK  │
├──────────────────────┤
│  Stage 2: BUREAU     │ ← Negative filter only, NOT a gate
│  Overlay (Optional)  │   Bureau absence ≠ rejection
│                      │   Used for: fraud flags, DPD 90+ history
│  Result: Score       │
│  modifier (-10 to +5)│
├──────────────────────┤
│  Stage 3: CREDIT     │ ← Rule-based scoring (5 dimensions)
│  Scoring             │   Cash flow primary, collateral secondary
│                      │
│  Result: Score,      │
│  eligibility, reasons│
└──────────────────────┘
```

### Fraud Pre-Checks (Stage 1)

| Check | Severity | Signal |
|-------|----------|--------|
| PAN/GSTIN mismatch | CRITICAL | Identity fraud |
| Missing identity docs (no PAN + no GSTIN) | WARNING | Unverifiable entity |
| Abnormal inflow spikes (>2.5x avg) | WARNING | Round-tripping / window dressing |
| Turnover vs bank flow mismatch (<30%) | CRITICAL | Inflated financials |
| New entity (<6 mo) + large loan (>₹25L) | WARNING | Shell entity risk |
| Loan amt > annual turnover | WARNING | Capacity concern |

> **Key principle:** Fraud risk = must reject or escalate. Credit risk = can be priced.

### Bureau Overlay (Stage 2)

> Bureau score is used as a **negative filter only**. Absence of bureau data does not imply rejection. Cash-flow based underwriting remains primary.

| Bureau Score | Modifier | Notes |
|-------------|----------|-------|
| Not available | 0 | Proceed with cash-flow assessment |
| ≥ 750 | +5 | Positive signal |
| 650–749 | 0 | Neutral |
| 500–649 | -3 | Below average |
| < 500 | -7 | Poor |
| Fraud alert | -100 | Hard stop |
| DPD 90+ | -10 | Delinquency penalty |

### Credit Score Components (Stage 3, Total: 100)

| Component | Max Score | Inputs |
|-----------|-----------|--------|
| Cash Flow | 30 | Free cash flow vs. monthly EMI ratio |
| EMI Coverage | 25 | EMI coverage ratio (FCF / EMI) |
| Stability | 20 | Inflow volatility (CV coefficient) |
| Collateral | 15 | Collateral coverage ratio + type bonuses |
| Profile | 10 | Business vintage + industry risk band |

### Recommendation Thresholds

| Score Range | Recommendation | Action |
|-------------|----------------|--------|
| ≥ 70 | `APPROVE` | System recommends approval |
| 50 – 69 | `REFER` | Analyst review required |
| < 50 | `REJECT` | System recommends rejection |

### Eligibility Calculations

- **EMI**: reducing-balance instalment at `affordability.annualInterestRate` (`amortized` method), or `amount / tenure` (`flat-factor` method, v0.1 behaviour)
- **Cash Flow Eligible**: the principal whose EMI equals `FreeCashFlow / minEMICoverage` (`flat-factor`: `maxEMI × tenure × flatFactor`)
- **Collateral Eligible**: `assessedValue × min(ltvApplied, ltvLimit) / 100`
- **Final Recommended Amount**: secured `min(cashFlowEligible, collateralEligible × collateralHeadroom, requested)`; unsecured `min(cashFlowEligible × unsecuredHaircut, requested)`; 0 if fraud pre-checks hard-stop

### Engine Output Structure

```typescript
{
  creditScore: number,          // 0–100
  decision: 'APPROVE' | 'REFER' | 'REJECT',
  cashFlowEligible: number,
  collateralEligible: number,
  finalRecommendedAmt: number,
  scoreBreakdown: ScoreBreakdown,
  approvalReasons: string[],    // Explainable positive factors
  riskFlags: string[],          // Risk warnings (incl. fraud flags)
  recommendations: string[]     // Actionable suggestions
}
```

---

## 6. Authentication & Session Management

### Flow
1. User submits credentials via login form
2. Server validates against `User` table (bcrypt-hashed passwords, constant-time on unknown emails)
3. On success, sets `credflow_session` cookie: an HS256-signed JWT (`httpOnly`, `secure` in production, 8h expiry) signed with `SESSION_SECRET`
4. `proxy.ts` rejects requests to dashboard pages and `/api/applications/*` without a valid signature
5. Pages and route handlers call `getSession()` / `requirePageSession()` / `requireApiSession()` from `lib/auth.ts`, which re-check the user is still active

### Tenant Isolation
Every query for applications, borrowers, approvals and settings is filtered by the session's `nbfcId`. Requests for another NBFC's records return 404.

### Credit Policy
`lib/policy.ts` loads the NBFC's active `CreditPolicy` (or the built-in default if none is applied) and passes it to the engine. Each decision is linked to the exact policy row via `CreditDecision.policyId`, and its id, version and checksum are also stored in `calculationInputs`.

### Role-Based Access Control

| Role | Permissions |
|------|------------|
| `ADMIN` | Full access to all features including settings |
| `ANALYST` | Create applications, run engine, process approvals |
| `VIEWER` | Read-only access to all pages, no underwriting actions (enforced in the API) |

---

## 7. Frontend Architecture

### Design System
- **Themes**: Light by default, plus dark mode. Follows the OS setting, with a Light / Dark / System override in the user menu (stored in `localStorage` and applied before first paint).
- **Tokens**: CSS custom properties in `app/globals.css` for surfaces, text, a single indigo accent, status tones (success / warning / danger / info) and chart colours.
- **Typography**: Inter (UI) and JetBrains Mono (identifiers), loaded with `next/font`. Figures use tabular numbers.
- **Icons**: `lucide-react`.
- **Layout**: Fixed sidebar with a drawer on screens under 960px. Content max-width is 1320px. Detail pages use a main column plus a sticky decision rail.
- **Formatting**: `lib/format.ts` covers ₹ amounts in lakh/crore, dates, and status, decision and collateral labels.

### UI kit (`components/ui`)

| Component | Use |
|-----------|-----|
| `PageHeader` | Title, description, back link, status badge, actions |
| `Card` | Section container with header, body and footer; `flush` for edge-to-edge tables |
| `Stat` | KPI tile |
| `Badge`, `StatusBadge`, `DecisionBadge` | Status pills |
| `Alert` | Info / success / warning / danger messages |
| `Meter`, `ScoreRing` | Score and exposure visuals |
| `EmptyState` | Empty lists and tables |

### Key Components

| Component | Path | Type | Description |
|-----------|------|------|-------------|
| `AppShell` | `components/AppShell.tsx` | Client | Sidebar, mobile drawer, user menu, theme switcher |
| `DecisionPanel` | `components/DecisionPanel.tsx` | Client | Run engine; approve / refer / reject; checker confirm / return |
| `DeveloperSettings` | `components/DeveloperSettings.tsx` | Client | API keys, webhook endpoints, deliveries |
| `LoginPage` | `app/page.tsx` | Client | Sign-in with one-click demo accounts |
| `DashboardPage` | `(dashboard)/dashboard/page.tsx` | Server | KPIs, work queue, recent applications |
| `ApplicationsPage` | `(dashboard)/applications/page.tsx` | Server | Status tabs, search, table |
| `ApplicationDetailPage` | `(dashboard)/applications/[id]/page.tsx` | Server | Recommendation, checks, cash flow, activity, decision rail |
| `NewApplicationPage` | `(dashboard)/applications/new/page.tsx` | Client | Four-step form with live summary |
| `PortfolioPage` | `(dashboard)/portfolio/page.tsx` | Server | Sanctioned book and concentration limits |

### Data Flow
- **Server Components**: Fetch data directly from Prisma (no API calls)
- **Client Components**: Use `fetch()` to call API routes
- **Session Cookie**: `httpOnly` → accessible only via server-side API (`/api/auth/session`)

---

## 8. Running the Application

```bash
# Install dependencies
npm install

# Configure environment (then set SESSION_SECRET)
cp .env.example .env

# Start Postgres (Docker) and create the schema + demo data
npm run db:up
npm run setup

# Start development server
npm run dev
# → http://localhost:3000
```

### Default Login Credentials
| Email | Password | Role |
|-------|----------|------|
| `admin@credflow.io` | `Admin@123` | ADMIN |
| `analyst@credflow.io` | `Analyst@123` | ANALYST |
| `analyst2@credflow.io` | `Analyst@123` | ANALYST |
| `viewer@credflow.io` | `Viewer@123` | VIEWER |
| `admin@smegrowth.in` | `Admin@123` | ADMIN (second NBFC) |

---

## 9. Credit Policies

A policy is a YAML document validated by the Zod schema in `packages/engine/src/policy.ts`. It controls:

| Section | Controls |
|---|---|
| `decision` | Approve / refer thresholds |
| `affordability` | EMI method and assumed rate, min EMI coverage, unsecured haircut, collateral headroom |
| `scoring` | The five scorecard components: max points (must add up to 100), bands, bonuses |
| `collateral.ltvLimits` | Maximum LTV for every collateral type |
| `industries` | Industry → LOW / MEDIUM / HIGH, plus the band for unlisted industries |
| `explanations` | Thresholds used to word reasons and flags |
| `fraud` | Per-rule enable / severity / parameters, and the severity that forces REJECT |
| `bureau` | Score-band and delinquency modifiers |

Bundled policies:

| File | Use |
|---|---|
| `credflow-default.yaml` | General MSME lending; the engine's built-in default |
| `unsecured-working-capital.yaml` | Stricter, stability-weighted unsecured lines |
| `secured-lap.yaml` | Collateral-led LAP scorecard |
| `invoice-discounting.yaml` | Short-tenure receivables finance |
| `legacy-v0.1.yaml` | Reproduces CredFlow v0.1 exactly (flat-factor EMI) |

The sample policies are illustrative starting points, not credit advice. Calibrate them against your own portfolio.

```bash
npm run policy -- validate policies/*.yaml
npm run policy -- apply policies/secured-lap.yaml --nbfc FFC
npm run policy -- list --nbfc FFC
```

Policy versions are immutable. Applying changed content under an existing `id@version` is refused, so bump `version` to change a policy. Re-applying an older version re-activates it.

---

## 10. Testing & CI

| Command | What it checks |
|---|---|
| `npm test` | Engine unit tests, policy schema validation, bundled policies, **legacy parity** (500 recorded v0.1 decisions reproduced field-for-field under `legacy-v0.1.yaml`), and app unit tests (webhook signing, SSRF checks, API key format) |
| `npm run typecheck` | App and engine TypeScript |
| `npm run lint` | ESLint |
| `npm run smoke` | Against a running, seeded instance: auth, forged/tampered sessions, roles, tenant isolation, policy-linked decisions, maker-checker, public API (scopes, idempotency, isolation, revocation), webhooks (delivery, signature, retry) and the append-only audit log |

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, tests, a migration drift check, policy validation, a default-policy drift check and both builds. It then runs the smoke test against a production build backed by Postgres, and builds and boots the Docker Compose stack.

