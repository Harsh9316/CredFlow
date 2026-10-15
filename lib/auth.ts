import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import prisma from './db'
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type Role,
  type SessionUser
} from './session-token'

export type { Role, SessionUser }

const BCRYPT_ROUNDS = 12

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Verifies the signed cookie, then re-reads the user so that deactivated
// users and role changes take effect immediately rather than at token expiry.
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const claims = await verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  if (!claims) return null

  const user = await prisma.user.findUnique({
    where: { id: claims.id },
    include: { nbfc: { select: { name: true, isActive: true } } }
  })
  if (!user || !user.isActive || !user.nbfc.isActive) return null

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    nbfcId: user.nbfcId,
    nbfcName: user.nbfc.name
  }
}

export async function createSession(user: SessionUser): Promise<void> {
  const token = await signSession(user)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE
  })
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

// For server components: redirect to login when there is no valid session.
export async function requirePageSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) redirect('/')
  return session
}

// For route handlers: returns the session, or a 401/403 response to send back.
export async function requireApiSession(
  roles: Role[] = ['ADMIN', 'ANALYST', 'VIEWER']
): Promise<{ session: SessionUser; error?: never } | { session?: never; error: NextResponse }> {
  const session = await getSession()
  if (!session) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!roles.includes(session.role)) {
    return { error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) }
  }
  return { session }
}

export function canEdit(session: SessionUser | null): boolean {
  return !!session && (session.role === 'ADMIN' || session.role === 'ANALYST')
}

export function isAdmin(session: SessionUser | null): boolean {
  return session?.role === 'ADMIN'
}
