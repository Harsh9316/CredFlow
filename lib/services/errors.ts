import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { PolicyValidationError } from '@credrail/engine'

// A failure the caller can act on. Route handlers turn it into a JSON error response.
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export const notFound = (what: string) => new ServiceError(404, 'not_found', `${what} not found`)

/**
 * Shape: { error: { code, message, details? } } for the public API, and
 * { error: message, code, details? } for the app's own routes (which existing UI code reads as a string).
 */
export function errorResponse(error: unknown, style: 'public' | 'internal' = 'internal'): NextResponse {
  let status = 500
  let code = 'internal_error'
  let message = 'Something went wrong'
  let details: unknown

  if (error instanceof ServiceError) {
    ;({ status, code, message, details } = error)
  } else if (error instanceof ZodError) {
    status = 400
    code = 'invalid_request'
    details = error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
    message = style === 'public'
      ? 'Request body failed validation'
      : (details as { path: string; message: string }[]).map(d => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ')
  } else if (error instanceof PolicyValidationError) {
    status = 400
    code = 'invalid_policy'
    message = 'Policy failed validation'
    details = error.issues
  } else {
    console.error(error)
  }

  const body = style === 'public'
    ? { error: { code, message, ...(details !== undefined && { details }) } }
    : { error: message, code, ...(details !== undefined && { details }) }
  return NextResponse.json(body, { status })
}
