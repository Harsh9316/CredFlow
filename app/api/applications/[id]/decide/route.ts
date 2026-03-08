import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { cookies } from 'next/headers'
import { generateDecision } from '@/lib/decision-engine'
import { runFraudPreChecks, applyBureauOverlay } from '@/lib/fraud-checks'

const SESSION_COOKIE_NAME = 'credflow_session'

async function getSession() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)
  if (!sessionCookie?.value) return null
  try { return JSON.parse(sessionCookie.value) } catch { return null }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Get application with all related data
    const application = await prisma.loanApplication.findUnique({
      where: { id },
      include: {
        borrower: {
          include: { financialData: { orderBy: { periodEnd: 'desc' }, take: 1 } }
        },
        collateral: true,
      }
    })

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const financialData = application.borrower.financialData[0]

    if (!financialData) {
      return NextResponse.json({ error: 'No financial data found for borrower. Please add financial data first.' }, { status: 400 })
    }

    // Parse monthly data for fraud checks
    const monthlyData = financialData.monthlyData ? JSON.parse(financialData.monthlyData) : []

    // ── STAGE 1: FRAUD PRE-CHECKS (before credit assessment) ──
    const fraudResult = runFraudPreChecks({
      borrower: {
        pan: application.borrower.pan,
        gstin: application.borrower.gstin,
        businessName: application.borrower.businessName,
        vintage: application.borrower.vintage,
        annualTurnover: application.borrower.annualTurnover,
      },
      financial: {
        avgMonthlyInflow: financialData.avgMonthlyInflow || 0,
        avgMonthlyExpenses: financialData.avgMonthlyExpenses || 0,
        inflowVolatility: financialData.inflowVolatility || 0.5,
        monthlyData,
      },
      requestedAmount: application.requestedAmount,
    })

    // ── STAGE 2: BUREAU OVERLAY (optional, negative filter) ──
    // In production, this would call CIBIL/CRIF API
    // For now, bureau data is not available — engine proceeds without it
    const bureauResult = applyBureauOverlay(undefined, false, false)

    // ── STAGE 3: CREDIT SCORING (only if fraud checks don't hard-block) ──
    const monthlyEMI = application.requestedAmount / application.requestedTenure
    const emiCoverageRatio = financialData.freeCashFlow ? financialData.freeCashFlow / monthlyEMI : 0

    const inputs = {
      requestedAmount: application.requestedAmount,
      requestedTenure: application.requestedTenure,
      financial: {
        avgMonthlyInflow: financialData.avgMonthlyInflow || 0,
        avgMonthlyExpenses: financialData.avgMonthlyExpenses || 0,
        freeCashFlow: financialData.freeCashFlow || 0,
        inflowVolatility: financialData.inflowVolatility || 0.5,
        emiCoverageRatio,
      },
      collateral: application.collateral ? {
        type: application.collateral.collateralType as 'LAP' | 'MACHINERY' | 'INVOICE' | 'STOCK' | 'FD' | 'NONE',
        assessedValue: application.collateral.assessedValue,
        ltv: application.collateral.ltv,
        hasPersonalGuarantee: application.collateral.hasPersonalGuarantee,
      } : null,
      borrower: {
        vintage: application.borrower.vintage,
        industry: application.borrower.industry,
        annualTurnover: application.borrower.annualTurnover || undefined,
      }
    }

    const result = generateDecision(inputs)

    // Apply bureau modifier to credit score
    const adjustedScore = Math.max(0, Math.min(100, result.creditScore + bureauResult.modifier))

    // Merge fraud flags into risk flags
    const allRiskFlags = [...result.riskFlags]
    const allRecommendations = [...result.recommendations]

    // Add fraud flags as risk flags
    fraudResult.flags.forEach(f => {
      if (f.severity === 'CRITICAL') {
        allRiskFlags.unshift(`🚨 FRAUD: ${f.description}`)
      } else {
        allRiskFlags.push(`⚠ Fraud Check: ${f.description}`)
      }
      allRecommendations.push(f.recommendation)
    })

    // Add bureau notes
    bureauResult.notes.forEach(n => {
      allRecommendations.push(n)
    })

    // Override decision if fraud is HIGH_RISK
    let finalDecision = result.decision
    if (fraudResult.riskLevel === 'HIGH_RISK') {
      finalDecision = 'REJECT'
    }

    // Delete existing decision if re-running
    await prisma.creditDecision.deleteMany({ where: { applicationId: id } })

    // Save credit decision with fraud + bureau data
    await prisma.creditDecision.create({
      data: {
        applicationId: id,
        creditScore: adjustedScore,
        decision: finalDecision,
        cashFlowEligible: result.cashFlowEligible,
        collateralEligible: result.collateralEligible,
        finalRecommendedAmt: fraudResult.riskLevel === 'HIGH_RISK' ? 0 : result.finalRecommendedAmt,
        scoreBreakdown: JSON.stringify(result.scoreBreakdown),
        approvalReasons: JSON.stringify(result.approvalReasons),
        riskFlags: JSON.stringify(allRiskFlags),
        recommendations: JSON.stringify(allRecommendations),
        calculationInputs: JSON.stringify({
          ...inputs,
          fraudPreCheck: {
            riskLevel: fraudResult.riskLevel,
            passed: fraudResult.passed,
            flagCount: fraudResult.flags.length,
            summary: fraudResult.summary,
          },
          bureauOverlay: {
            available: bureauResult.available,
            bureauScore: bureauResult.bureauScore,
            modifier: bureauResult.modifier,
          }
        }),
      }
    })

    // Update application status
    await prisma.loanApplication.update({
      where: { id },
      data: {
        status: 'UNDER_REVIEW',
        reviewedAt: new Date(),
      }
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        applicationId: id,
        userId: session.id,
        action: fraudResult.riskLevel === 'HIGH_RISK' ? 'FRAUD_FLAG_RAISED' : 'RECOMMENDATION_GENERATED',
        details: JSON.stringify({
          creditScore: adjustedScore,
          decision: finalDecision,
          recommendedAmount: result.finalRecommendedAmt,
          fraudRiskLevel: fraudResult.riskLevel,
          fraudFlags: fraudResult.flags.length,
          bureauAvailable: bureauResult.available,
        }),
      }
    })

    return NextResponse.json({
      success: true,
      decision: { ...result, creditScore: adjustedScore, decision: finalDecision, riskFlags: allRiskFlags, recommendations: allRecommendations },
      fraudPreCheck: fraudResult,
      bureauOverlay: bureauResult,
    })
  } catch (error) {
    console.error('Run recommendation error:', error)
    return NextResponse.json({ error: 'Failed to run underwriting engine' }, { status: 500 })
  }
}
