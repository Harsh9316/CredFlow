import { NextResponse, after } from 'next/server'
import { requireApiSession } from '@/lib/auth'
import { createApplication } from '@/lib/services/applications'
import { errorResponse } from '@/lib/services/errors'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))
const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

// The dashboard form posts flat string fields; map them onto the service's input shape.
function fromFormBody(b: Record<string, unknown>) {
  const collateralType = text(b.collateralType)
  return {
    borrowerId: text(b.existingBorrowerId),
    borrower: text(b.existingBorrowerId) ? undefined : {
      businessName: b.businessName,
      legalName: text(b.legalName),
      pan: text(b.pan),
      gstin: text(b.gstin),
      industry: b.industry,
      subIndustry: text(b.subIndustry),
      constitution: b.constitution,
      vintage: num(b.vintage) ?? 0,
      annualTurnover: num(b.annualTurnover),
      employeeCount: num(b.employeeCount),
      address: text(b.address),
      city: text(b.city),
      state: text(b.state),
      pincode: text(b.pincode),
      contactPerson: b.contactPerson,
      contactPhone: b.contactPhone,
      contactEmail: text(b.contactEmail),
    },
    requestedAmount: num(b.requestedAmount),
    requestedTenure: num(b.requestedTenure),
    purpose: text(b.purpose),
    sourcePlatform: text(b.sourcePlatform),
    priority: text(b.priority),
    financial: num(b.avgMonthlyInflow) !== undefined && num(b.avgMonthlyExpenses) !== undefined ? {
      avgMonthlyInflow: num(b.avgMonthlyInflow),
      avgMonthlyExpenses: num(b.avgMonthlyExpenses),
      freeCashFlow: num(b.freeCashFlow),
      inflowVolatility: num(b.inflowVolatility),
      monthlyData: Array.isArray(b.monthlyData) ? b.monthlyData : undefined,
    } : undefined,
    collateral: collateralType && collateralType !== 'NONE' && num(b.assessedValue) ? {
      type: collateralType,
      description: text(b.collateralDescription),
      assessedValue: num(b.assessedValue),
      ltv: num(b.ltv) ?? 70,
      hasPersonalGuarantee: b.hasPersonalGuarantee === true || b.hasPersonalGuarantee === 'true',
      guarantorName: text(b.guarantorName),
      guarantorRelation: text(b.guarantorRelation),
    } : undefined,
  }
}

export async function POST(request: Request) {
  const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
  if (error) return error
  try {
    const app = await createApplication(
      { kind: 'user', userId: session.id, role: session.role, nbfcId: session.nbfcId },
      fromFormBody(await request.json())
    )
    after(dispatchPendingWebhooks)
    return NextResponse.json({ success: true, applicationId: app.id, applicationNo: app.applicationNo })
  } catch (e) {
    return errorResponse(e)
  }
}
