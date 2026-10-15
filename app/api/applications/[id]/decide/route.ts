import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { requireApiSession } from '@/lib/auth'
import { getActivePolicy } from '@/lib/policy'
import { evaluateApplication, type ApplicationInput, type CollateralType, type MonthlyFlow } from '@credflow/engine'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
    if (error) return error

    const { id } = await params

    const application = await prisma.loanApplication.findFirst({
      where: { id, nbfcId: session.nbfcId },
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

    const input: ApplicationInput = {
      requestedAmount: application.requestedAmount,
      requestedTenure: application.requestedTenure,
      borrower: {
        pan: application.borrower.pan,
        gstin: application.borrower.gstin,
        vintage: application.borrower.vintage,
        industry: application.borrower.industry,
        annualTurnover: application.borrower.annualTurnover,
      },
      financial: {
        avgMonthlyInflow: financialData.avgMonthlyInflow || 0,
        avgMonthlyExpenses: financialData.avgMonthlyExpenses || 0,
        freeCashFlow: financialData.freeCashFlow || 0,
        inflowVolatility: financialData.inflowVolatility || 0.5,
        monthlyData: financialData.monthlyData ? (JSON.parse(financialData.monthlyData) as MonthlyFlow[]) : [],
      },
      collateral: application.collateral ? {
        type: application.collateral.collateralType as CollateralType,
        assessedValue: application.collateral.assessedValue,
        ltv: application.collateral.ltv,
        hasPersonalGuarantee: application.collateral.hasPersonalGuarantee,
      } : null,
      // Bureau integration is not wired up yet; the engine treats missing data as neutral
      bureau: null,
    }

    const { policy, policyId, checksum } = await getActivePolicy(session.nbfcId)
    const result = evaluateApplication(input, policy)

    const calculationInputs = {
      ...input,
      emi: result.emi,
      emiCoverageRatio: result.emiCoverageRatio,
      creditPolicyVersion: `${policy.id}@${policy.version}`,
      policyChecksum: checksum,
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
      },
    }

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
      calculationInputs: JSON.stringify(calculationInputs),
      policyId,
      generatedAt: new Date(),
    }

    await prisma.$transaction([
      prisma.creditDecision.upsert({
        where: { applicationId: id },
        create: { applicationId: id, ...decisionData },
        update: decisionData,
      }),
      prisma.loanApplication.update({
        where: { id },
        data: { status: 'UNDER_REVIEW', reviewedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          applicationId: id,
          userId: session.id,
          action: result.fraud.riskLevel === 'HIGH_RISK' ? 'FRAUD_FLAG_RAISED' : 'RECOMMENDATION_GENERATED',
          details: JSON.stringify({
            creditScore: result.creditScore,
            decision: result.decision,
            recommendedAmount: result.finalRecommendedAmt,
            fraudRiskLevel: result.fraud.riskLevel,
            fraudFlags: result.fraud.flags.length,
            bureauAvailable: result.bureau.available,
            policy: `${policy.id}@${policy.version}`,
            policyChecksum: checksum,
          }),
        }
      }),
    ])

    return NextResponse.json({
      success: true,
      decision: {
        creditScore: result.creditScore,
        decision: result.decision,
        cashFlowEligible: result.cashFlowEligible,
        collateralEligible: result.collateralEligible,
        finalRecommendedAmt: result.finalRecommendedAmt,
        scoreBreakdown: result.scoreBreakdown,
        approvalReasons: result.approvalReasons,
        riskFlags: result.riskFlags,
        recommendations: result.recommendations,
      },
      fraudPreCheck: result.fraud,
      bureauOverlay: result.bureau,
      policy: { id: policy.id, version: policy.version, checksum },
    })
  } catch (error) {
    console.error('Run recommendation error:', error)
    return NextResponse.json({ error: 'Failed to run underwriting engine' }, { status: 500 })
  }
}
