import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { cookies } from 'next/headers'

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

    if (session.role === 'VIEWER') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { action, sanctionedAmount, sanctionedTenure, interestRate, processingFee, conditions, overrideReason } = body

    if (!action || !['APPROVE', 'REJECT', 'REFER'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const application = await prisma.loanApplication.findUnique({
      where: { id },
      include: { creditDecision: true }
    })

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    // Determine if this is an override
    const isOverride = application.creditDecision && application.creditDecision.decision !== action

    if (action === 'APPROVE') {
      // Create approval record
      await prisma.approval.upsert({
        where: { applicationId: id },
        create: {
          applicationId: id,
          approvedBy: session.id,
          finalDecision: 'APPROVE',
          overrideSystem: isOverride || false,
          overrideReason: overrideReason || null,
          sanctionedAmount: sanctionedAmount ? parseFloat(sanctionedAmount) : application.requestedAmount,
          sanctionedTenure: sanctionedTenure ? parseInt(sanctionedTenure) : application.requestedTenure,
          interestRate: interestRate ? parseFloat(interestRate) : 14.0,
          processingFee: processingFee ? parseFloat(processingFee) : 2.0,
          conditions: conditions ? JSON.stringify(conditions.split('\n').filter((c: string) => c.trim())) : null,
        },
        update: {
          approvedBy: session.id,
          finalDecision: 'APPROVE',
          overrideSystem: isOverride || false,
          overrideReason: overrideReason || null,
          sanctionedAmount: sanctionedAmount ? parseFloat(sanctionedAmount) : application.requestedAmount,
          sanctionedTenure: sanctionedTenure ? parseInt(sanctionedTenure) : application.requestedTenure,
          interestRate: interestRate ? parseFloat(interestRate) : 14.0,
          processingFee: processingFee ? parseFloat(processingFee) : 2.0,
          conditions: conditions ? JSON.stringify(conditions.split('\n').filter((c: string) => c.trim())) : null,
        }
      })

      // Update application status
      await prisma.loanApplication.update({
        where: { id },
        data: {
          status: 'SANCTIONED',
          decidedAt: new Date(),
          sanctionedAt: new Date(),
        }
      })

      // Audit
      await prisma.auditLog.create({
        data: {
          applicationId: id,
          userId: session.id,
          action: isOverride ? 'APPROVAL_OVERRIDE' : 'APPLICATION_APPROVED',
          details: JSON.stringify({ sanctionedAmount, isOverride, overrideReason }),
        }
      })
    } else if (action === 'REJECT') {
      await prisma.approval.upsert({
        where: { applicationId: id },
        create: {
          applicationId: id,
          approvedBy: session.id,
          finalDecision: 'REJECT',
          overrideSystem: isOverride || false,
          overrideReason: overrideReason || null,
        },
        update: {
          approvedBy: session.id,
          finalDecision: 'REJECT',
          overrideSystem: isOverride || false,
          overrideReason: overrideReason || null,
        }
      })

      await prisma.loanApplication.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
        }
      })

      await prisma.auditLog.create({
        data: {
          applicationId: id,
          userId: session.id,
          action: isOverride ? 'REJECTION_OVERRIDE' : 'APPLICATION_REJECTED',
          details: JSON.stringify({ isOverride, overrideReason }),
        }
      })
    } else if (action === 'REFER') {
      await prisma.loanApplication.update({
        where: { id },
        data: {
          status: 'UNDER_REVIEW',
          decidedAt: null,
        }
      })

      await prisma.auditLog.create({
        data: {
          applicationId: id,
          userId: session.id,
          action: 'REFERRED_FOR_REVIEW',
          details: JSON.stringify({ overrideReason: overrideReason || 'Requires additional review' }),
        }
      })
    }

    return NextResponse.json({ success: true, action })
  } catch (error) {
    console.error('Process decision error:', error)
    return NextResponse.json({ error: 'Failed to process decision' }, { status: 500 })
  }
}
