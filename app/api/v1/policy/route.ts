import { NextResponse } from 'next/server'
import { v1 } from '@/lib/api-v1'
import { getActivePolicy } from '@/lib/policy'

export const GET = v1('policy:read', async ({ actor }) => {
  const { policy, checksum, policyId } = await getActivePolicy(actor.nbfcId)
  return NextResponse.json({ checksum, isDefault: policyId === null, policy })
})
