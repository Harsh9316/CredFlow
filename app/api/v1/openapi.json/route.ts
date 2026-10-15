import { NextResponse } from 'next/server'
import { buildOpenApiDocument } from '@/lib/openapi'

export function GET(request: Request) {
  return NextResponse.json(buildOpenApiDocument(new URL(request.url).origin))
}
