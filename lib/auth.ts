import { cookies } from 'next/headers'
import prisma from './db'

export type SessionUser = {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'ANALYST' | 'VIEWER'
  nbfcId: string
  nbfcName: string
}

const SESSION_COOKIE_NAME = 'credflow_session'

// Simple session management using cookies
// In production, use proper JWT or session tokens

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)
  
  if (!sessionCookie?.value) {
    return null
  }

  try {
    const session = JSON.parse(sessionCookie.value) as SessionUser
    return session
  } catch {
    return null
  }
}

export async function createSession(userId: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { nbfc: true }
  })

  if (!user) return null

  const session: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    nbfcId: user.nbfcId,
    nbfcName: user.nbfc.name
  }

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7 // 7 days
  })

  return session
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export function requireRole(session: SessionUser | null, roles: Array<'ADMIN' | 'ANALYST' | 'VIEWER'>): boolean {
  if (!session) return false
  return roles.includes(session.role)
}

export function canEdit(session: SessionUser | null): boolean {
  return requireRole(session, ['ADMIN', 'ANALYST'])
}

export function isAdmin(session: SessionUser | null): boolean {
  return requireRole(session, ['ADMIN'])
}
