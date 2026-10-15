# CredFlow Underwriting Engine: Functional Flow

This document explains the logic behind the "System-Assisted Underwriting" in CredFlow. Although often referred to as an "AI Underwriter," the current implementation is a **highly explainable, rule-based scoring engine** that ensures transparency for credit analysts and auditors.

---

## 1. The Decision Pipeline

The decision engine (`packages/engine`, published as `@credflow/engine`) follows a 3-stage pipeline before arriving at a recommendation. Every threshold, band and weight below comes from the NBFC's **credit policy**, a versioned YAML file in `policies/`. The numbers in this document are from `policies/credflow-default.yaml`.

### Stage 1: Fraud & Compliance Pre-Checks
Before scoring, the system runs automated checks. If any **HIGH_RISK** flags are triggered (e.g., PAN/GSTIN mismatch or severe turnover anomalies), the system forcefully recommends a **REJECT** regardless of the score.

### Stage 2: Dimension Scoring
The system calculates a score out of **100** across five weighted dimensions.

### Stage 3: Eligibility Calculation
The system calculates the maximum loan amount the borrower can afford based on:
- **Cash Flow Limit**: Max EMI = Free Cash Flow ÷ minimum EMI coverage (1.5x), converted to a principal with a reducing-balance EMI at the policy's assumed rate (14% p.a.).
- **Collateral Limit**: Assessed Value adjusted by the LTV (Loan-to-Value) cap for that asset type.

---

## 2. Scoring Parameters (Default Policy)

| Dimension | Max points | Metric | Bands → points |
| :--- | :--- | :--- | :--- |
| **Cash Flow Strength** | 30 | FCF ÷ (requested amount ÷ 12) | ≥2 → 30 · ≥1.5 → 25 · ≥1.2 → 20 · ≥1 → 15 · ≥0.8 → 10 · else 5 |
| **EMI Coverage (DSCR)** | 25 | FCF ÷ EMI | ≥2.5 → 25 · ≥2 → 22 · ≥1.75 → 18 · ≥1.5 → 15 · ≥1.25 → 10 · else 5 |
| **Revenue Stability** | 20 | Coefficient of variation of monthly inflows (lower is better) | ≤0.15 → 20 · ≤0.25 → 17 · ≤0.35 → 14 · ≤0.5 → 10 · else 5 |
| **Collateral Coverage** | 15 | Collateral cap ÷ requested amount | ≥1.2 → 15 · ≥1 → 12 · ≥0.8 → 10 · ≥0.5 → 7 · else 4; +2 for LAP/FD; +1 for personal guarantee |
| **Business Profile** | 10 | Vintage + industry risk | Vintage ≥60m → 5 · ≥36m → 4 · ≥24m → 3 · ≥12m → 2 · else 1; industry LOW 5 / MEDIUM 3 / HIGH 1 |

Decision: **≥70 APPROVE**, **50–69 REFER**, **<50 REJECT**. A different NBFC can change any of these in its own policy file.

---

## 3. Concrete Example: SME Loan Analysis

The figures below are the engine's actual output for this input under `credflow-default@1.1.0`. The engine test suite checks them, so this example stays in sync with the code.

### **The Scenario**
- **Borrower**: "GreenTech Manufacturing Units"
- **Requested Amount**: ₹25,00,000 (25L)
- **Tenure**: 24 Months
- **Industry**: Manufacturing (Low Risk)
- **Vintage**: 48 Months (4 Years)
- **Financials**:
    - Avg Monthly Inflow: ₹8,00,000
    - Avg Monthly Expenses: ₹5,50,000
    - **Free Cash Flow (FCF)**: ₹2,50,000
    - **Volatility (CV)**: 18% (0.18)
- **Collateral**: Machinery worth ₹30,00,000 (LTV Limit: 60%), no personal guarantee
- **Identity**: PAN and GSTIN consistent; declared turnover ₹96L (in line with bank inflows), so fraud pre-checks are **CLEAR**

---

### **Step-by-Step Calculation**

#### **1. Cash Flow Strength (20/30)**
- Requested amount ÷ 12 = ₹2.08L
- FCF ratio = 2.5L ÷ 2.08L = **1.2x**, which hits the ≥1.2 band → **20 points**

#### **2. EMI Coverage (22/25)**
- EMI for ₹25L at 14% over 24 months = **₹1,20,032**
- Coverage = 2.5L ÷ 1.2L = **2.08x**, in the ≥2 band → **22 points**

#### **3. Revenue Stability (17/20)**
- CV 0.18 is in the ≤0.25 band → **17 points**

#### **4. Collateral Coverage (7/15)**
- Collateral cap = 60% of ₹30L = **₹18,00,000**
- Coverage = 18L ÷ 25L = **0.72**, in the ≥0.5 band → **7 points** (machinery gets no preferred-asset bonus)

#### **5. Business Profile (9/10)**
- Vintage 48 months → **4 points**
- Manufacturing is LOW risk → **5 points**

---

### **Final Determination**

| Metric | Result |
| :--- | :--- |
| **Total Score** | **75 / 100** |
| **System Recommendation** | **APPROVE** (≥70) |
| **Cash Flow Eligibility** | ₹34,71,291 (max EMI ₹1.67L at 14% over 24 months) |
| **Collateral Eligibility** | ₹18,00,000 |
| **Recommended Amount** | **₹19,80,000** (collateral cap × 1.1 headroom) |

The recommended amount is below the requested ₹25L because, for secured loans, the engine takes the lowest of cash-flow eligibility, collateral cap × headroom, and the requested amount.

### **Explainability Output**
- ✅ **Approval reasons**: "Strong EMI coverage ratio (≥2x)", "Positive free cash flow (₹2.5L/month)", "Stable cash inflows with low volatility", "Secured by MACHINERY worth ₹30.0L", "Established business with 4+ years vintage", "Low-risk industry: Manufacturing"
- ⚠️ **Risk flags**: none
- 💡 **Recommendations**: "Consider limiting sanction to ₹18.0L for full collateral coverage", "Recommended amount (₹19.8L) is lower than requested (₹25.0L) based on eligibility", "Bureau data not available. Proceeding with cash-flow based assessment."
