// Loan application use cases, shared by the dashboard's routes and the public API.
// Every function is scoped to the actor's NBFC; another NBFC's records are "not found".

import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import {
  COLLATERAL_TYPES,
  canActAsChecker,
  checkerRequirements,
  evaluateApplication,
  parsePolicy,
  type ApplicationInput,
  type CollateralType,
  type CreditPolicy,
  type Evaluation,
  type MonthlyFlow,
} from '@credrail/engine'
import { getActivePolicy } from '@/lib/policy'
import { getConnectors } from '@/lib/connectors'
import { ServiceError, notFound } from './errors'
import { auditActor, type Actor } from './actor'
import { recordEvent } from './events'

// ───────────────────────── Input schemas ─────────────────────────

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const upper = (s: string) => s.trim().toUpperCase()
const optionalText = z.string().trim().max(500).optional()

export const MonthlyFlowSchema = z.object({
  month: z.string().min(1).max(20).describe('Label for the month, e.g. 2026-08'),
  inflow: z.number().min(0),
  outflow: z.number().min(0),
})

export const NewBorrowerSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  legalName: optionalText,
  pan: z.string().transform(upper).pipe(z.string().regex(PAN, 'invalid PAN format')).optional(),
  gstin: z.string().transform(upper).pipe(z.string().regex(GSTIN, 'invalid GSTIN format')).optional(),
  industry: z.string().trim().min(1).max(100),
  subIndustry: optionalText,
  constitution: z.string().trim().min(1).max(100).describe('Proprietorship, Partnership, LLP, Pvt Ltd, ...'),
  vintage: z.number().int().min(0).describe('Months in business'),
  annualTurnover: z.number().min(0).optional(),
  employeeCount: z.number().int().min(0).optional(),
  address: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: z.string().trim().max(10).optional(),
  contactPerson: z.string().trim().min(1).max(200),
  contactPhone: z.string().trim().min(5).max(20),
  contactEmail: z.email().optional(),
})

export const CreateApplicationSchema = z
  .object({
    borrowerId: z.string().optional().describe('Use an existing borrower of your NBFC instead of `borrower`'),
    borrower: NewBorrowerSchema.optional(),
    requestedAmount: z.number().positive(),
    requestedTenure: z.number().int().min(1).max(360).describe('Months'),
    purpose: optionalText,
    sourcePlatform: z.string().trim().max(50).optional().describe('ERP, POS, Marketplace, ...'),
    sourceReference: z.string().trim().max(100).optional().describe("Your own reference for this application"),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    financial: z
      .object({
        avgMonthlyInflow: z.number().min(0).optional(),
        avgMonthlyExpenses: z.number().min(0).optional(),
        freeCashFlow: z.number().optional().describe('Defaults to inflow minus expenses'),
        inflowVolatility: z.number().min(0).optional().describe('Coefficient of variation; computed from monthlyData if omitted'),
        monthlyData: z.array(MonthlyFlowSchema).max(36).optional(),
        bankDataConsentHandle: z.string().max(200).optional().describe('Account Aggregator consent handle; monthly flows are fetched through the bank-data connector'),
      })
      .optional(),
    collateral: z
      .object({
        type: z.enum(COLLATERAL_TYPES),
        description: optionalText,
        assessedValue: z.number().positive(),
        ltv: z.number().min(0).max(100).describe('Requested LTV %; capped by the policy limit'),
        hasPersonalGuarantee: z.boolean().default(false),
        guarantorName: optionalText,
        guarantorRelation: optionalText,
      })
      .optional(),
  })
  .refine(v => !!v.borrowerId !== !!v.borrower, { message: 'provide exactly one of borrowerId or borrower', path: ['borrower'] })

export type CreateApplicationInput = z.input<typeof CreateApplicationSchema>

export const DecisionActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('APPROVE'),
    sanctionedAmount: z.number().positive().optional(),
    sanctionedTenure: z.number().int().min(1).max(360).optional(),
    interestRate: z.number().min(0).max(100).optional(),
    processingFee: z.number().min(0).max(100).optional(),
    conditions: z.array(z.string().trim().min(1)).max(50).optional(),
    overrideReason: z.string().trim().max(1000).optional(),
  }),
  z.object({ action: z.literal('REJECT'), overrideReason: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('REFER'), overrideReason: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('CONFIRM'), remarks: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('RETURN'), remarks: z.string().trim().min(1, 'remarks are required when returning').max(1000) }),
])

export type DecisionAction = z.infer<typeof DecisionActionSchema>

// ───────────────────────── Helpers ─────────────────────────

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.round((Math.sqrt(variance) / mean) * 1000) / 1000
}

const applicationInclude = {
  borrower: true,
  collateral: true,
  creditDecision: { include: { policy: { select: { policyKey: true, version: true, checksum: true } } } },
  approval: true,
} satisfies Prisma.LoanApplicationInclude

type ApplicationWithRelations = Prisma.LoanApplicationGetPayload<{ include: typeof applicationInclude }>

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

/** Public representation of an application (used by the API and in webhook payloads). */
export function serializeApplication(app: ApplicationWithRelations) {
  const d = app.creditDecision
  const a = app.approval
  return {
    id: app.id,
    applicationNo: app.applicationNo,
    status: app.status,
    requestedAmount: app.requestedAmount,
    requestedTenure: app.requestedTenure,
    purpose: app.purpose,
    priority: app.priority,
    sourcePlatform: app.sourcePlatform,
    sourceReference: app.sourceReference,
    appliedAt: app.appliedAt.toISOString(),
    borrower: {
      id: app.borrower.id,
      businessName: app.borrower.businessName,
      industry: app.borrower.industry,
      constitution: app.borrower.constitution,
      vintage: app.borrower.vintage,
      city: app.borrower.city,
      state: app.borrower.state,
    },
    collateral: app.collateral && {
      type: app.collateral.collateralType,
      assessedValue: app.collateral.assessedValue,
      ltv: app.collateral.ltv,
      hasPersonalGuarantee: app.collateral.hasPersonalGuarantee,
    },
    evaluation: d && {
      decision: d.decision,
      creditScore: d.creditScore,
      scoreBreakdown: parseJson(d.scoreBreakdown, null),
      cashFlowEligible: d.cashFlowEligible,
      collateralEligible: d.collateralEligible,
      recommendedAmount: d.finalRecommendedAmt,
      approvalReasons: parseJson<string[]>(d.approvalReasons, []),
      riskFlags: parseJson<string[]>(d.riskFlags, []),
      recommendations: parseJson<string[]>(d.recommendations, []),
      policy: d.policy ? { id: d.policy.policyKey, version: d.policy.version, checksum: d.policy.checksum } : null,
      evaluatedAt: d.generatedAt.toISOString(),
    },
    approval: a && {
      decision: a.finalDecision,
      status: a.status,
      sanctionedAmount: a.sanctionedAmount,
      sanctionedTenure: a.sanctionedTenure,
      interestRate: a.interestRate,
      overrideSystem: a.overrideSystem,
      decidedAt: a.approvedAt.toISOString(),
      checkedAt: a.checkedAt?.toISOString() ?? null,
    },
  }
}

export type ApplicationResource = ReturnType<typeof serializeApplication>

/** Compact form included in webhook payloads. */
const eventPayload = (app: ApplicationWithRelations, extra: Record<string, unknown> = {}) =>
  JSON.parse(JSON.stringify({ application: serializeApplication(app), ...extra })) as Prisma.InputJsonObject

async function loadApplication(tx: Prisma.TransactionClient, nbfcId: string, id: string) {
  const app = await tx.loanApplication.findFirst({ where: { id, nbfcId }, include: applicationInclude })
  if (!app) throw notFound('Application')
  return app
}

// ───────────────────────── Queries ─────────────────────────

export async function getApplication(actor: Actor, id: string): Promise<ApplicationResource> {
  return serializeApplication(await loadApplication(prisma, actor.nbfcId, id))
}

export async function listApplications(
  actor: Actor,
  params: { status?: string; limit?: number; cursor?: string }
): Promise<{ data: ApplicationResource[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100)
  const rows = await prisma.loanApplication.findMany({
    where: { nbfcId: actor.nbfcId, ...(params.status && { status: params.status }) },
    include: applicationInclude,
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(params.cursor && { cursor: { id: params.cursor }, skip: 1 }),
  })
  const page = rows.slice(0, limit)
  return { data: page.map(serializeApplication), nextCursor: rows.length > limit ? page[page.length - 1].id : null }
}

// ───────────────────────── Create ─────────────────────────

export async function createApplication(actor: Actor, raw: unknown): Promise<ApplicationResource> {
  const input = CreateApplicationSchema.parse(raw)
  const { bankData } = getConnectors()

  // External calls happen before the transaction so it stays short
  let monthlyData: MonthlyFlow[] | undefined = input.financial?.monthlyData
  if (input.financial?.bankDataConsentHandle) {
    if (!bankData) throw new ServiceError(422, 'connector_unavailable', 'No bank-data connector is configured (CONNECTOR_BANK_DATA)')
    monthlyData = await bankData.fetchMonthlyFlows(input.financial.bankDataConsentHandle)
  }

  const fin = input.financial
  const avgInflow = fin?.avgMonthlyInflow ?? (monthlyData?.length ? monthlyData.reduce((a, m) => a + m.inflow, 0) / monthlyData.length : undefined)
  const avgExpenses = fin?.avgMonthlyExpenses ?? (monthlyData?.length ? monthlyData.reduce((a, m) => a + m.outflow, 0) / monthlyData.length : undefined)

  const created = await prisma.$transaction(async tx => {
    let borrowerId = input.borrowerId
    if (borrowerId) {
      const owned = await tx.borrower.findFirst({ where: { id: borrowerId, nbfcId: actor.nbfcId }, select: { id: true } })
      if (!owned) throw notFound('Borrower')
    } else {
      // A PAN/GSTIN mismatch is accepted here and flagged by the fraud pre-check, with an explanation
      const b = input.borrower!
      const borrower = await tx.borrower.create({
        data: { ...b, nbfcId: actor.nbfcId, legalName: b.legalName || b.businessName },
      })
      borrowerId = borrower.id
    }

    // Atomic per-NBFC counter, so concurrent requests never get the same number
    const nbfc = await tx.nBFC.update({
      where: { id: actor.nbfcId },
      data: { applicationSeq: { increment: 1 } },
      select: { code: true, applicationSeq: true },
    })
    const applicationNo = `${nbfc.code}-${new Date().getFullYear()}-${String(nbfc.applicationSeq).padStart(4, '0')}`

    const application = await tx.loanApplication.create({
      data: {
        applicationNo,
        nbfcId: actor.nbfcId,
        borrowerId,
        requestedAmount: input.requestedAmount,
        requestedTenure: input.requestedTenure,
        purpose: input.purpose ?? null,
        sourcePlatform: input.sourcePlatform ?? (actor.kind === 'api_key' ? 'API' : 'Direct'),
        sourceReference: input.sourceReference ?? null,
        priority: input.priority,
      },
    })

    if (avgInflow !== undefined && avgExpenses !== undefined) {
      const months = monthlyData?.length ?? 6
      await tx.financialData.create({
        data: {
          borrowerId,
          dataType: input.financial?.bankDataConsentHandle ? 'ACCOUNT_AGGREGATOR' : 'BANK_STATEMENT',
          periodStart: new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000),
          periodEnd: new Date(),
          avgMonthlyInflow: avgInflow,
          avgMonthlyExpenses: avgExpenses,
          freeCashFlow: fin?.freeCashFlow ?? avgInflow - avgExpenses,
          inflowVolatility: fin?.inflowVolatility ?? (monthlyData?.length ? coefficientOfVariation(monthlyData.map(m => m.inflow)) : 0.2),
          totalCredits: avgInflow * months,
          totalDebits: avgExpenses * months,
          monthlyData: monthlyData?.length ? JSON.stringify(monthlyData) : null,
        },
      })
    }

    if (input.collateral && input.collateral.type !== 'NONE') {
      const c = input.collateral
      await tx.collateral.create({
        data: {
          applicationId: application.id,
          collateralType: c.type,
          description: c.description ?? null,
          assessedValue: c.assessedValue,
          ltv: c.ltv,
          collateralCap: Math.round((c.assessedValue * c.ltv) / 100),
          hasPersonalGuarantee: c.hasPersonalGuarantee,
          guarantorName: c.guarantorName ?? null,
          guarantorRelation: c.guarantorRelation ?? null,
        },
      })
    }

    await tx.auditLog.create({
      data: {
        applicationId: application.id,
        ...auditActor(actor),
        action: 'APPLICATION_CREATED',
        details: JSON.stringify({ applicationNo, requestedAmount: input.requestedAmount, requestedTenure: input.requestedTenure }),
      },
    })

    const full = await loadApplication(tx, actor.nbfcId, application.id)
    await recordEvent(tx, actor.nbfcId, 'application.created', eventPayload(full))
    return full
  })

  return serializeApplication(created)
}

// ───────────────────────── Underwrite ─────────────────────────

type ConnectorSummary = Record<string, { provider: string; status: 'ok' | 'no_record' | 'error'; detail?: string }>

async function gatherExternalData(borrower: { pan: string | null; gstin: string | null; legalName: string | null; businessName: string }) {
  const { bureau, gst, kyc } = getConnectors()
  const summary: ConnectorSummary = {}
  const identity = { pan: borrower.pan, gstin: borrower.gstin, legalName: borrower.legalName || borrower.businessName }

  // Connector failures never block underwriting: the engine treats missing data as neutral
  const [bureauResult, gstResult, kycResult] = await Promise.allSettled([
    bureau ? bureau.fetchReport(identity) : Promise.resolve(undefined),
    gst && borrower.gstin ? gst.verifyGstin(borrower.gstin) : Promise.resolve(undefined),
    kyc && borrower.pan ? kyc.verifyPan(borrower.pan, identity.legalName) : Promise.resolve(undefined),
  ])

  let bureauInput: ApplicationInput['bureau'] = null
  if (bureau) {
    if (bureauResult.status === 'rejected') summary.bureau = { provider: bureau.provider, status: 'error', detail: String(bureauResult.reason) }
    else if (bureauResult.value === null) summary.bureau = { provider: bureau.provider, status: 'no_record' }
    else if (bureauResult.value) {
      const r = bureauResult.value
      bureauInput = { score: r.score, hasDelinquency: r.hasDelinquency, hasFraudAlert: r.hasFraudAlert }
      summary.bureau = { provider: r.provider, status: 'ok', detail: r.reportId }
    }
  }

  const verifications: NonNullable<ApplicationInput['verifications']> = {}
  if (gst && borrower.gstin) {
    if (gstResult.status === 'fulfilled' && gstResult.value) {
      verifications.gstinStatus = gstResult.value.status
      summary.gst = { provider: gst.provider, status: 'ok', detail: gstResult.value.status }
    } else if (gstResult.status === 'rejected') {
      summary.gst = { provider: gst.provider, status: 'error', detail: String(gstResult.reason) }
    }
  }
  if (kyc && borrower.pan) {
    if (kycResult.status === 'fulfilled' && kycResult.value) {
      verifications.panValid = kycResult.value.valid
      verifications.panNameMatch = kycResult.value.nameMatch
      summary.kyc = { provider: kyc.provider, status: 'ok', detail: kycResult.value.valid ? 'PAN verified' : 'PAN not verified' }
    } else if (kycResult.status === 'rejected') {
      summary.kyc = { provider: kyc.provider, status: 'error', detail: String(kycResult.reason) }
    }
  }

  return { bureauInput, verifications: Object.keys(verifications).length ? verifications : null, summary }
}

export async function underwriteApplication(actor: Actor, id: string): Promise<{
  application: ApplicationResource
  evaluation: Evaluation
  policy: { id: string; version: string; checksum: string }
  connectors: ConnectorSummary
}> {
  const app = await prisma.loanApplication.findFirst({
    where: { id, nbfcId: actor.nbfcId },
    include: { borrower: { include: { financialData: { orderBy: { periodEnd: 'desc' }, take: 1 } } }, collateral: true },
  })
  if (!app) throw notFound('Application')
  if (!['APPLIED', 'UNDER_REVIEW'].includes(app.status)) {
    throw new ServiceError(409, 'invalid_state', `Application is ${app.status}; only APPLIED or UNDER_REVIEW applications can be evaluated`)
  }
  const fd = app.borrower.financialData[0]
  if (!fd) throw new ServiceError(422, 'missing_financials', 'No financial data found for borrower. Please add financial data first.')

  const external = await gatherExternalData(app.borrower)
  const input: ApplicationInput = {
    requestedAmount: app.requestedAmount,
    requestedTenure: app.requestedTenure,
    borrower: {
      pan: app.borrower.pan,
      gstin: app.borrower.gstin,
      vintage: app.borrower.vintage,
      industry: app.borrower.industry,
      annualTurnover: app.borrower.annualTurnover,
    },
    financial: {
      avgMonthlyInflow: fd.avgMonthlyInflow || 0,
      avgMonthlyExpenses: fd.avgMonthlyExpenses || 0,
      freeCashFlow: fd.freeCashFlow || 0,
      inflowVolatility: fd.inflowVolatility || 0.5,
      monthlyData: parseJson<MonthlyFlow[]>(fd.monthlyData, []),
    },
    collateral: app.collateral && {
      type: app.collateral.collateralType as CollateralType,
      assessedValue: app.collateral.assessedValue,
      ltv: app.collateral.ltv,
      hasPersonalGuarantee: app.collateral.hasPersonalGuarantee,
    },
    bureau: external.bureauInput,
    verifications: external.verifications,
  }

  const { policy, policyId, checksum } = await getActivePolicy(actor.nbfcId)
  const result = evaluateApplication(input, policy)

  const decisionData = {
    creditScore: result.creditScore,
    decision: result.decision,
    cashFlowEligible: result.cashFlowEligible,
    collateralEligible: result.collateralEligible,
    finalRecommendedAmt: result.finalRecommendedAmt,
    scoreBreakdown: JSON.stringify(result.scoreBreakdown),
    approvalReasons: JSON.stringify(result.approvalReasons),
    riskFlags: JSON.stringify(result.riskFlags),
    recommendations: JSON.stringify(result.recommendations),
    calculationInputs: JSON.stringify({
      ...input,
      emi: result.emi,
      emiCoverageRatio: result.emiCoverageRatio,
      creditPolicyVersion: `${policy.id}@${policy.version}`,
      policyChecksum: checksum,
      connectors: external.summary,
      fraudPreCheck: {
        riskLevel: result.fraud.riskLevel,
        passed: result.fraud.passed,
        flagCount: result.fraud.flags.length,
        summary: result.fraud.summary,
      },
      bureauOverlay: {
        available: result.bureau.available,
        bureauScore: result.bureau.bureauScore,
        modifier: result.bureau.modifier,
        provider: external.summary.bureau?.provider,
      },
    }),
    policyId,
    generatedAt: new Date(),
  }

  const saved = await prisma.$transaction(async tx => {
    await tx.creditDecision.upsert({
      where: { applicationId: id },
      create: { applicationId: id, ...decisionData },
      update: decisionData,
    })
    // Guarded update: if a decision was recorded meanwhile, this changes nothing and we stop
    const moved = await tx.loanApplication.updateMany({
      where: { id, status: { in: ['APPLIED', 'UNDER_REVIEW'] } },
      data: { status: 'UNDER_REVIEW', reviewedAt: new Date() },
    })
    if (moved.count === 0) throw new ServiceError(409, 'invalid_state', 'Application changed state during evaluation; retry')
    await tx.auditLog.create({
      data: {
        applicationId: id,
        ...auditActor(actor),
        action: result.fraud.riskLevel === 'HIGH_RISK' ? 'FRAUD_FLAG_RAISED' : 'RECOMMENDATION_GENERATED',
        details: JSON.stringify({
          creditScore: result.creditScore,
          decision: result.decision,
          recommendedAmount: result.finalRecommendedAmt,
          fraudRiskLevel: result.fraud.riskLevel,
          fraudFlags: result.fraud.flags.length,
          bureauAvailable: result.bureau.available,
          connectors: external.summary,
          policy: `${policy.id}@${policy.version}`,
          policyChecksum: checksum,
        }),
      },
    })
    const full = await loadApplication(tx, actor.nbfcId, id)
    await recordEvent(tx, actor.nbfcId, 'application.evaluated', eventPayload(full))
    return full
  })

  return {
    application: serializeApplication(saved),
    evaluation: result,
    policy: { id: policy.id, version: policy.version, checksum },
    connectors: external.summary,
  }
}

// ───────────────────────── Decide (maker-checker) ─────────────────────────

/** Policy a decision was evaluated under, so approval rules can't shift mid-review. */
async function policyForDecision(nbfcId: string, policyId: string | null | undefined): Promise<CreditPolicy> {
  if (policyId) {
    const row = await prisma.creditPolicy.findFirst({ where: { id: policyId, nbfcId } })
    if (row) return parsePolicy(JSON.parse(row.document))
  }
  return (await getActivePolicy(nbfcId)).policy
}

export async function decideApplication(
  actor: Actor,
  id: string,
  raw: unknown
): Promise<{ application: ApplicationResource; outcome: string; checkerReasons: string[] }> {
  if (actor.kind !== 'user') {
    throw new ServiceError(403, 'forbidden', 'Credit decisions must be made by a signed-in user')
  }
  if (actor.role === 'VIEWER') throw new ServiceError(403, 'forbidden', 'Insufficient permissions')

  const input = DecisionActionSchema.parse(raw)
  const app = await prisma.loanApplication.findFirst({
    where: { id, nbfcId: actor.nbfcId },
    include: { creditDecision: true, approval: true },
  })
  if (!app) throw notFound('Application')

  const policy = await policyForDecision(actor.nbfcId, app.creditDecision?.policyId)
  const systemDecision = app.creditDecision?.decision ?? null

  // Moves the application only if it is still in one of `from` (prevents double-processing)
  const transition = async (tx: Prisma.TransactionClient, from: string[], data: Prisma.LoanApplicationUpdateManyMutationInput) => {
    const res = await tx.loanApplication.updateMany({ where: { id, status: { in: from } }, data })
    if (res.count === 0) {
      throw new ServiceError(409, 'invalid_state', `Application is ${app.status}; ${input.action} is not allowed now`)
    }
  }

  const audit = (tx: Prisma.TransactionClient, action: string, details: Record<string, unknown>) =>
    tx.auditLog.create({ data: { applicationId: id, ...auditActor(actor), action, details: JSON.stringify(details) } })

  if (input.action === 'CONFIRM' || input.action === 'RETURN') {
    const approval = app.approval
    if (app.status !== 'PENDING_APPROVAL' || !approval || approval.status !== 'PENDING_CHECKER') {
      throw new ServiceError(409, 'invalid_state', 'There is no sanction awaiting a checker on this application')
    }
    if (!canActAsChecker(policy, { userId: actor.userId, role: actor.role }, approval.approvedBy)) {
      throw new ServiceError(
        403,
        'checker_not_allowed',
        approval.approvedBy === actor.userId
          ? 'The checker must be a different user from the one who submitted the sanction'
          : `Only ${policy.approvals.checkerRoles.join(' or ')} users can act as checker under this policy`
      )
    }

    const saved = await prisma.$transaction(async tx => {
      if (input.action === 'CONFIRM') {
        await transition(tx, ['PENDING_APPROVAL'], { status: 'SANCTIONED', decidedAt: new Date(), sanctionedAt: new Date() })
        await tx.approval.update({
          where: { applicationId: id },
          data: { status: 'CONFIRMED', checkedBy: actor.userId, checkedAt: new Date(), checkerRemarks: input.remarks ?? null },
        })
        await audit(tx, 'SANCTION_CONFIRMED_BY_CHECKER', { makerId: approval.approvedBy, remarks: input.remarks })
      } else {
        await transition(tx, ['PENDING_APPROVAL'], { status: 'UNDER_REVIEW', decidedAt: null })
        await tx.approval.update({
          where: { applicationId: id },
          data: { status: 'RETURNED', checkedBy: actor.userId, checkedAt: new Date(), checkerRemarks: input.remarks },
        })
        await audit(tx, 'SANCTION_RETURNED_BY_CHECKER', { makerId: approval.approvedBy, remarks: input.remarks })
      }
      const full = await loadApplication(tx, actor.nbfcId, id)
      await recordEvent(tx, actor.nbfcId, input.action === 'CONFIRM' ? 'application.sanctioned' : 'application.returned', eventPayload(full))
      return full
    })
    return { application: serializeApplication(saved), outcome: input.action === 'CONFIRM' ? 'SANCTIONED' : 'RETURNED', checkerReasons: [] }
  }

  // Maker actions: APPROVE / REJECT / REFER
  const isOverride = !!systemDecision && systemDecision !== input.action && input.action !== 'REFER'
  if (isOverride && !input.overrideReason) {
    throw new ServiceError(422, 'override_reason_required', `A reason is required to ${input.action.toLowerCase()} against the system's ${systemDecision} recommendation`)
  }

  const saved = await prisma.$transaction(async tx => {
    if (input.action === 'REFER') {
      await transition(tx, ['APPLIED', 'UNDER_REVIEW'], { status: 'UNDER_REVIEW', decidedAt: null })
      await audit(tx, 'REFERRED_FOR_REVIEW', { overrideReason: input.overrideReason || 'Requires additional review' })
      const full = await loadApplication(tx, actor.nbfcId, id)
      await recordEvent(tx, actor.nbfcId, 'application.referred', eventPayload(full))
      return { full, outcome: 'REFERRED', reasons: [] as string[] }
    }

    if (input.action === 'REJECT') {
      await transition(tx, ['APPLIED', 'UNDER_REVIEW'], { status: 'REJECTED', decidedAt: new Date() })
      const data = {
        approvedBy: actor.userId,
        finalDecision: 'REJECT',
        status: 'CONFIRMED',
        overrideSystem: isOverride,
        overrideReason: input.overrideReason ?? null,
        approvedAt: new Date(),
        checkerReasons: Prisma.DbNull,
        checkedBy: null,
        checkedAt: null,
        checkerRemarks: null,
      }
      await tx.approval.upsert({ where: { applicationId: id }, create: { applicationId: id, ...data }, update: data })
      await audit(tx, isOverride ? 'REJECTION_OVERRIDE' : 'APPLICATION_REJECTED', { isOverride, overrideReason: input.overrideReason })
      const full = await loadApplication(tx, actor.nbfcId, id)
      await recordEvent(tx, actor.nbfcId, 'application.rejected', eventPayload(full))
      return { full, outcome: 'REJECTED', reasons: [] as string[] }
    }

    // APPROVE
    if (!app.creditDecision) {
      throw new ServiceError(409, 'not_evaluated', 'Run the underwriting engine before approving')
    }
    const sanctionedAmount = input.sanctionedAmount ?? app.creditDecision.finalRecommendedAmt ?? app.requestedAmount
    const reasons = checkerRequirements(policy, { sanctionedAmount, isOverride })
    const needsChecker = reasons.length > 0

    await transition(
      tx,
      ['APPLIED', 'UNDER_REVIEW'],
      needsChecker
        ? { status: 'PENDING_APPROVAL' }
        : { status: 'SANCTIONED', decidedAt: new Date(), sanctionedAt: new Date() }
    )
    const data = {
      approvedBy: actor.userId,
      finalDecision: 'APPROVE',
      status: needsChecker ? 'PENDING_CHECKER' : 'CONFIRMED',
      checkerReasons: needsChecker ? reasons : Prisma.DbNull,
      checkedBy: null,
      checkedAt: null,
      checkerRemarks: null,
      overrideSystem: isOverride,
      overrideReason: input.overrideReason ?? null,
      sanctionedAmount,
      sanctionedTenure: input.sanctionedTenure ?? app.requestedTenure,
      interestRate: input.interestRate ?? policy.affordability.annualInterestRate,
      processingFee: input.processingFee ?? 2.0,
      conditions: input.conditions?.length ? JSON.stringify(input.conditions) : null,
      approvedAt: new Date(),
    }
    await tx.approval.upsert({ where: { applicationId: id }, create: { applicationId: id, ...data }, update: data })
    await audit(
      tx,
      needsChecker ? 'SANCTION_SUBMITTED_FOR_CHECK' : isOverride ? 'APPROVAL_OVERRIDE' : 'APPLICATION_APPROVED',
      { sanctionedAmount, isOverride, overrideReason: input.overrideReason, checkerReasons: reasons }
    )
    const full = await loadApplication(tx, actor.nbfcId, id)
    await recordEvent(tx, actor.nbfcId, needsChecker ? 'application.pending_approval' : 'application.sanctioned', eventPayload(full, needsChecker ? { checkerReasons: reasons } : {}))
    return { full, outcome: needsChecker ? 'PENDING_APPROVAL' : 'SANCTIONED', reasons }
  })

  return { application: serializeApplication(saved.full), outcome: saved.outcome, checkerReasons: saved.reasons }
}
