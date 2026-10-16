// Borrower consents for external data: Account Aggregator consents (bank statements and GST
// returns) and recorded consents for commercial bureau pulls.
//
// AA lifecycle: request -> borrower approves in their AA app -> fetch session -> data ingested.
// The provider's notifications only trigger a sync: status is always re-read from the provider,
// so a forged notification cannot change anything. Every step is idempotent.

import { z } from 'zod'
import type { Prisma, DataConsent } from '@prisma/client'
import prisma from '@/lib/db'
import { getConnectors } from '@/lib/connectors'
import { bankMetrics, gstMetrics, parseFi, type DepositAccount, type GstAccount } from '@/lib/connectors/aa-parse'
import { ConnectorError, mask } from '@/lib/connectors/http'
import type { AaFiType } from '@/lib/connectors/types'
import { ServiceError, notFound } from './errors'
import { auditActor, type Actor } from './actor'
import { recordEvent } from './events'

// ───────────────────────── Input schemas ─────────────────────────

export const RequestBankDataSchema = z.object({
  mobile: z
    .string()
    .transform(s => s.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))
    .pipe(z.string().regex(/^[6-9]\d{9}$/, 'mobile must be a 10-digit Indian mobile number'))
    .describe("Borrower's mobile number registered with their bank"),
  includeGst: z.boolean().default(false).describe('Also request GSTR-1/3B returns through the Account Aggregator'),
  months: z.number().int().min(3).max(24).default(12).describe('Months of history to request'),
})

export const BureauConsentSchema = z.object({
  method: z.enum(['DIGITAL', 'PHYSICAL']).describe('How the borrower gave consent'),
  reference: z.string().trim().min(1).max(200).describe('Your reference for the signed consent: e-sign id, form number, ...'),
  capturedAt: z.iso.datetime({ offset: true }).optional().describe('When consent was given; defaults to now'),
})

/** A bureau consent older than this is not used for a new pull. */
export const BUREAU_CONSENT_VALID_DAYS = 180

const FINAL_CONSENT = ['REJECTED', 'REVOKED', 'EXPIRED', 'FAILED']
const FINAL_SESSION = ['COMPLETED', 'PARTIAL', 'EXPIRED', 'FAILED']

// ───────────────────────── Serialisation ─────────────────────────

type ConsentWithData = DataConsent & { financialData?: { dataType: string; metrics: Prisma.JsonValue; avgMonthlyInflow: number | null; avgMonthlyExpenses: number | null }[] }

export function serializeConsent(c: ConsentWithData) {
  return {
    id: c.id,
    applicationId: c.applicationId,
    kind: c.kind,
    provider: c.provider,
    status: c.status,
    consentUrl: c.kind === 'ACCOUNT_AGGREGATOR' && c.status === 'PENDING' ? c.consentUrl : null,
    fiTypes: c.fiTypes,
    dataRange: c.dataFrom && c.dataTo ? { from: c.dataFrom.toISOString(), to: c.dataTo.toISOString() } : null,
    mobile: c.mobileMasked,
    sessionStatus: c.sessionStatus,
    method: c.method,
    reference: c.reference,
    error: c.lastError,
    dataReceived: !!c.completedAt && c.kind === 'ACCOUNT_AGGREGATOR',
    data: (c.financialData ?? []).map(f => ({ type: f.dataType, avgMonthlyInflow: f.avgMonthlyInflow, avgMonthlyOutflow: f.avgMonthlyExpenses, metrics: f.metrics })),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
  }
}

export type ConsentResource = ReturnType<typeof serializeConsent>

const withData = { financialData: { select: { dataType: true, metrics: true, avgMonthlyInflow: true, avgMonthlyExpenses: true } } } as const
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonObject

async function loadApplication(nbfcId: string, id: string) {
  const app = await prisma.loanApplication.findFirst({ where: { id, nbfcId }, include: { borrower: true } })
  if (!app) throw notFound('Application')
  return app
}

const audit = (tx: Prisma.TransactionClient, c: DataConsent, action: string, details: Record<string, unknown>, actor?: Actor) =>
  tx.auditLog.create({
    data: { applicationId: c.applicationId, ...(actor ? auditActor(actor) : {}), action, details: JSON.stringify({ consentId: c.id, ...details }) },
  })

// ───────────────────────── Queries ─────────────────────────

export async function listConsents(actor: Actor, applicationId: string): Promise<ConsentResource[]> {
  await loadApplication(actor.nbfcId, applicationId)
  const rows = await prisma.dataConsent.findMany({ where: { nbfcId: actor.nbfcId, applicationId }, include: withData, orderBy: { createdAt: 'desc' } })
  return rows.map(serializeConsent)
}

export async function getConsent(actor: Actor, id: string): Promise<ConsentResource> {
  const c = await prisma.dataConsent.findFirst({ where: { id, nbfcId: actor.nbfcId }, include: withData })
  if (!c) throw notFound('Consent')
  return serializeConsent(c)
}

// ───────────────────────── Account Aggregator ─────────────────────────

const connectorFailure = (e: unknown) =>
  e instanceof ConnectorError
    ? new ServiceError(e.code === 'not_configured' ? 503 : 502, 'connector_error', `${e.provider}: ${e.message}`)
    : e

export async function requestBankData(actor: Actor, applicationId: string, raw: unknown): Promise<ConsentResource> {
  const input = RequestBankDataSchema.parse(raw)
  const app = await loadApplication(actor.nbfcId, applicationId)
  if (!['APPLIED', 'UNDER_REVIEW'].includes(app.status)) {
    throw new ServiceError(409, 'invalid_state', `Application is ${app.status}; data can only be requested before a decision`)
  }
  const { bankData } = getConnectors()
  if (!bankData) throw new ServiceError(422, 'connector_unavailable', 'No Account Aggregator connector is configured (CONNECTOR_BANK_DATA)')

  // Whole months: from the first day of the month `months` ago, to now
  const now = new Date()
  const dataFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.months, 1))
  const fiTypes: AaFiType[] = input.includeGst ? ['DEPOSIT', 'GSTR1_3B'] : ['DEPOSIT']

  const row = await prisma.dataConsent.create({
    data: {
      nbfcId: actor.nbfcId,
      borrowerId: app.borrowerId,
      applicationId,
      kind: 'ACCOUNT_AGGREGATOR',
      provider: bankData.provider,
      status: 'CREATING',
      fiTypes,
      dataFrom,
      dataTo: now,
      mobileMasked: mask(input.mobile),
      ...(actor.kind === 'user' ? { createdById: actor.userId } : { createdByApiKeyId: actor.apiKeyId }),
    },
  })

  let created
  try {
    created = await bankData.createConsent({ mobile: input.mobile, pan: app.borrower.pan, fiTypes, dataRange: { from: dataFrom, to: now }, reference: row.id })
  } catch (e) {
    await prisma.dataConsent.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: e instanceof Error ? e.message : String(e) } })
    throw connectorFailure(e)
  }

  const saved = await prisma.$transaction(async tx => {
    const c = await tx.dataConsent.update({
      where: { id: row.id },
      data: { providerConsentId: created.consentId, consentUrl: created.url, status: created.status },
      include: withData,
    })
    await audit(tx, c, 'DATA_CONSENT_REQUESTED', { provider: c.provider, fiTypes, months: input.months }, actor)
    await recordEvent(tx, actor.nbfcId, 'consent.updated', toJson({ consent: serializeConsent(c) }))
    return c
  })
  return serializeConsent(saved)
}

/** Re-reads a consent from its provider and moves it forward. Safe to call any number of times. */
export async function syncConsent(actor: Actor, id: string): Promise<ConsentResource> {
  const c = await prisma.dataConsent.findFirst({ where: { id, nbfcId: actor.nbfcId } })
  if (!c) throw notFound('Consent')
  try {
    await advance(c)
  } catch (e) {
    throw connectorFailure(e)
  }
  return getConsent(actor, id)
}

/** Handles a Setu notification. The payload is only a hint: state is re-fetched from Setu. */
export async function handleSetuNotification(payload: unknown): Promise<{ matched: boolean }> {
  const p = (payload ?? {}) as { consentId?: unknown; dataSessionId?: unknown }
  const consentId = typeof p.consentId === 'string' ? p.consentId : null
  const sessionId = typeof p.dataSessionId === 'string' ? p.dataSessionId : null
  if (!consentId && !sessionId) return { matched: false }
  const c = await prisma.dataConsent.findFirst({
    where: { provider: 'setu', kind: 'ACCOUNT_AGGREGATOR', OR: [...(consentId ? [{ providerConsentId: consentId }] : []), ...(sessionId ? [{ sessionId }] : [])] },
  })
  if (!c) return { matched: false }
  await advance(c)
  return { matched: true }
}

async function advance(start: DataConsent): Promise<void> {
  if (start.kind !== 'ACCOUNT_AGGREGATOR' || !start.providerConsentId || start.completedAt) return
  const { bankData } = getConnectors()
  if (!bankData || bankData.provider !== start.provider) {
    throw new ServiceError(409, 'connector_changed', `This consent was created with ${start.provider}, which is no longer the configured connector`)
  }
  let c = start
  const range = { from: c.dataFrom ?? new Date(Date.now() - 365 * 86_400_000), to: c.dataTo ?? new Date() }

  const update = async (data: Prisma.DataConsentUpdateInput, action?: string) => {
    const before = c.status
    c = await prisma.$transaction(async tx => {
      const u = await tx.dataConsent.update({ where: { id: c.id }, data, include: withData })
      if (action || u.status !== before) {
        await audit(tx, u, action ?? 'DATA_CONSENT_UPDATED', { from: before, to: u.status, sessionStatus: u.sessionStatus })
        await recordEvent(tx, u.nbfcId, 'consent.updated', toJson({ consent: serializeConsent(u) }))
      }
      return u
    })
  }

  // 1. Consent status
  if (!c.sessionId && !FINAL_CONSENT.includes(c.status)) {
    const consent = await bankData.getConsent(c.providerConsentId!)
    if (consent.status !== c.status) await update({ status: consent.status, lastError: consent.error ?? null })
  }
  if (c.status !== 'ACTIVE' && !c.sessionId) return

  // 2. Start a data session once the consent is active
  if (!c.sessionId) {
    const session = await bankData.createSession(c.providerConsentId!, range)
    await update({ sessionId: session.sessionId, sessionStatus: session.status }, 'DATA_SESSION_STARTED')
  }

  // 3. Collect the data once the session is done
  if (c.sessionStatus && FINAL_SESSION.includes(c.sessionStatus) && c.sessionStatus !== 'COMPLETED' && c.sessionStatus !== 'PARTIAL') return
  const session = await bankData.getSession(c.sessionId!)
  if (session.status !== c.sessionStatus) await update({ sessionStatus: session.status })
  if (session.status === 'COMPLETED' || session.status === 'PARTIAL') await ingest(c, session.accounts, range)
}

async function ingest(c: DataConsent, accounts: { fiStatus: string; maskedAccNumber: string; data: unknown }[], range: { from: Date; to: Date }) {
  const parsed = accounts.filter(a => a.data && a.fiStatus !== 'DENIED' && a.fiStatus !== 'TIMEOUT').map(a => parseFi(a.data, a.maskedAccNumber))
  const deposits = parsed.filter((p): p is DepositAccount => p.kind === 'deposit')
  const gstAccounts = parsed.filter((p): p is GstAccount => p.kind === 'gst')
  const bank = bankMetrics(deposits, range)
  const gst = gstMetrics(gstAccounts)
  const borrower = await prisma.borrower.findUnique({ where: { id: c.borrowerId }, select: { pan: true } })
  const source = c.provider.toUpperCase()

  await prisma.$transaction(async tx => {
    // Guard: only the first sync to get here ingests
    const claimed = await tx.dataConsent.updateMany({ where: { id: c.id, completedAt: null }, data: { completedAt: new Date() } })
    if (claimed.count === 0) return

    if (bank) {
      const { monthly, holderPans, ...signals } = bank
      await tx.financialData.create({
        data: {
          borrowerId: c.borrowerId,
          dataType: 'ACCOUNT_AGGREGATOR',
          source,
          consentId: c.id,
          periodStart: new Date(`${monthly[0].month}-01T00:00:00Z`),
          periodEnd: range.to,
          avgMonthlyInflow: bank.avgMonthlyInflow,
          avgMonthlyExpenses: bank.avgMonthlyOutflow,
          freeCashFlow: bank.avgMonthlyInflow - bank.avgMonthlyOutflow,
          inflowVolatility: bank.inflowVolatility,
          totalCredits: bank.totalCredits,
          totalDebits: bank.totalDebits,
          monthlyData: JSON.stringify(monthly),
          metrics: toJson({
            ...signals,
            // Whether the PAN on the bank accounts matches the borrower's (null when the bank sent none)
            holderPanMatch: holderPans.length && borrower?.pan ? holderPans.includes(borrower.pan) : null,
          }),
        },
      })
    }
    if (gst) {
      await tx.financialData.create({
        data: {
          borrowerId: c.borrowerId,
          dataType: 'GST_RETURNS',
          source,
          consentId: c.id,
          periodStart: new Date(`${gst.monthly[0].month}-01T00:00:00Z`),
          periodEnd: new Date(`${gst.monthly.at(-1)!.month}-01T00:00:00Z`),
          monthlyData: JSON.stringify(gst.monthly),
          metrics: toJson({
            periodsFiled: gst.periodsFiled,
            avgMonthlyTurnover: gst.avgMonthlyTurnover,
            annualisedTurnover: gst.annualisedTurnover,
            missingPeriods: gst.missingPeriods,
            registrationStatus: gst.registrationStatus,
          }),
        },
      })
    }
    const u = await tx.dataConsent.update({
      where: { id: c.id },
      data: { lastError: bank || gst ? null : 'The session completed but contained no usable bank or GST data' },
      include: withData,
    })
    const summary = {
      bank: bank && { months: bank.months, accounts: bank.accounts, avgMonthlyInflow: bank.avgMonthlyInflow, bounceCount: bank.bounceCount },
      gst: gst && { periodsFiled: gst.periodsFiled, annualisedTurnover: gst.annualisedTurnover },
    }
    await audit(tx, u, 'FINANCIAL_DATA_RECEIVED', summary)
    await recordEvent(tx, u.nbfcId, 'financial_data.received', toJson({ consent: serializeConsent(u), summary }))
  })
}

// ───────────────────────── Bureau ─────────────────────────

export async function recordBureauConsent(actor: Actor, applicationId: string, raw: unknown): Promise<ConsentResource> {
  const input = BureauConsentSchema.parse(raw)
  const app = await loadApplication(actor.nbfcId, applicationId)
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date()
  if (capturedAt.getTime() > Date.now() + 5 * 60_000) throw new ServiceError(400, 'invalid_request', 'capturedAt is in the future')

  const saved = await prisma.$transaction(async tx => {
    const c = await tx.dataConsent.create({
      data: {
        nbfcId: actor.nbfcId,
        borrowerId: app.borrowerId,
        applicationId,
        kind: 'BUREAU',
        provider: 'lender',
        status: 'ACTIVE',
        method: input.method,
        reference: input.reference,
        completedAt: capturedAt,
        ...(actor.kind === 'user' ? { createdById: actor.userId } : { createdByApiKeyId: actor.apiKeyId }),
      },
      include: withData,
    })
    await audit(tx, c, 'BUREAU_CONSENT_RECORDED', { method: input.method, reference: input.reference, capturedAt: capturedAt.toISOString() }, actor)
    await recordEvent(tx, actor.nbfcId, 'consent.updated', toJson({ consent: serializeConsent(c) }))
    return c
  })
  return serializeConsent(saved)
}

/** The borrower's most recent bureau consent that is still usable, if any. */
export async function activeBureauConsent(nbfcId: string, borrowerId: string) {
  const since = new Date(Date.now() - BUREAU_CONSENT_VALID_DAYS * 86_400_000)
  return prisma.dataConsent.findFirst({
    where: { nbfcId, borrowerId, kind: 'BUREAU', status: 'ACTIVE', completedAt: { gte: since } },
    orderBy: { completedAt: 'desc' },
  })
}
