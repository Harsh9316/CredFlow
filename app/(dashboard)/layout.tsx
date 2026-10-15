import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import AppShell from '@/components/AppShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession()
  const awaitingChecker = await prisma.loanApplication.count({
    where: { nbfcId: session.nbfcId, status: 'PENDING_APPROVAL' },
  })

  return (
    <AppShell
      user={{ name: session.name, email: session.email, role: session.role, nbfcName: session.nbfcName }}
      awaitingChecker={awaitingChecker}
    >
      {children}
    </AppShell>
  )
}
