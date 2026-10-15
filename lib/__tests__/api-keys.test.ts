import { describe, expect, it } from 'vitest'
import { generateApiKey } from '../api-keys'

describe('API keys', () => {
  it('have the cf_<prefix>_<secret> format and store only a hash', () => {
    const { key, prefix, keyHash } = generateApiKey()
    expect(key).toMatch(/^cf_[0-9a-f]{8}_[A-Za-z0-9_-]{32}$/)
    expect(key.startsWith(`cf_${prefix}_`)).toBe(true)
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(keyHash).not.toContain(key)
  })

  it('are unique', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().key))
    expect(keys.size).toBe(200)
  })
})
