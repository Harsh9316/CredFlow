import { NextResponse, after } from 'next/server'
import { requireApiSession } from '@/lib/auth'
import { underwriteApplication } from '@/lib/services/applications'
import { errorResponse } from '@/lib/services/errors'
import { dispatchPendingWebhooks } from '@/lib/webhooks'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await requireApiSession(['ADMIN', 'ANALYST'])
  if (error) return error
  try {
    const { id } = await params
    const { evaluation: r, policy, connectors } = await underwriteApplication(
      { kind: 'user', userId: session.id, role: session.role, nbfcId: session.nbfcId },
      id
    )
    after(dispatchPendingWebhooks)
    return NextResponse.json({
      success: true,
      decision: {
        creditScore: r.creditScore,
        decision: r.decision,
        cashFlowEligible: r.cashFlowEligible,
        collateralEligible: r.collateralEligible,
        finalRecommendedAmt: r.finalRecommendedAmt,
        scoreBreakdown: r.scoreBreakdown,
        approvalReasons: r.approvalReasons,
        riskFlags: r.riskFlags,
        recommendations: r.recommendations,
      },
      fraudPreCheck: r.fraud,
      bureauOverlay: r.bureau,
      policy,
      connectors,
    })
  } catch (e) {
    return errorResponse(e)
  }
}
