import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

const SESSION_COOKIE_NAME = 'credflow_session'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)

    if (!sessionCookie?.value) {
      return NextResponse.json({ user: null }, { status: 401 })
    }

    const session = JSON.parse(sessionCookie.value)
    return NextResponse.json({ user: session })
  } catch {
    return NextResponse.json({ user: null }, { status: 401 })
  }
}
