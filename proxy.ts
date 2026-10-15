import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE_NAME, verifySession } from '@/lib/session-token'

// First line of defence: reject requests without a valid signed session.
// Pages and route handlers still call getSession() for tenant and role checks.
export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (session) return NextResponse.next()

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.redirect(new URL('/', request.url))
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/applications/:path*',
    '/portfolio/:path*',
    '/settings/:path*',
    '/developers/:path*',
    '/api/applications/:path*',
    '/api/admin/:path*'
  ]
}
