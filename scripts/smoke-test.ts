// End-to-end smoke test against a running, freshly seeded CredFlow instance.
// Covers authentication, tenant isolation, roles, policy-driven decisions, maker-checker,
// the public API (keys, scopes, idempotency), webhooks and the append-only audit log.
//
//   npm run setup && npm run build && WEBHOOK_ALLOW_PRIVATE_URLS=true npm start &
//   BASE_URL=http://localhost:3000 npm run smoke
//
// The server must run with WEBHOOK_ALLOW_PRIVATE_URLS=true so it can deliver to the
// local receiver this script starts.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import prisma from '../lib/db'
import { verifySignature } from '../lib/webhooks'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
let failures = 0

function check(name: string, ok: boolean, detail: unknown = '') {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail)
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && d ? `  (${d.slice(0, 300)})` : ''}`)
  if (!ok) failures++
}

const section = (name: string) => console.log(`\n── ${name} ──`)

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`)
  const cookie = res.headers.getSetCookie().find(c => c.startsWith('credflow_session='))
  if (!cookie) throw new Error(`no session cookie for ${email}`)
  return cookie.split(';')[0]
}

const req = (path: string, cookie?: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json', ...init.headers },
  })

const api = (path: string, key: string | null, init: RequestInit = {}) =>
  fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'content-type': 'application/json', ...init.headers },
  })

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 10_000): Promise<T | undefined> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 250))
  }
  return undefined
}

// A borrower the default policy approves (strong cash flow, collateral, clean identity)
const strongApplication = (amount: number) => ({
  businessName: `Smoke Strong ${Date.now()}`, contactPerson: 'Test', contactPhone: '9000000000',
  pan: 'AAGCS1234K', gstin: '27AAGCS1234K1Z5',
  industry: 'Manufacturing', constitution: 'Pvt Ltd', vintage: '72', annualTurnover: String(amount * 4),
  requestedAmount: String(amount), requestedTenure: '36',
  avgMonthlyInflow: String(Math.round(amount / 3)), avgMonthlyExpenses: String(Math.round(amount / 6)), inflowVolatility: '0.12',
  collateralType: 'LAP', assessedValue: String(amount * 2), ltv: '60', hasPersonalGuarantee: true,
})

async function main() {
  const ffcApp = await prisma.loanApplication.findFirstOrThrow({
    where: { nbfc: { code: 'FFC' }, status: { in: ['APPLIED', 'UNDER_REVIEW'] } },
    include: { borrower: true },
  })

  section('Authentication')
  check('unauthenticated page redirects to login', (await req('/dashboard')).status === 307)
  check('unauthenticated API returns 401', (await req('/api/applications', undefined, post({}))).status === 401)

  const forged = encodeURIComponent(JSON.stringify({ id: 'x', role: 'ADMIN', nbfcId: ffcApp.nbfcId }))
  check('unsigned JSON cookie is rejected', (await req(`/api/applications/${ffcApp.id}/decide`, `credflow_session=${forged}`, { method: 'POST' })).status === 401)
  check('wrong password returns 401', (await req('/api/auth/login', undefined, post({ email: 'analyst@credflow.io', password: 'wrong' }))).status === 401)

  const analyst = await login('analyst@credflow.io', 'Analyst@123')
  const analyst2 = await login('analyst2@credflow.io', 'Analyst@123')
  const admin = await login('admin@credflow.io', 'Admin@123')
  const sgf = await login('admin@smegrowth.in', 'Admin@123')
  const viewer = await login('viewer@credflow.io', 'Viewer@123')

  const [h, payload, sig] = viewer.split('=')[1].split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const tampered = `credflow_session=${h}.${Buffer.from(JSON.stringify({ ...claims, role: 'ADMIN' })).toString('base64url')}.${sig}`
  check('tampered JWT is rejected', (await req(`/api/applications/${ffcApp.id}/decide`, tampered, { method: 'POST' })).status === 401)

  section('Roles and tenant isolation')
  check('viewer cannot run the engine', (await req(`/api/applications/${ffcApp.id}/decide`, viewer, { method: 'POST' })).status === 403)
  check('other NBFC cannot view application', (await req(`/applications/${ffcApp.id}`, sgf)).status === 404)
  check('other NBFC cannot run the engine', (await req(`/api/applications/${ffcApp.id}/decide`, sgf, { method: 'POST' })).status === 404)
  check('other NBFC cannot approve', (await req(`/api/applications/${ffcApp.id}/process`, sgf, post({ action: 'APPROVE' }))).status === 404)
  const reuse = await req('/api/applications', sgf, post({ existingBorrowerId: ffcApp.borrowerId, requestedAmount: '100000', requestedTenure: '12' }))
  check('other NBFC cannot reuse a borrower', reuse.status === 404, await reuse.text())
  check("other NBFC's list excludes FFC applications", !(await (await req('/applications', sgf)).text()).includes(ffcApp.applicationNo))

  section('Policy-driven decisions')
  const ffcRun = await req(`/api/applications/${ffcApp.id}/decide`, analyst, { method: 'POST' })
  const ffcBody = await ffcRun.json()
  check('analyst can run the engine', ffcRun.status === 200, ffcBody)
  check('FFC decision uses credflow-default', ffcBody.policy?.id === 'credflow-default', ffcBody.policy)
  const stored = await prisma.creditDecision.findUnique({ where: { applicationId: ffcApp.id }, include: { policy: true } })
  check('decision is linked to the policy version', stored?.policy?.policyKey === 'credflow-default' && stored.policy.version === ffcBody.policy?.version)

  const created = await req('/api/applications', sgf, post({
    businessName: 'Smoke Test Traders', contactPerson: 'Test', contactPhone: '9000000000', pan: 'ABCDE1234F',
    industry: 'Retail', constitution: 'LLP', vintage: '30',
    requestedAmount: '1000000', requestedTenure: '24', avgMonthlyInflow: '500000', avgMonthlyExpenses: '350000', inflowVolatility: '0.2',
  }))
  const createdBody = await created.json()
  check('NBFC-prefixed application number', /^SGF-\d{4}-\d{4}$/.test(createdBody.applicationNo ?? ''), createdBody)
  const sgfAppId: string = createdBody.applicationId
  const sgfRun = await (await req(`/api/applications/${sgfAppId}/decide`, sgf, { method: 'POST' })).json()
  check('SGF decision uses its own policy', sgfRun.policy?.id === 'unsecured-working-capital', sgfRun.policy)

  section('Maker-checker')
  // credflow-default requires a checker (ADMIN) above ₹25L
  const createSmall = await (await req('/api/applications', analyst, post(strongApplication(1_000_000)))).json()
  const small = await (await req(`/api/applications/${createSmall.applicationId}/decide`, analyst, { method: 'POST' })).json()
  check('strong application is recommended for approval', small.decision?.decision === 'APPROVE', small.decision)
  const smallApprove = await (await req(`/api/applications/${createSmall.applicationId}/process`, analyst, post({ action: 'APPROVE', sanctionedAmount: '1000000' }))).json()
  check('sanction within the single-approver limit takes effect immediately', smallApprove.outcome === 'SANCTIONED', smallApprove)

  const createBig = await (await req('/api/applications', analyst, post(strongApplication(4_000_000)))).json()
  const bigId: string = createBig.applicationId
  const big = await (await req(`/api/applications/${bigId}/decide`, analyst, { method: 'POST' })).json()
  const overrideReason = big.decision?.decision === 'APPROVE' ? undefined : 'Smoke test override'
  const bigApprove = await (await req(`/api/applications/${bigId}/process`, analyst, post({ action: 'APPROVE', sanctionedAmount: '3000000', overrideReason }))).json()
  check('sanction above ₹25L waits for a checker', bigApprove.outcome === 'PENDING_APPROVAL' && bigApprove.checkerReasons?.length > 0, bigApprove)
  const selfCheck = await req(`/api/applications/${bigId}/process`, analyst, post({ action: 'CONFIRM' }))
  check('maker cannot check their own sanction', selfCheck.status === 403, await selfCheck.text())
  const analystCheck = await req(`/api/applications/${bigId}/process`, analyst2, post({ action: 'CONFIRM' }))
  check('a role the policy does not allow cannot check', analystCheck.status === 403, await analystCheck.text())
  const returnNoRemarks = await req(`/api/applications/${bigId}/process`, admin, post({ action: 'RETURN' }))
  check('returning requires remarks', returnNoRemarks.status === 400, await returnNoRemarks.text())
  const confirm = await (await req(`/api/applications/${bigId}/process`, admin, post({ action: 'CONFIRM', remarks: 'Verified' }))).json()
  check('admin checker confirms and the application is sanctioned', confirm.outcome === 'SANCTIONED', confirm)
  const approval = await prisma.approval.findUnique({ where: { applicationId: bigId } })
  check('maker and checker are both recorded', approval?.status === 'CONFIRMED' && !!approval.checkedBy && approval.checkedBy !== approval.approvedBy)
  const again = await req(`/api/applications/${bigId}/process`, admin, post({ action: 'CONFIRM' }))
  check('a sanctioned application cannot be confirmed twice', again.status === 409, await again.text())

  section('Webhooks')
  const received: { type: string; body: string; signature: string; delivery: string }[] = []
  const receiver = createServer((r, res) => {
    let body = ''
    r.on('data', c => (body += c))
    r.on('end', () => {
      if (r.url === '/fail') { res.writeHead(500).end(); return }
      received.push({
        type: String(r.headers['credflow-event']),
        body,
        signature: String(r.headers['credflow-signature']),
        delivery: String(r.headers['credflow-delivery']),
      })
      res.writeHead(200).end('ok')
    })
  })
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve))
  const port = (receiver.address() as AddressInfo).port

  const viewerHook = await req('/api/admin/webhooks', viewer, post({ url: `http://127.0.0.1:${port}/hook`, events: ['*'] }))
  check('only admins can register webhooks', viewerHook.status === 403)
  const hookRes = await req('/api/admin/webhooks', admin, post({ url: `http://127.0.0.1:${port}/hook`, events: ['*'] }))
  const hook = await hookRes.json()
  check('admin registers a webhook endpoint (server needs WEBHOOK_ALLOW_PRIVATE_URLS=true)', hookRes.status === 201 && hook.secret?.startsWith('whsec_'), hook)
  const failHook = await (await req('/api/admin/webhooks', admin, post({ url: `http://127.0.0.1:${port}/fail`, events: ['application.created'] }))).json()

  const test = await (await req(`/api/admin/webhooks/${hook.id}/test`, admin, { method: 'POST' })).json()
  check('test event is delivered', test.delivered === true, test)

  section('Public API')
  check('OpenAPI document is public', (await fetch(`${BASE}/api/v1/openapi.json`)).status === 200)
  check('viewer cannot create API keys', (await req('/api/admin/api-keys', viewer, post({ name: 'x', scopes: ['evaluate'] }))).status === 403)
  const keyRes = await req('/api/admin/api-keys', admin, post({
    name: 'Smoke test', scopes: ['applications:read', 'applications:write', 'applications:evaluate', 'evaluate', 'policy:read', 'events:read'],
  }))
  const { key, id: keyId } = await keyRes.json()
  check('admin creates an API key (shown once)', keyRes.status === 201 && /^cf_/.test(key ?? ''))
  const readOnly = (await (await req('/api/admin/api-keys', admin, post({ name: 'Read only', scopes: ['applications:read'] }))).json()).key
  check('stored key is hashed, not plaintext', !(await prisma.apiKey.findFirst({ where: { keyHash: key } })))

  check('missing API key returns 401', (await api('/applications', null)).status === 401)
  check('unknown API key returns 401', (await api('/applications', 'cf_nope_' + 'x'.repeat(32))).status === 401)
  check('session cookie is not accepted by /api/v1', (await req('/api/v1/applications', admin)).status === 401)

  const body = {
    borrower: {
      businessName: 'API Borrower Pvt Ltd', pan: 'AAGCA1234K', gstin: '27AAGCA1234K1Z5', industry: 'IT Services',
      constitution: 'Pvt Ltd', vintage: 48, annualTurnover: 24_000_000, contactPerson: 'Asha', contactPhone: '9800000000',
    },
    requestedAmount: 1_500_000, requestedTenure: 24, sourceReference: 'ERP-42',
    financial: {
      monthlyData: Array.from({ length: 6 }, (_, i) => ({ month: `2026-0${i + 1}`, inflow: 2_000_000 + i * 10_000, outflow: 1_400_000 })),
    },
  }
  const idem = `smoke-${Date.now()}`
  const c1 = await api('/applications', key, { ...post(body), headers: { 'idempotency-key': idem } })
  const app1 = await c1.json()
  check('API creates an application', c1.status === 201 && /^FFC-/.test(app1.applicationNo ?? '') && app1.sourcePlatform === 'API', app1)
  const c2 = await api('/applications', key, { ...post(body), headers: { 'idempotency-key': idem } })
  const app2 = await c2.json()
  check('retry with the same Idempotency-Key returns the same application', c2.status === 201 && app2.id === app1.id && c2.headers.get('idempotent-replayed') === 'true', app2)
  const c3 = await api('/applications', key, { ...post({ ...body, requestedAmount: 9 }), headers: { 'idempotency-key': idem } })
  check('same Idempotency-Key with a different body is rejected', c3.status === 422, await c3.text())
  const bad = await api('/applications', key, post({ requestedAmount: -1 }))
  const badBody = await bad.json()
  check('validation errors list the failing fields', bad.status === 400 && Array.isArray(badBody.error?.details), badBody)

  check('read-only key cannot create', (await api('/applications', readOnly, post(body))).status === 403)
  check('API reads its own application', (await api(`/applications/${app1.id}`, readOnly)).status === 200)
  check("API cannot read another NBFC's application", (await api(`/applications/${sgfAppId}`, key)).status === 404)
  const list = await (await api('/applications?limit=2', readOnly)).json()
  check('API lists with a cursor', list.data?.length === 2 && typeof list.nextCursor === 'string', list.nextCursor)

  const evalRes = await api(`/applications/${app1.id}/evaluate`, key, { method: 'POST' })
  const evalBody = await evalRes.json()
  check('API evaluates a stored application', evalRes.status === 200 && ['APPROVE', 'REFER', 'REJECT'].includes(evalBody.evaluation?.decision), evalBody)
  check('evaluation records which connectors ran', typeof evalBody.connectors === 'object')
  const approveViaApi = await api(`/applications/${app1.id}/approve`, key, { method: 'POST' })
  check('there is no API route to sanction', approveViaApi.status === 404 || approveViaApi.status === 405)

  const stateless = await api('/evaluate', key, post({
    requestedAmount: 2_500_000, requestedTenure: 24,
    borrower: { pan: 'AAGCG1234K', gstin: '27AAGCG1234K1Z5', vintage: 48, industry: 'Manufacturing', annualTurnover: 9_600_000 },
    financial: { avgMonthlyInflow: 800_000, avgMonthlyExpenses: 550_000, freeCashFlow: 250_000, inflowVolatility: 0.18 },
    collateral: { type: 'MACHINERY', assessedValue: 3_000_000, ltv: 60, hasPersonalGuarantee: false },
  }))
  const statelessBody = await stateless.json()
  check('stateless evaluate returns the documented example result', statelessBody.evaluation?.creditScore === 75 && statelessBody.evaluation?.finalRecommendedAmt === 1_980_000, statelessBody.evaluation)
  check('stateless evaluate rejects malformed input', (await api('/evaluate', key, post({ requestedAmount: 'lots' }))).status === 400)
  const policy = await (await api('/policy', key)).json()
  check('API returns the active policy', policy.policy?.id === 'credflow-default' && typeof policy.checksum === 'string')

  const events = await (await api('/events?type=application.created&limit=200', key)).json()
  check('events feed includes the created application', events.data?.some((e: { data: { application?: { id: string } } }) => e.data.application?.id === app1.id))

  const delivered = await waitFor(() => received.find(r => r.type === 'application.created' && JSON.parse(r.body).data.application.id === app1.id))
  check('webhook received application.created', !!delivered)
  check('webhook signature verifies with the endpoint secret', !!delivered && verifySignature(hook.secret, delivered.body, delivered.signature))
  check('webhook received application.evaluated', !!(await waitFor(() => received.find(r => r.type === 'application.evaluated'))))
  const failed = await waitFor(async () => {
    const d = await prisma.webhookDelivery.findFirst({ where: { endpointId: failHook.id, attempts: { gte: 1 } } })
    return d ?? undefined
  })
  check('failed delivery is kept for retry with the error recorded', failed?.status === 'PENDING' && failed.lastError === 'HTTP 500' && failed.nextAttemptAt > new Date(), failed)

  check('revoking a key', (await req(`/api/admin/api-keys/${keyId}`, admin, { method: 'DELETE' })).status === 200)
  check('revoked key returns 401', (await api('/applications', key)).status === 401)
  receiver.close()

  section('Audit log')
  const apiAudit = await prisma.auditLog.findFirst({ where: { applicationId: app1.id, action: 'APPLICATION_CREATED' } })
  check('API actions are attributed to the API key', apiAudit?.apiKeyId === keyId && apiAudit?.userId === null)
  let blocked = false
  try {
    await prisma.auditLog.deleteMany({ where: { applicationId: app1.id } })
  } catch {
    blocked = true
  }
  check('database refuses to delete audit entries', blocked)

  section('Logout')
  const out = await req('/api/auth/logout', analyst, { method: 'POST' })
  check('logout clears the cookie', (out.headers.getSetCookie().find(c => c.startsWith('credflow_session=')) ?? '').startsWith('credflow_session=;'))

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed')
  await prisma.$disconnect()
  process.exit(failures ? 1 : 0)
}

main().catch(async e => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
