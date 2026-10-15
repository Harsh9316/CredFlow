import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICY, parsePolicy } from '../src'
import { DEFAULT_POLICY_INPUT } from '../src/default-policy'
import { POLICIES_DIR, loadPolicy, policyFiles, readPolicyYaml } from './helpers'

describe('bundled policy files', () => {
  it.each(policyFiles())('%s is valid', file => {
    expect(() => loadPolicy(file)).not.toThrow()
  })

  it('have unique ids', () => {
    const ids = policyFiles().map(f => loadPolicy(f).id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carry a calibration disclaimer, except the legacy reproduction', () => {
    for (const f of policyFiles().filter(f => !f.startsWith('legacy'))) {
      expect(readFileSync(POLICIES_DIR + f, 'utf8')).toMatch(/Illustrative starting point only/)
    }
  })

  it('DEFAULT_POLICY is in sync with credflow-default.yaml (run `npm run policy:sync-default`)', () => {
    expect(DEFAULT_POLICY_INPUT).toEqual(readPolicyYaml('credflow-default.yaml'))
    expect(DEFAULT_POLICY).toEqual(parsePolicy(readPolicyYaml('credflow-default.yaml')))
  })
})
