# CredFlow Underwriting Engine: Functional Flow

This document explains the logic behind the "System-Assisted Underwriting" in CredFlow. Although often referred to as an "AI Underwriter," the current implementation is a **highly explainable, rule-based scoring engine** that ensures transparency for credit analysts and auditors.

---

## 1. The Decision Pipeline

The decision engine follows a 3-stage pipeline before arriving at a recommendation:

### Stage 1: Fraud & Compliance Pre-Checks
Before scoring, the system runs automated checks. If any **HIGH_RISK** flags are triggered (e.g., PAN/GSTIN mismatch or severe turnover anomalies), the system forcefully recommends a **REJECT** regardless of the score.

### Stage 2: Dimension Scoring
The system calculates a score out of **100** across five weighted dimensions.

### Stage 3: Eligibility Calculation
The system calculates the maximum loan amount the borrower can afford based on:
- **Cash Flow Limit**: Max EMI derived from Free Cash Flow (FCF).
- **Collateral Limit**: Assessed Value adjusted by the LTV (Loan-to-Value) cap for that asset type.

---

## 2. Scoring Parameters (Weights)

| Dimension | Weight | Criteria |
| :--- | :--- | :--- |
| **Cash Flow Strength** | 30% | Ratio of Monthly Free Cash Flow to Monthly Loan Installment. |
| **EMI Coverage (DSCR)** | 25% | Direct multiplier of cash flow vs. EMI. (Target: >1.5x) |
| **Revenue Stability** | 20% | Coefficient of Variation (CV) of monthly bank inflows. Lower is better. |
| **Collateral Coverage** | 15% | Value of security vs. Requested Amount. Bonus for liquid assets (FD). |
| **Business Profile** | 10% | Business vintage (months) + Industry risk classification (Low/Med/High). |

---

## 3. Concrete Example: SME Loan Analysis

Let's look at how the engine evaluates a real-world SME application.

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
- **Collateral**: Machinery worth ₹30,00,000 (LTV Limit: 60%)

---

### **Step-by-Step Calculation**

#### **1. Cash Flow Strength (Score: 30/30)**
- Monthly Installment Burden = 25L / 12 months = ₹2.08L
- FCF Ratio = 2.5L / 2.08L = **1.2x**
- *Score Trigger*: Since ratio is >1.2x, it receives top marks for capacity.

#### **2. EMI Coverage (Score: 18/25)**
- Projected EMI for 25L at 12% for 24mo = ~₹1.18L
- Coverage Ratio = 2.5L (FCF) / 1.18L (EMI) = **2.11x**
- *Score Trigger*: Since coverage is between 2.0x and 2.5x, it receives **18 points**.

#### **3. Revenue Stability (Score: 17/20)**
- Volatility (CV) is 0.18.
- *Score Trigger*: CV between 0.15 and 0.25 receives **17 points**.

#### **4. Collateral Coverage (Score: 12/15)**
- Effective LTV Cap = 60% of 30L = **₹18,00,000**
- Collateral Coverage = 18L / 25L (Requested) = **72%**
- *Score Trigger*: High coverage but not 1:1. Base 10 + 2 for asset quality.

#### **5. Business Profile (Score: 9/10)**
- Vintage 48 months: **+4 points**
- Low-Risk Industry (Manufacturing): **+5 points**
- Total: **9 points**.

---

### **Final Determination**

| Metric | Result |
| :--- | :--- |
| **Total Score** | **86 / 100** |
| **System Recommendation** | **APPROVE** (Threshold > 70) |
| **Cash Flow Eligibility** | ₹32,00,000 |
| **Collateral Eligibility** | ₹18,00,000 |
| **Final Sanction Amount** | **₹20,00,000** |

> [!NOTE]
> The final sanction amount is lower than the requested 25L because the system prioritized **security coverage**. Even though the cash flow could support 32L, the collateral only safely covers ~18-20L.

### **Explainability Snippet (Engine Output)**
- ✅ **Approval Reasons**: "Strong EMI coverage ratio (≥2x)", "Established business (4+ years)", "Low-risk industry".
- ⚠️ **Risk Flags**: "Collateral shortfall for full requested amount".
- 💡 **Recommendations**: "Limit sanction to ₹20L or request additional personal guarantee".
