// End-to-end smoke test against a running, freshly seeded CredFlow instance.
// Covers authentication, tenant isolation, roles and policy-driven decisions.
//
//   npm run setup && npm run build && npm start &
//   BASE_URL=http://localhost:3000 npm run smoke

import prisma from '../lib/db'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
let failures = 0

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

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

async function main() {
  const ffcApp = await prisma.loanApplication.findFirstOrThrow({ where: { nbfc: { code: 'FFC' } }, include: { borrower: true } })

  // ── Authentication ──
  check('unauthenticated page redirects to login', (await req('/dashboard')).status === 307)
  check('unauthenticated API returns 401', (await req('/api/applications', undefined, { method: 'POST', body: '{}' })).status === 401)

  const forged = encodeURIComponent(JSON.stringify({ id: 'x', role: 'ADMIN', nbfcId: ffcApp.nbfcId }))
  check('unsigned JSON cookie is rejected', (await req(`/api/applications/${ffcApp.id}/decide`, `credflow_session=${forged}`, { method: 'POST' })).status === 401)

  const badLogin = await req('/api/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: 'analyst@credflow.io', password: 'wrong' }) })
  check('wrong password returns 401', badLogin.status === 401)

  const ffc = await login('analyst@credflow.io', 'Analyst@123')
  const sgf = await login('admin@smegrowth.in', 'Admin@123')
  const viewer = await login('viewer@credflow.io', 'Viewer@123')

  const [h, payload, sig] = viewer.split('=')[1].split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const tampered = `credflow_session=${h}.${Buffer.from(JSON.stringify({ ...claims, role: 'ADMIN' })).toString('base64url')}.${sig}`
  check('tampered JWT is rejected', (await req(`/api/applications/${ffcApp.id}/decide`, tampered, { method: 'POST' })).status === 401)

  // ── Roles ──
  check('viewer cannot run the engine', (await req(`/api/applications/${ffcApp.id}/decide`, viewer, { method: 'POST' })).status === 403)

  // ── Tenant isolation ──
  check('other NBFC cannot view application', (await req(`/applications/${ffcApp.id}`, sgf)).status === 404)
  check('other NBFC cannot run the engine', (await req(`/api/applications/${ffcApp.id}/decide`, sgf, { method: 'POST' })).status === 404)
  check('other NBFC cannot approve', (await req(`/api/applications/${ffcApp.id}/process`, sgf, { method: 'POST', body: JSON.stringify({ action: 'APPROVE' }) })).status === 404)
  const reuse = await req('/api/applications', sgf, {
    method: 'POST',
    body: JSON.stringify({ existingBorrowerId: ffcApp.borrowerId, industry: 'Retail', constitution: 'LLP', requestedAmount: '100000', requestedTenure: '12' }),
  })
  check("other NBFC cannot reuse a borrower", reuse.status === 404)
  const sgfList = await (await req('/applications', sgf)).text()
  check("other NBFC's list excludes FFC applications", !sgfList.includes(ffcApp.applicationNo))

  // ── Decisions use each NBFC's active policy ──
  const ffcRun = await req(`/api/applications/${ffcApp.id}/decide`, ffc, { method: 'POST' })
  const ffcBody = await ffcRun.json()
  check('analyst can run the engine', ffcRun.status === 200, JSON.stringify(ffcBody).slice(0, 200))
  check('FFC decision uses credflow-default', ffcBody.policy?.id === 'credflow-default')
  const stored = await prisma.creditDecision.findUnique({ where: { applicationId: ffcApp.id }, include: { policy: true } })
  check('decision is linked to the policy version', stored?.policy?.policyKey === 'credflow-default' && stored.policy.version === ffcBody.policy?.version)

  const created = await req('/api/applications', sgf, {
    method: 'POST',
    body: JSON.stringify({
      businessName: 'Smoke Test Traders', contactPerson: 'Test', contactPhone: '9000000000', pan: 'ABCDE1234F',
      industry: 'Retail', constitution: 'LLP', vintage: '30',
      requestedAmount: '1000000', requestedTenure: '24', avgMonthlyInflow: '500000', avgMonthlyExpenses: '350000', inflowVolatility: '0.2',
    }),
  })
  const createdBody = await created.json()
  check('NBFC-prefixed application number', /^SGF-\d{4}-\d{4}$/.test(createdBody.applicationNo ?? ''), JSON.stringify(createdBody))
  const sgfRun = await (await req(`/api/applications/${createdBody.applicationId}/decide`, sgf, { method: 'POST' })).json()
  check('SGF decision uses its own policy', sgfRun.policy?.id === 'unsecured-working-capital', JSON.stringify(sgfRun.policy))

  // ── Logout ──
  const out = await req('/api/auth/logout', ffc, { method: 'POST' })
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
