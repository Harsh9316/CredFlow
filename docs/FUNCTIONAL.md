# Credrail — Functional Specification

## 1. Overview

**Credrail** is a B2B SaaS platform for NBFC credit underwriting and SME lending decisioning. It provides system-assisted underwriting with analyst control — standardizing analysis, improving speed, and strengthening auditability.

> *Credrail does not replace NBFC credit policy. It standardizes analysis, improves speed, and strengthens auditability.*

### Key Capabilities
- System-assisted underwriting with full analyst control at every step
- Fraud / credit risk separation (fraud = reject, credit = price)
- Cash-flow based underwriting with collateral-aware loan sizing
- Bureau overlay as negative filter (absence ≠ rejection)
- Multi-step loan application origination (LOS-Lite)
- RBI-compliant approval workflows with mandatory audit trail
- Portfolio-level risk governance and concentration monitoring
- Role-based access control for team management

### Out of Scope (v1)

| Excluded from v1 | Rationale |
|---|---|
| Loan disbursement & repayment processing | Operational banking — separate system |
| Collections & recovery workflows | Post-default processes |
| Legal documentation generation | Requires legal template engine |
| Asset valuation & charge registration | Field verification dependency |
| Borrower-facing portals | B2C layer — not core underwriting |

---

## 2. User Roles

| Role | Description | Capabilities |
|------|-------------|-------------|
| **NBFC Admin** | Organization administrator | Full system access, settings management, user oversight |
| **Credit Analyst** | Underwriting officer | Create applications, run engine, approve/reject loans |
| **Viewer** | Read-only stakeholder | View dashboards, applications, portfolio (no actions) |

---

## 3. Modules & Features

### 3.1 Authentication & Login

**Purpose**: Secure access to the platform with role-based permissions.

| Feature | Description |
|---------|-------------|
| Login form | Email + password authentication |
| Session management | Server-side secure cookie-based sessions |
| Role enforcement | Actions restricted based on user role |
| Demo credentials | Pre-seeded accounts for testing |

---

### 3.2 Dashboard

**Purpose**: Real-time overview of lending operations.

| Widget | Data Shown |
|--------|-----------|
| Total Applications | Count of all loan applications |
| Approved / Sanctioned | Count + approval rate percentage |
| Under Review | Pending applications + average TAT |
| Rejected | Count of rejected applications |
| Recent Applications | Last 10 applications with status, borrower, amount |

**Actions**: Navigate to application detail, create new application.

---

### 3.3 New Loan Application (LOS-Lite)

**Purpose**: Multi-step wizard for creating a new SME loan application.

#### Step 1: Borrower Profile
| Field | Type | Required |
|-------|------|----------|
| Business Name | Text | ✓ |
| Legal Name | Text | |
| Industry | Dropdown (14 industries) | ✓ |
| Constitution | Dropdown (5 types) | ✓ |
| PAN | Text (10 char) | |
| GSTIN | Text (15 char) | |
| Business Vintage | Number (months) | ✓ |
| Annual Turnover | Currency (₹) | |
| Contact Person | Text | ✓ |
| Contact Phone | Text | ✓ |
| City / State | Text | |

#### Step 2: Loan Details
| Field | Type | Required |
|-------|------|----------|
| Requested Amount | Currency (₹) | ✓ |
| Requested Tenure | Number (months) | ✓ |
| Purpose | Text | |
| Priority | Dropdown (Low/Normal/High/Urgent) | |

#### Step 3: Financial Information
| Field | Type | Required |
|-------|------|----------|
| Avg Monthly Inflow | Currency (₹) | ✓ |
| Avg Monthly Expenses | Currency (₹) | ✓ |
| Inflow Volatility (CV) | Decimal | |
| Free Cash Flow | Auto-calculated | — |

#### Step 4: Security & Collateral
| Field | Type | Required |
|-------|------|----------|
| Collateral Type | Dropdown (6 types) | |
| Assessed Value | Currency (₹) | If secured |
| LTV (%) | Number | If secured |
| Personal Guarantee | Checkbox | |
| Guarantor Name | Text | If PG checked |

**Output**: Application created with auto-generated application number (e.g., `FFC-2026-0010`), redirect to application detail page.

---

### 3.4 Application Detail & Underwriting Flow

**Purpose**: Comprehensive view of a single application with full underwriting pipeline.

#### Information Sections
| Section | Content |
|---------|---------|
| Borrower Profile | Legal name, constitution, industry, vintage, GSTIN, turnover, contact |
| Loan Request | Amount, tenure, purpose, source platform |
| Financial Analysis | Monthly inflow/outflow/FCF, volatility chart, monthly cash flow bars |
| Collateral & Security | Type, assessed value, LTV, collateral cap, guarantor |

#### 3-Stage Underwriting Pipeline

**Stage 1: Fraud Pre-Checks** (runs automatically when engine triggered)

| Check | Signal | Severity |
|-------|--------|----------|
| PAN/GSTIN mismatch | Identity fraud | CRITICAL |
| No PAN + no GSTIN | Unverifiable entity | WARNING |
| Inflow >2.5x average in any month | Round-tripping / window dressing | WARNING |
| Bank inflow <30% of declared turnover | Inflated financials | CRITICAL |
| Vintage <6 mo + loan >₹25L | Shell entity risk | WARNING |
| Loan amount > annual turnover | Capacity concern | WARNING |

*Fraud signals are displayed in a dedicated "Fraud Pre-Checks" card with CLEAR / REVIEW / HIGH_RISK status.*
*Fraud signals are advisory to the analyst except HIGH_RISK flags, which enforce a system-level rejection recommendation.*
*HIGH_RISK = automatic rejection override. REVIEW = analyst awareness flag.*

**Stage 2: Bureau Overlay** (optional, negative filter)

> Bureau score is used as a **negative filter only**. Absence of bureau data does NOT imply rejection. Cash-flow based underwriting remains primary.

| Scenario | Effect |
|----------|--------|
| Bureau not available | No impact — proceed with cash-flow assessment |
| Score ≥ 750 | +5 modifier |
| Score 650–749 | Neutral |
| Score 500–649 | -3 modifier |
| Score < 500 | -7 modifier |
| CIBIL/CRIF fraud alert | Hard stop — application flagged |
| DPD 90+ delinquency | -10 modifier |

*Bureau status is displayed in the Fraud Pre-Checks card.*

**Stage 3: Credit Scoring** (rule-based, explainable)

Results displayed in "Underwriting Recommendation" card:

| Output | Description |
|--------|-------------|
| Score (0–100) | Color-coded gauge with breakdown |
| Recommendation | APPROVE / REFER / REJECT |
| Eligibility Amounts | Cash flow eligible, collateral eligible, final recommended |
| Approval Reasons | Positive factors (e.g., "Strong EMI coverage ≥2x") |
| Risk Flags | Concerns including fraud flags (e.g., "Unsecured exposure") |
| Recommendations | Actionable suggestions (e.g., "Consider obtaining collateral") |

#### Underwriting Action Panel

| Action | When Available | What Happens |
|--------|---------------|-------------|
| **Run Underwriting Engine** | When no decision exists | Runs full 3-stage pipeline. Status → `UNDER_REVIEW` |
| **Approve & Sanction** | After recommendation generated | Form for sanction details. Status → `SANCTIONED` |
| **Reject** | After recommendation generated | Override reason required if system recommends APPROVE. Status → `REJECTED` |
| **Refer for Review** | After recommendation generated | Analyst escalation. Status stays `UNDER_REVIEW` |
| **Re-run Engine** | After recommendation generated | Re-calculates with latest data |

#### System Override Support
When the analyst's decision differs from the engine recommendation:
- Warning banner displayed ("System Override")
- Override reason is **mandatory**
- Override flag recorded in Approval record
- Audit log records the override event

#### Sanction Details
When approving, analyst enters:
- Sanctioned amount, tenure, interest rate, processing fee
- Conditions (free text)
- *Collateral enforcement note*: If secured, displays "Collateral charge creation, registration, and enforcement to be handled as per NBFC internal recovery and security enforcement process."

---

### 3.5 Underwriting Recommendation Engine

> System-assisted underwriting with analyst control. The engine produces recommendations — analysts make decisions.

#### Scoring Dimensions
| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Cash Flow Strength | 30% | FCF-to-EMI ratio |
| EMI Coverage | 25% | Ability to service EMI from free cash flow |
| Revenue Stability | 20% | Inflow coefficient of variation |
| Collateral Coverage | 15% | Collateral value vs. loan amount + type quality |
| Business Profile | 10% | Vintage (years) + industry risk rating |

#### Industry Risk Classification
| Risk Band | Industries |
|-----------|-----------|
| **Low** | Manufacturing, IT Services, Healthcare |
| **Medium** | Retail, Construction, Agriculture, Trading |
| **High** | Real Estate, Hospitality |

#### Collateral LTV Limits
| Collateral Type | Max LTV |
|-----------------|---------|
| Fixed Deposit | 90% |
| Invoice Financing | 80% |
| Loan Against Property | 70% |
| Machinery | 60% |
| Stock / Inventory | 50% |

---

### 3.6 Portfolio View & Risk Governance

**Purpose**: Overview of sanctioned/active loans **and** portfolio-level concentration risk monitoring.

#### Portfolio Summary
| Widget | Data Shown |
|--------|-----------|
| Active Loans | Count |
| Total Sanctioned | Sum of all sanctioned amounts |
| Active Borrowers | Unique borrower count |
| Secured % | Percentage of secured loans |
| Avg Loan Size | Portfolio average |

#### Risk Governance Dashboard

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| **Security Ratio** | Secured vs. unsecured split (%) with progress bar | Unsecured > 60% |
| **Industry Exposure %** | Top 5 industries by sanctioned amount with % | Any industry > 35% |
| **Top Borrower Exposure** | Top 5 borrowers by total sanctioned amount with % | Any borrower > 25% |
| **Concentration Warnings** | Auto-generated alerts when thresholds exceeded | Yellow alert banner |

*Concentration warnings are displayed as prominent alert banners above the metrics grid when any industry exceeds 35% of total portfolio.*

#### Collateral & Industry Breakdown
| Widget | Data Shown |
|--------|-----------|
| Security Classification | Breakdown by collateral type with count and value |
| Industry Exposure | Distribution of loans by industry with progress bars |

#### Active Loans Table
Application no, borrower, industry, sanctioned amount, tenure, interest rate, security type.

---

### 3.7 Settings (Credit Policy)

**Purpose**: Show the credit policy the engine applies to this NBFC's decisions.

Each NBFC has one active, versioned credit policy (see `policies/*.yaml`). The Settings page displays it read-only:

| Section | Contents |
|---------|----------|
| Active policy | Name, `id@version`, SHA-256 checksum |
| Decision thresholds | Approve / refer / reject score ranges |
| Affordability | EMI method and assumed rate, min EMI coverage, unsecured sizing, collateral headroom |
| Scorecard | Max points and bands for all five components |
| LTV limits | Per collateral type |
| Industry risk | Industry → LOW / MEDIUM / HIGH, plus the default for unlisted industries |
| Fraud pre-checks | Each rule's status, severity and trigger; the hard-stop severity |
| Bureau overlay | Score-band and delinquency modifiers |
| Policy history | Every version applied, when it was activated, and how many decisions used it |

Policies are changed by applying a new version with `npm run policy -- apply <file> --nbfc <CODE>`. Editing policies in the UI is planned.

---

## 4. Workflow: End-to-End Loan Processing

```
1. ANALYST creates New Application (4-step form), or an integrated system creates it via the API
   └→ Status: APPLIED

2. ANALYST runs Underwriting Engine
   ├→ (Optional) Data connectors: bureau report, GSTIN status, PAN verification
   ├→ Stage 1: Fraud pre-checks (PAN/GSTIN, GSTIN status, PAN verification, inflow spikes, turnover mismatch...)
   │   └→ If HIGH_RISK: auto-reject recommendation
   ├→ Stage 2: Bureau overlay (optional negative filter)
   │   └→ Score modifier applied (-10 to +5)
   └→ Stage 3: Credit scoring (5 dimensions, 100-point scale)
       └→ Recommendation: APPROVE / REFER / REJECT
       └→ Status: UNDER_REVIEW

3. ANALYST (maker) reviews recommendation + fraud checks + risk flags
   ├→ If APPROVE: Enter sanction details
   │   ├→ Within the policy's single-approver limit, not an override → Status: SANCTIONED
   │   └→ Above the limit, or overriding the system (per policy) → Status: PENDING_APPROVAL
   ├→ If REJECT: Confirm rejection → Status: REJECTED
   └→ If REFER: Send for additional review → stays UNDER_REVIEW
   (Any override of the system recommendation requires a reason)

4. CHECKER (a different user, in a role the policy allows; ADMIN by default)
   ├→ CONFIRM → Status: SANCTIONED (maker and checker both recorded)
   └→ RETURN with remarks → Status: UNDER_REVIEW

5. All actions logged in the append-only Audit Trail (user or API key, timestamp, details)
6. Each step emits an event (webhooks / GET /api/v1/events) for downstream systems
7. Portfolio Risk Governance monitors concentration automatically
```

---

## 5. Data Seeding (Demo Data)

| Entity | Count | Details |
|--------|-------|---------|
| NBFC | 2 | FinFirst Capital, SME Growth Finance |
| Users | 5 | FinFirst: Admin, 2 Analysts, Viewer; SME Growth: Admin |
| Loan applications | 16 | Spread over the last ~3 months: sanctioned, awaiting checker, in review, referred, rejected (including one PAN/GSTIN fraud hard-stop) and not yet evaluated |
| Credit decisions | 14 | Produced by the real engine under each NBFC's policy, so scores and reasons are genuine |
| Sanctioned book | ₹3.3 Cr | FinFirst: 7 loans across 7 industries, within concentration limits; sanctions above ₹25 L carry a recorded checker. SME Growth: 1 loan |
| Audit logs | 40+ | Consistent with each application's history |

The seed is deterministic: every run produces the same data, with dates relative to today.

### Demo Credentials
| Email | Password | Role |
|-------|----------|------|
| `admin@credrail.dev` | `Admin@123` | NBFC Admin |
| `analyst@credrail.dev` | `Analyst@123` | Credit Analyst |
| `analyst2@credrail.dev` | `Analyst@123` | Credit Analyst |
| `viewer@credrail.dev` | `Viewer@123` | Viewer |
| `admin@smegrowth.in` | `Admin@123` | NBFC Admin (SME Growth Finance) |
