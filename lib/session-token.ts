// Signed session tokens (HS256 JWT).
// Edge-safe: imported by middleware, so no Prisma or Node-only APIs here.

import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE_NAME = 'credflow_session'
export const SESSION_MAX_AGE = 60 * 60 * 8 // 8 hours

export type Role = 'ADMIN' | 'ANALYST' | 'VIEWER'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  nbfcId: string
  nbfcName: string
}

const ROLES: Role[] = ['ADMIN', 'ANALYST', 'VIEWER']

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    nbfcId: user.nbfcId,
    nbfcName: user.nbfcName
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret())
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    const role = payload.role as Role
    if (!payload.sub || typeof payload.nbfcId !== 'string' || !ROLES.includes(role)) {
      return null
    }
    return {
      id: payload.sub,
      email: String(payload.email),
      name: String(payload.name),
      role,
      nbfcId: payload.nbfcId,
      nbfcName: String(payload.nbfcName)
    }
  } catch {
    return null
  }
}
