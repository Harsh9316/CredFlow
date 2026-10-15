// Shared plumbing for /api/v1 route handlers: API-key auth, JSON parsing, error format.

import type { NextResponse } from 'next/server'
import { authenticateApiKey, type ApiScope } from './api-keys'
import { ServiceError, errorResponse } from './services/errors'
import type { Actor } from './services/actor'

export function v1<P = Record<string, never>>(
  scope: ApiScope,
  handler: (ctx: { request: Request; actor: Actor & { kind: 'api_key' }; params: P }) => Promise<NextResponse>
) {
  return async (request: Request, context: { params: Promise<P> }) => {
    try {
      const actor = await authenticateApiKey(request, scope)
      return await handler({ request, actor, params: context?.params ? await context.params : ({} as P) })
    } catch (e) {
      return errorResponse(e, 'public')
    }
  }
}

export async function readJson(request: Request): Promise<{ raw: string; body: unknown }> {
  const raw = await request.text()
  try {
    return { raw, body: raw ? JSON.parse(raw) : {} }
  } catch {
    throw new ServiceError(400, 'invalid_json', 'Request body is not valid JSON')
  }
}
