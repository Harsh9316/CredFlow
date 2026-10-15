-- CreateTable
CREATE TABLE "NBFC" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "licenseNo" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NBFC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ANALYST',
    "nbfcId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Borrower" (
    "id" TEXT NOT NULL,
    "nbfcId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "legalName" TEXT,
    "pan" TEXT,
    "gstin" TEXT,
    "industry" TEXT NOT NULL,
    "subIndustry" TEXT,
    "constitution" TEXT NOT NULL,
    "vintage" INTEGER NOT NULL,
    "annualTurnover" DOUBLE PRECISION,
    "employeeCount" INTEGER,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "contactPerson" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "id" TEXT NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "nbfcId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "requestedAmount" DOUBLE PRECISION NOT NULL,
    "requestedTenure" INTEGER NOT NULL,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "sourcePlatform" TEXT,
    "sourceReference" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assignedTo" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "sanctionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialData" (
    "id" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalCredits" DOUBLE PRECISION,
    "totalDebits" DOUBLE PRECISION,
    "avgMonthlyInflow" DOUBLE PRECISION,
    "avgMonthlyExpenses" DOUBLE PRECISION,
    "freeCashFlow" DOUBLE PRECISION,
    "inflowVolatility" DOUBLE PRECISION,
    "totalInvoiceValue" DOUBLE PRECISION,
    "avgInvoiceValue" DOUBLE PRECISION,
    "invoiceCount" INTEGER,
    "monthlyData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collateral" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "collateralType" TEXT NOT NULL,
    "description" TEXT,
    "assessedValue" DOUBLE PRECISION NOT NULL,
    "ltv" DOUBLE PRECISION NOT NULL,
    "collateralCap" DOUBLE PRECISION NOT NULL,
    "hasPersonalGuarantee" BOOLEAN NOT NULL DEFAULT false,
    "guarantorName" TEXT,
    "guarantorRelation" TEXT,
    "valuationDate" TIMESTAMP(3),
    "valuationAgency" TEXT,
    "documentReference" TEXT,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collateral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditDecision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "creditScore" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "cashFlowEligible" DOUBLE PRECISION NOT NULL,
    "collateralEligible" DOUBLE PRECISION NOT NULL,
    "finalRecommendedAmt" DOUBLE PRECISION NOT NULL,
    "scoreBreakdown" TEXT,
    "approvalReasons" TEXT,
    "riskFlags" TEXT,
    "recommendations" TEXT,
    "calculationInputs" TEXT,
    "policyId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "finalDecision" TEXT NOT NULL,
    "overrideSystem" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "sanctionedAmount" DOUBLE PRECISION,
    "sanctionedTenure" INTEGER,
    "interestRate" DOUBLE PRECISION,
    "processingFee" DOUBLE PRECISION,
    "conditions" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPolicy" (
    "id" TEXT NOT NULL,
    "nbfcId" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NBFC_code_key" ON "NBFC"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "LoanApplication_applicationNo_key" ON "LoanApplication"("applicationNo");

-- CreateIndex
CREATE UNIQUE INDEX "Collateral_applicationId_key" ON "Collateral"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditDecision_applicationId_key" ON "CreditDecision"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_applicationId_key" ON "Approval"("applicationId");

-- CreateIndex
CREATE INDEX "CreditPolicy_nbfcId_isActive_idx" ON "CreditPolicy"("nbfcId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPolicy_nbfcId_policyKey_version_key" ON "CreditPolicy"("nbfcId", "policyKey", "version");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_nbfcId_fkey" FOREIGN KEY ("nbfcId") REFERENCES "NBFC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_nbfcId_fkey" FOREIGN KEY ("nbfcId") REFERENCES "NBFC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_nbfcId_fkey" FOREIGN KEY ("nbfcId") REFERENCES "NBFC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialData" ADD CONSTRAINT "FinancialData_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collateral" ADD CONSTRAINT "Collateral_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditDecision" ADD CONSTRAINT "CreditDecision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditDecision" ADD CONSTRAINT "CreditDecision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "CreditPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditPolicy" ADD CONSTRAINT "CreditPolicy_nbfcId_fkey" FOREIGN KEY ("nbfcId") REFERENCES "NBFC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
