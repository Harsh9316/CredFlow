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
| **Framework** | Next.js (App Router) | 14.x |
| **Language** | TypeScript | 5.x |
| **Database** | SQLite | 3.x |
| **ORM** | Prisma | 5.x |
| **Styling** | Vanilla CSS (CSS Variables) | — |
| **Runtime** | Node.js | 22.x |
| **Authentication** | Cookie-based sessions (`httpOnly`) | — |

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
│   ├── decision-engine.ts            # Credit scoring engine
│   └── fraud-checks.ts              # Fraud pre-checks + bureau overlay
├── prisma/
│   └── schema.prisma                 # Database schema (11 models)
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
     (1) ─── (1) Settings

Borrower (1) ─── (*) LoanApplication
         (1) ─── (*) FinancialData

LoanApplication (1) ─── (0..1) Collateral
                (1) ─── (0..1) CreditDecision
                (1) ─── (0..1) Approval
                (1) ─── (*)    AuditLog
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
| `Approval` | NBFC final decision | `finalDecision`, `sanctionedAmount`, `overrideSystem` |
| `AuditLog` | Event trail | `action`, `details` (JSON), `timestamp` |
| `Settings` | NBFC configuration | `approveThreshold`, `ltvLimits` (JSON), `minEMICoverage` |

> **Note:** All enum fields are stored as `String` for SQLite compatibility.

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
| `POST` | `/api/applications/[id]/process` | Processes final decision (approve/reject/refer) with sanction details |

---

## 5. Underwriting Recommendation Engine

> System-assisted underwriting with analyst control. The engine does not make decisions — it produces recommendations that analysts evaluate.

Located at `lib/decision-engine.ts` + `lib/fraud-checks.ts`.

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

- **Cash Flow Eligible**: `(FreeCashFlow / minEMICoverage) × tenure × 0.85`
- **Collateral Eligible**: `assessedValue × min(ltvApplied, ltvLimit) / 100`
- **Final Recommended Amount**: `min(cashFlowEligible, collateralEligible, requestedAmount)` with adjustments for secured/unsecured

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
2. Server validates against `User` table (bcrypt-hashed passwords)
3. On success, sets `credflow_session` cookie (`httpOnly`, `secure` in production)
4. Client components fetch `/api/auth/session` to get user data
5. Server components read cookies directly via `next/headers`

### Role-Based Access Control

| Role | Permissions |
|------|------------|
| `ADMIN` | Full access to all features including settings |
| `ANALYST` | Create applications, run engine, process approvals |
| `VIEWER` | Read-only access to all pages, no underwriting actions |

---

## 7. Frontend Architecture

### Design System
- **Theme**: Dark mode with glassmorphism effects
- **Colors**: CSS custom properties (`--primary-*`, `--accent-*`)
- **Typography**: Inter font family from Google Fonts
- **Components**: Cards, badges, tables, progress bars, score gauges, timelines

### Key Components

| Component | Path | Type | Description |
|-----------|------|------|-------------|
| `Sidebar` | `components/Sidebar.tsx` | Client | Navigation + user session |
| `DecisionPanel` | `components/DecisionPanel.tsx` | Client | Underwriting actions (run engine, approve/reject) |
| `LoginPage` | `app/page.tsx` | Client | Authentication form |
| `DashboardPage` | `(dashboard)/dashboard/page.tsx` | Server | Stats + recent applications |
| `ApplicationDetailPage` | `(dashboard)/applications/[id]/page.tsx` | Server | Full application view + fraud checks |
| `NewApplicationPage` | `(dashboard)/applications/new/page.tsx` | Client | Multi-step form wizard |
| `PortfolioPage` | `(dashboard)/portfolio/page.tsx` | Server | Portfolio + risk governance metrics |

### Data Flow
- **Server Components**: Fetch data directly from Prisma (no API calls)
- **Client Components**: Use `fetch()` to call API routes
- **Session Cookie**: `httpOnly` → accessible only via server-side API (`/api/auth/session`)

---

## 8. Running the Application

```bash
# Install dependencies
npm install

# Set up database
npx prisma generate
npx prisma db push

# Seed sample data
npx ts-node seed.ts

# Start development server
npm run dev
# → http://localhost:3000
```

### Default Login Credentials
| Email | Password | Role |
|-------|----------|------|
| `admin@credflow.io` | `Admin@123` | ADMIN |
| `analyst@credflow.io` | `Analyst@123` | ANALYST |
