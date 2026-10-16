import { NextResponse } from 'next/server'
import { v1 } from '@/lib/api-v1'
import { getConsent } from '@/lib/services/data-consents'

export const GET = v1<{ id: string }>('applications:read', async ({ actor, params }) =>
  NextResponse.json(await getConsent(actor, params.id))
)
