import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createSession, verifyPassword, type Role } from '@/lib/auth'

// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = '$2a$12$xvZ.kliZPTXpACHiFTGD4O8iW2jlEilSr/kyDPHJN2XutWECddXPu'

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json()

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { nbfc: true }
    })

    const passwordOk = await verifyPassword(password, user?.password ?? DUMMY_HASH)

    if (!user || !passwordOk) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    if (!user.isActive || !user.nbfc.isActive) {
      return NextResponse.json(
        { error: 'Account is deactivated' },
        { status: 403 }
      )
    }

    await createSession({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      nbfcId: user.nbfcId,
      nbfcName: user.nbfc.name
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        nbfcName: user.nbfc.name
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
