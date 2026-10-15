import { NextResponse } from 'next/server'
import { v1 } from '@/lib/api-v1'
import { getApplication } from '@/lib/services/applications'

export const GET = v1<{ id: string }>('applications:read', async ({ actor, params }) =>
  NextResponse.json(await getApplication(actor, params.id))
)
