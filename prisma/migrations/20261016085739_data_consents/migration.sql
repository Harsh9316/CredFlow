-- AlterTable
ALTER TABLE "FinancialData" ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "metrics" JSONB,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "DataConsent" (
    "id" TEXT NOT NULL,
    "nbfcId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "applicationId" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerConsentId" TEXT,
    "status" TEXT NOT NULL,
    "consentUrl" TEXT,
    "fiTypes" TEXT[],
    "dataFrom" TIMESTAMP(3),
    "dataTo" TIMESTAMP(3),
    "sessionId" TEXT,
    "sessionStatus" TEXT,
    "mobileMasked" TEXT,
    "method" TEXT,
    "reference" TEXT,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdByApiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataConsent_nbfcId_borrowerId_idx" ON "DataConsent"("nbfcId", "borrowerId");

-- CreateIndex
CREATE INDEX "DataConsent_sessionId_idx" ON "DataConsent"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "DataConsent_provider_providerConsentId_key" ON "DataConsent"("provider", "providerConsentId");

-- AddForeignKey
ALTER TABLE "FinancialData" ADD CONSTRAINT "FinancialData_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "DataConsent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataConsent" ADD CONSTRAINT "DataConsent_nbfcId_fkey" FOREIGN KEY ("nbfcId") REFERENCES "NBFC"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataConsent" ADD CONSTRAINT "DataConsent_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataConsent" ADD CONSTRAINT "DataConsent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "LoanApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

