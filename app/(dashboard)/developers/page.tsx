import prisma from '@/lib/db'
import { requirePageSession } from '@/lib/auth'
import { API_SCOPES } from '@/lib/api-keys'
import { EVENT_TYPES } from '@/lib/services/events'
import DeveloperSettings from '@/components/DeveloperSettings'
import { Alert, PageHeader } from '@/components/ui'

export const metadata = { title: 'Developers' }

export default async function DevelopersPage() {
  const session = await requirePageSession()

  if (session.role !== 'ADMIN') {
    return (
      <>
        <PageHeader title="Developers" />
        <Alert tone="info">Only NBFC admins can manage API keys and webhooks.</Alert>
      </>
    )
  }

  const [keys, endpoints, deliveries] = await Promise.all([
    prisma.apiKey.findMany({
      where: { nbfcId: session.nbfcId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    }),
    prisma.webhookEndpoint.findMany({
      where: { nbfcId: session.nbfcId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, url: true, description: true, events: true, isActive: true, createdAt: true },
    }),
    prisma.webhookDelivery.findMany({
      where: { endpoint: { nbfcId: session.nbfcId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { event: { select: { type: true } }, endpoint: { select: { url: true } } },
    }),
  ])

  return (
    <>
      <PageHeader
        title="Developers"
        description={`Connect ${session.nbfcName}'s loan origination system, ERP or marketplace to CredFlow.`}
        actions={<a href="/docs/api" target="_blank" rel="noreferrer" className="btn btn-secondary">API reference</a>}
      />
      <DeveloperSettings
        scopes={Object.entries(API_SCOPES).map(([id, description]) => ({ id, description }))}
        eventTypes={EVENT_TYPES.filter(t => t !== 'webhook.test')}
        keys={keys.map(k => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }))}
        endpoints={endpoints.map(e => ({ ...e, createdAt: e.createdAt.toISOString() }))}
        deliveries={deliveries.map(d => ({
          id: d.id,
          eventType: d.event.type,
          url: d.endpoint.url,
          status: d.status,
          attempts: d.attempts,
          responseStatus: d.responseStatus,
          lastError: d.lastError,
          createdAt: d.createdAt.toISOString(),
        }))}
      />
    </>
  )
}
