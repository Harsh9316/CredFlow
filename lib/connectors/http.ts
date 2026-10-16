// Minimal HTTP client for provider APIs: timeouts, retries on safe requests, typed errors.
// Error messages carry the provider, path and status only, never request bodies (PAN, mobile numbers).

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class ConnectorError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    /** True when retrying the same call later may succeed (timeouts, 5xx, 429). */
    public readonly retryable = false
  ) {
    super(`${provider}: ${message}`)
    this.name = 'ConnectorError'
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  /** Extra attempts for GETs and explicitly idempotent POSTs. */
  retries?: number
  fetchImpl?: FetchLike
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function requestJson<T>(provider: string, url: string, opts: RequestOptions = {}): Promise<{ status: number; data: T }> {
  const method = opts.method ?? 'GET'
  const fetchImpl = opts.fetchImpl ?? fetch
  const retries = opts.retries ?? (method === 'GET' ? 2 : 0)
  const path = new URL(url).pathname

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(url, {
        method,
        headers: { accept: 'application/json', ...(opts.body !== undefined && { 'content-type': 'application/json' }), ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        redirect: 'error',
      })
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      if (attempt < retries) {
        await sleep(300 * 2 ** attempt)
        continue
      }
      throw new ConnectorError(provider, `${method} ${path} ${timedOut ? 'timed out' : 'failed to connect'}`, undefined, timedOut ? 'timeout' : 'network', true)
    }

    const text = await res.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        throw new ConnectorError(provider, `${method} ${path} returned non-JSON (HTTP ${res.status})`, res.status, 'bad_response')
      }
    }

    if (res.ok) return { status: res.status, data: data as T }

    const retryable = res.status >= 500 || res.status === 429
    if (retryable && attempt < retries) {
      await sleep(300 * 2 ** attempt)
      continue
    }
    const code = providerErrorCode(data)
    throw new ConnectorError(provider, `${method} ${path} returned HTTP ${res.status}${code ? ` (${code})` : ''}`, res.status, code, retryable)
  }
}

function providerErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as Record<string, unknown>
  const err = b.error as Record<string, unknown> | undefined
  const code = b.errorCode ?? err?.code ?? b.code
  return typeof code === 'string' ? code.slice(0, 80) : undefined
}

/** Masks all but the last 4 characters: for logs and stored references. */
export const mask = (value: string, keep = 4) =>
  value.length <= keep ? value : `${'X'.repeat(value.length - keep)}${value.slice(-keep)}`
