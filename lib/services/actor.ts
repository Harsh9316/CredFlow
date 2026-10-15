import type { Role } from '@/lib/auth'

// Who is performing an action: a signed-in user, or an API key.
export type Actor =
  | { kind: 'user'; userId: string; role: Role; nbfcId: string }
  | { kind: 'api_key'; apiKeyId: string; nbfcId: string }

export const auditActor = (actor: Actor) =>
  actor.kind === 'user' ? { userId: actor.userId } : { apiKeyId: actor.apiKeyId }

export const actorLabel = (actor: Actor) =>
  actor.kind === 'user' ? { type: 'user', id: actor.userId } : { type: 'api_key', id: actor.apiKeyId }
