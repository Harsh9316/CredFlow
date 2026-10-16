// API keys for the public /api/v1 API.
// Format: cr_<8-char prefix>_<32-char secret>. Only a SHA-256 hash is stored; the prefix
// is kept in clear so keys can be identified in the UI and logs without revealing them.

import { createHash, randomBytes } from 'node:crypto'
import prisma from './db'
import { ServiceError } from './services/errors'
import type { Actor } from './services/actor'

export const API_SCOPES = {
  'applications:read': 'List and fetch applications',
  'applications:write': 'Create applications',
  'applications:evaluate': 'Run the underwriting engine on stored applications',
  evaluate: 'Evaluate an application without storing it',
  'policy:read': 'Read the active credit policy',
  'events:read': 'List events (an alternative to webhooks)',
} as const

export type ApiScope = keyof typeof API_SCOPES
export const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[]

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

export function generateApiKey(): { key: string; prefix: string; keyHash: string } {
  const prefix = randomBytes(4).toString('hex')
  const secret = randomBytes(24).toString('base64url')
  const key = `cr_${prefix}_${secret}`
  return { key, prefix, keyHash: hashKey(key) }
}

/** Resolves the Bearer token on a request to an actor, checking the scope. */
export async function authenticateApiKey(request: Request, scope: ApiScope): Promise<Actor & { kind: 'api_key' }> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.match(/^Bearer\s+(cr_[A-Za-z0-9_-]+)$/)?.[1]
  if (!token) {
    throw new ServiceError(401, 'unauthorized', 'Send an API key as `Authorization: Bearer cr_...`')
  }

  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashKey(token) },
    include: { nbfc: { select: { isActive: true } } },
  })
  if (!key || key.revokedAt || !key.nbfc.isActive) {
    throw new ServiceError(401, 'unauthorized', 'API key is invalid or revoked')
  }
  if (!key.scopes.includes(scope)) {
    throw new ServiceError(403, 'insufficient_scope', `This API key lacks the "${scope}" scope`)
  }

  // Updated at most once a minute per key, to avoid a write on every request
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
  }

  return { kind: 'api_key', apiKeyId: key.id, nbfcId: key.nbfcId }
}
