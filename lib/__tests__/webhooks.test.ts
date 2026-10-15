import { afterEach, describe, expect, it } from 'vitest'
import { isPrivateAddress, signPayload, validateWebhookUrl, verifySignature } from '../webhooks'

describe('webhook signatures', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({ id: 'evt_1', type: 'application.created' })

  it('verifies a signature it produced', () => {
    expect(verifySignature(secret, body, signPayload(secret, body))).toBe(true)
  })

  it('rejects a tampered body, wrong secret or stale timestamp', () => {
    const header = signPayload(secret, body)
    expect(verifySignature(secret, body + ' ', header)).toBe(false)
    expect(verifySignature('whsec_other', body, header)).toBe(false)
    const old = signPayload(secret, body, Math.floor(Date.now() / 1000) - 3600)
    expect(verifySignature(secret, body, old)).toBe(false)
  })

  it('matches the documented scheme: HMAC-SHA256 of "<t>.<body>"', async () => {
    const { createHmac } = await import('node:crypto')
    const header = signPayload(secret, body, 1700000000)
    expect(header).toBe(`t=1700000000,v1=${createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex')}`)
  })
})

describe('webhook destination checks', () => {
  afterEach(() => { delete process.env.WEBHOOK_ALLOW_PRIVATE_URLS })

  it('classifies private and public addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it('requires https and a public host', () => {
    expect(validateWebhookUrl('https://example.com/hook')).toBe('https://example.com/hook')
    expect(() => validateWebhookUrl('http://example.com/hook')).toThrow(/https/)
    expect(() => validateWebhookUrl('https://localhost/hook')).toThrow(/public/)
    expect(() => validateWebhookUrl('https://169.254.169.254/latest')).toThrow(/public/)
    expect(() => validateWebhookUrl('https://user:pw@example.com/')).toThrow(/credentials/)
    expect(() => validateWebhookUrl('not a url')).toThrow(/valid URL/)
  })

  it('allows local http targets only when explicitly enabled (development)', () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_URLS = 'true'
    expect(validateWebhookUrl('http://localhost:4000/hook')).toBe('http://localhost:4000/hook')
  })
})
