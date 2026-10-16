import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SetuAaConnector, SetuGstConnector, SetuPanConnector } from '../setu'
import { BureauGatewayConnector } from '../bureau-gateway'
import { ConnectorError, type FetchLike } from '../http'

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** A fake fetch that answers from a route table and records every call. */
function fakeFetch(routes: Record<string, (call: Call) => [status: number, body: unknown]>) {
  const calls: Call[] = []
  const impl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const key = `${call.method} ${new URL(url).pathname}`
    const route = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && key.startsWith(k.slice(0, -1)))?.[1]
    if (!route) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 })
    const [status, body] = route(call)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { impl, calls }
}

const ENV = {
  SETU_ENV: 'sandbox',
  SETU_AA_CLIENT_ID: 'aa-client',
  SETU_AA_CLIENT_SECRET: 'aa-secret',
  SETU_AA_PRODUCT_INSTANCE_ID: 'aa-instance',
  SETU_DATA_CLIENT_ID: 'dg-client',
  SETU_DATA_CLIENT_SECRET: 'dg-secret',
  SETU_GST_PRODUCT_INSTANCE_ID: 'gst-instance',
  SETU_PAN_PRODUCT_INSTANCE_ID: 'pan-instance',
  BUREAU_GATEWAY_URL: 'https://gateway.example.test/report',
  BUREAU_GATEWAY_TOKEN: 'gw-token',
}
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v } })
afterEach(() => { for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

const range = { from: new Date('2025-10-01T00:00:00Z'), to: new Date('2026-10-01T00:00:00Z') }

describe('Setu Account Aggregator', () => {
  it('logs in, creates a consent with the documented body and reuses the token', async () => {
    const { impl, calls } = fakeFetch({
      'POST /users/login': () => [200, { access_token: 'tok-1' }],
      'POST /v2/consents': () => [201, { id: 'c-1', url: 'https://fiu-sandbox.setu.co/consents/webview/c-1', status: 'PENDING' }],
      'GET /v2/consents/c-1': () => [200, { id: 'c-1', status: 'ACTIVE' }],
    })
    const aa = new SetuAaConnector(impl)
    const created = await aa.createConsent({ mobile: '+91 98765 43210', pan: 'AAGCM1234M', fiTypes: ['DEPOSIT', 'GSTR1_3B'], dataRange: range, reference: 'dc_1' })
    expect(created).toEqual({ consentId: 'c-1', url: 'https://fiu-sandbox.setu.co/consents/webview/c-1', status: 'PENDING' })
    expect(await aa.getConsent('c-1')).toEqual({ status: 'ACTIVE' })

    expect(calls.map(c => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /users/login', 'POST /v2/consents', 'GET /v2/consents/c-1'])
    expect(calls[0].url.startsWith('https://fiu-sandbox.setu.co/')).toBe(true)
    expect(calls[0].headers.client).toBe('bridge')
    expect(calls[0].body).toEqual({ clientID: 'aa-client', grant_type: 'client_credentials', secret: 'aa-secret' })
    expect(calls[1].headers.authorization).toBe('Bearer tok-1')
    expect(calls[1].headers['x-product-instance-id']).toBe('aa-instance')
    expect(calls[1].body).toMatchObject({
      vua: '9876543210',
      PAN: 'AAGCM1234M',
      fiTypes: ['DEPOSIT', 'GSTR1_3B'],
      fetchType: 'ONETIME',
      consentTypes: ['PROFILE', 'SUMMARY', 'TRANSACTIONS'],
      dataRange: { from: '2025-10-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
      additionalParams: { tags: ['credrail', 'dc_1'] },
    })
  })

  it('logs in again once when a call returns 401', async () => {
    let logins = 0
    let first = true
    const { impl } = fakeFetch({
      'POST /users/login': () => [200, { access_token: `tok-${++logins}` }],
      'GET /v2/consents/c-1': () => (first ? ((first = false), [401, { errorCode: 'unauthorized' }]) : [200, { status: 'INITIATED' }]),
    })
    const aa = new SetuAaConnector(impl)
    expect(await aa.getConsent('c-1')).toEqual({ status: 'PENDING' })
    expect(logins).toBe(2)
  })

  it('creates a session and returns accounts from every FIP', async () => {
    const { impl, calls } = fakeFetch({
      'POST /users/login': () => [200, { access_token: 'tok' }],
      'POST /v2/sessions': () => [201, { id: 's-1', status: 'PENDING' }],
      'GET /v2/sessions/s-1': () => [200, {
        id: 's-1',
        status: 'PARTIAL',
        fips: [
          { fipID: 'bank-a', accounts: [{ linkRefNumber: 'l1', maskedAccNumber: 'XX11', FIstatus: 'READY', data: { account: { type: 'deposit' } } }] },
          { fipID: 'bank-b', accounts: [{ linkRefNumber: 'l2', maskedAccNumber: 'XX22', status: 'denied', data: null }] },
        ],
      }],
    })
    const aa = new SetuAaConnector(impl)
    expect(await aa.createSession('c-1', range)).toEqual({ sessionId: 's-1', status: 'PENDING' })
    expect(calls[1].body).toMatchObject({ consentId: 'c-1', format: 'json' })
    const s = await aa.getSession('s-1')
    expect(s.status).toBe('PARTIAL')
    expect(s.accounts.map(a => [a.fipId, a.fiStatus])).toEqual([['bank-a', 'READY'], ['bank-b', 'DENIED']])
  })

  it('rejects an invalid mobile number before calling Setu', async () => {
    const { impl, calls } = fakeFetch({})
    await expect(new SetuAaConnector(impl).createConsent({ mobile: '12345', fiTypes: ['DEPOSIT'], dataRange: range, reference: 'x' })).rejects.toThrow(/10 digits/)
    expect(calls).toHaveLength(0)
  })

  it('reports missing configuration clearly', async () => {
    delete process.env.SETU_AA_CLIENT_ID
    const err = await new SetuAaConnector(fakeFetch({}).impl).getConsent('c').catch(e => e)
    expect(err).toBeInstanceOf(ConnectorError)
    expect(err.code).toBe('not_configured')
  })
})

describe('Setu GSTIN verification', () => {
  it('maps the documented success response', async () => {
    const { impl, calls } = fakeFetch({
      'POST /api/verify/gst': () => [200, {
        verification: 'success',
        data: {
          company: { name: 'BLUESTONE JEWELLERY AND LIFESTYLE PRIVATE LIMITED', tradeName: 'BLUESTONE', status: 'Active', constitutionOfBusiness: 'Private Limited Company' },
          gst: { id: '27AAICB3918J1CT', registrationDate: '01/07/2017' },
        },
      }],
    })
    const r = await new SetuGstConnector(impl).verifyGstin('27AAICB3918J1CT')
    expect(r).toMatchObject({ provider: 'setu', status: 'ACTIVE', tradeName: 'BLUESTONE', pan: 'AAICB3918J', registeredOn: '2017-07-01' })
    expect(calls[0].url).toBe('https://dg-sandbox.setu.co/api/verify/gst')
    expect(calls[0].headers).toMatchObject({ 'x-client-id': 'dg-client', 'x-client-secret': 'dg-secret', 'x-product-instance-id': 'gst-instance' })
  })

  it('treats cancelled and unknown GSTINs as answers, not errors', async () => {
    const gst = (body: unknown) => new SetuGstConnector(fakeFetch({ 'POST /api/verify/gst': () => [200, body] }).impl)
    expect((await gst({ verification: 'success', data: { company: { status: 'Cancelled' } } }).verifyGstin('X')).status).toBe('CANCELLED')
    expect((await gst({ verification: 'failed', message: 'GSTIN not found' }).verifyGstin('X')).status).toBe('NOT_FOUND')
  })

  it('uses production hosts when SETU_ENV=production', async () => {
    process.env.SETU_ENV = 'production'
    const { impl, calls } = fakeFetch({ 'POST /api/verify/gst': () => [200, { verification: 'failed' }] })
    await new SetuGstConnector(impl).verifyGstin('X')
    expect(calls[0].url).toBe('https://dg.setu.co/api/verify/gst')
  })
})

describe('Setu PAN verification', () => {
  it('sends consent and reason, and scores the name match', async () => {
    const { impl, calls } = fakeFetch({ 'POST /api/verify/pan': () => [200, { verification: 'SUCCESS', data: { full_name: 'ACME TRADERS PRIVATE LIMITED', category: 'Company' } }] })
    const r = await new SetuPanConnector(impl).verifyPan('AAGCA1234M', 'Acme Traders Pvt Ltd')
    expect(r).toMatchObject({ valid: true, category: 'Company', nameMatch: 1 })
    expect(calls[0].body).toMatchObject({ pan: 'AAGCA1234M', consent: 'Y' })
  })

  it('returns invalid for a PAN the registry rejects, but surfaces credential errors', async () => {
    const pan = (status: number, body: unknown) => new SetuPanConnector(fakeFetch({ 'POST /api/verify/pan': () => [status, body] }).impl)
    expect(await pan(404, { error: { code: 'pan_not_found' } }).verifyPan('AAAAA0000A', 'x')).toEqual({ provider: 'setu', valid: false })
    await expect(pan(401, { error: { code: 'unauthorized' } }).verifyPan('AAAAA0000A', 'x')).rejects.toBeInstanceOf(ConnectorError)
  })
})

describe('Bureau gateway', () => {
  const report = { reportId: 'R-1', bureau: 'cibil', rank: 3, dpd90Plus: false, fraudOrWilfulDefault: false }
  const consent = { reference: 'esign-42', capturedAt: '2026-10-01T10:00:00.000Z' }

  it('sends identity and consent, and normalises the report', async () => {
    const { impl, calls } = fakeFetch({ 'POST /report': () => [200, report] })
    const r = await new BureauGatewayConnector(impl).fetchReport({ pan: 'AAGCA1234M', gstin: null, legalName: 'Acme' }, consent)
    expect(r).toMatchObject({ provider: 'gateway:cibil', reportId: 'R-1', score: null, rank: 3, hasDelinquency: false, hasFraudAlert: false })
    expect(calls[0].headers.authorization).toBe('Bearer gw-token')
    expect(calls[0].body).toEqual({ pan: 'AAGCA1234M', gstin: null, legalName: 'Acme', consentReference: 'esign-42', consentCapturedAt: consent.capturedAt, purpose: 'credit_assessment' })
  })

  it('treats 404 and noRecord as a thin file', async () => {
    const id = { pan: 'AAGCA1234M', legalName: 'Acme' }
    expect(await new BureauGatewayConnector(fakeFetch({ 'POST /report': () => [404, {}] }).impl).fetchReport(id, consent)).toBeNull()
    expect(await new BureauGatewayConnector(fakeFetch({ 'POST /report': () => [200, { ...report, noRecord: true }] }).impl).fetchReport(id, consent)).toBeNull()
  })

  it('rejects responses that break the contract', async () => {
    const bad = (body: unknown) => new BureauGatewayConnector(fakeFetch({ 'POST /report': () => [200, body] }).impl).fetchReport({ legalName: 'A' }, consent)
    await expect(bad({ reportId: 'R' })).rejects.toThrow(/contract/)
    await expect(bad({ ...report, rank: undefined })).rejects.toThrow(/neither a score nor a rank/)
    await expect(bad({ ...report, rank: 11 })).rejects.toThrow(/contract/)
  })
})
