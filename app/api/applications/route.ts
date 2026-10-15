import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'

type MonthlyFlow = { month: string; inflow: number; outflow: number }

// Accepts real month-by-month figures from the caller. Anything malformed is dropped
// rather than guessed at, because the fraud checks read this data.
function parseMonthlyData(value: unknown): MonthlyFlow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rows = value.map(row => ({
    month: String(row?.month ?? ''),
    inflow: Number(row?.inflow),
    outflow: Number(row?.outflow),
  }))
  const valid = rows.every(r => r.month && Number.isFinite(r.inflow) && Number.isFinite(r.outflow))
  return valid ? rows : null
}

export async function POST(request: Request) {
  try {
    const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
    if (error) return error

    const body = await request.json()
    const {
      // Borrower fields
      businessName, legalName, pan, gstin, industry, subIndustry,
      constitution, vintage, annualTurnover, employeeCount,
      address, city, state, pincode, contactPerson, contactPhone, contactEmail,
      // Loan fields
      requestedAmount, requestedTenure, purpose, sourcePlatform, priority,
      // Financial fields
      avgMonthlyInflow, avgMonthlyExpenses, freeCashFlow, inflowVolatility, monthlyData,
      // Collateral fields
      collateralType, collateralDescription, assessedValue, ltv, collateralCap,
      hasPersonalGuarantee, guarantorName, guarantorRelation,
      // Use existing borrower
      existingBorrowerId
    } = body

    if (!requestedAmount || !requestedTenure || !industry || !constitution) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Generate application number, prefixed with the NBFC's own code
    const nbfc = await prisma.nBFC.findUniqueOrThrow({ where: { id: session.nbfcId }, select: { code: true } })
    const year = new Date().getFullYear()
    const count = await prisma.loanApplication.count({ where: { nbfcId: session.nbfcId } })
    const appNo = `${nbfc.code}-${year}-${String(count + 1).padStart(4, '0')}`

    // Create or use existing borrower
    let borrowerId = existingBorrowerId

    if (borrowerId) {
      const owned = await prisma.borrower.findFirst({
        where: { id: borrowerId, nbfcId: session.nbfcId },
        select: { id: true },
      })
      if (!owned) {
        return NextResponse.json({ error: 'Borrower not found' }, { status: 404 })
      }
    } else {
      if (!businessName || !contactPerson || !contactPhone) {
        return NextResponse.json({ error: 'Borrower details required' }, { status: 400 })
      }

      const borrower = await prisma.borrower.create({
        data: {
          nbfcId: session.nbfcId,
          businessName,
          legalName: legalName || businessName,
          pan: pan || null,
          gstin: gstin || null,
          industry,
          subIndustry: subIndustry || null,
          constitution,
          vintage: parseInt(vintage) || 0,
          annualTurnover: annualTurnover ? parseFloat(annualTurnover) : null,
          employeeCount: employeeCount ? parseInt(employeeCount) : null,
          address: address || null,
          city: city || null,
          state: state || null,
          pincode: pincode || null,
          contactPerson,
          contactPhone,
          contactEmail: contactEmail || null,
        }
      })
      borrowerId = borrower.id
    }

    // Create loan application
    const application = await prisma.loanApplication.create({
      data: {
        applicationNo: appNo,
        nbfcId: session.nbfcId,
        borrowerId,
        requestedAmount: parseFloat(requestedAmount),
        requestedTenure: parseInt(requestedTenure),
        purpose: purpose || null,
        sourcePlatform: sourcePlatform || 'Direct',
        priority: priority || 'NORMAL',
        status: 'APPLIED',
      }
    })

    // Create financial data if provided
    if (avgMonthlyInflow && avgMonthlyExpenses) {
      const inflow = parseFloat(avgMonthlyInflow)
      const expenses = parseFloat(avgMonthlyExpenses)
      const fcf = freeCashFlow ? parseFloat(freeCashFlow) : inflow - expenses

      const monthly = parseMonthlyData(monthlyData)

      await prisma.financialData.create({
        data: {
          borrowerId,
          dataType: 'BANK_STATEMENT',
          periodStart: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          periodEnd: new Date(),
          avgMonthlyInflow: inflow,
          avgMonthlyExpenses: expenses,
          freeCashFlow: fcf,
          inflowVolatility: inflowVolatility ? parseFloat(inflowVolatility) : 0.2,
          totalCredits: inflow * 6,
          totalDebits: expenses * 6,
          monthlyData: monthly ? JSON.stringify(monthly) : null,
        }
      })
    }

    // Create collateral if provided
    if (collateralType && collateralType !== 'NONE' && assessedValue) {
      const aValue = parseFloat(assessedValue)
      const ltvVal = ltv ? parseFloat(ltv) : 70
      await prisma.collateral.create({
        data: {
          applicationId: application.id,
          collateralType,
          description: collateralDescription || null,
          assessedValue: aValue,
          ltv: ltvVal,
          collateralCap: collateralCap ? parseFloat(collateralCap) : Math.round(aValue * ltvVal / 100),
          hasPersonalGuarantee: hasPersonalGuarantee === true || hasPersonalGuarantee === 'true',
          guarantorName: guarantorName || null,
          guarantorRelation: guarantorRelation || null,
        }
      })
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        applicationId: application.id,
        userId: session.id,
        action: 'APPLICATION_CREATED',
        details: JSON.stringify({ applicationNo: appNo, requestedAmount, requestedTenure }),
      }
    })

    return NextResponse.json({ success: true, applicationId: application.id, applicationNo: appNo })
  } catch (error) {
    console.error('Create application error:', error)
    return NextResponse.json({ error: 'Failed to create application' }, { status: 500 })
  }
}
