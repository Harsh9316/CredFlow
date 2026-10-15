/* eslint-disable @typescript-eslint/no-explicit-any -- these tests deliberately build invalid policy documents */
import { describe, expect, it } from 'vitest'
import { PolicyValidationError, parsePolicy } from '../src'
import { readPolicyYaml } from './helpers'

const base = () => structuredClone(readPolicyYaml('credflow-default.yaml')) as any

function issuesFor(mutate: (p: any) => void): string[] {
  const p = base()
  mutate(p)
  try {
    parsePolicy(p)
    return []
  } catch (e) {
    expect(e).toBeInstanceOf(PolicyValidationError)
    return (e as PolicyValidationError).issues.map(i => `${i.path}: ${i.message}`)
  }
}

describe('policy validation', () => {
  it('accepts the default policy', () => {
    expect(issuesFor(() => {})).toEqual([])
  })

  it('requires component max points to add up to 100', () => {
    expect(issuesFor(p => { p.scoring.cashFlow.max = 35 })).toContainEqual(expect.stringMatching(/add up to 100 \(got 105\)/))
  })

  it('rejects referThreshold above approveThreshold', () => {
    expect(issuesFor(p => { p.decision.referThreshold = 80 })).toContainEqual(expect.stringMatching(/^decision.referThreshold/))
  })

  it('rejects bands out of order', () => {
    expect(issuesFor(p => { p.scoring.stability.bands.reverse() })).toContainEqual(expect.stringMatching(/ordered from best to worst/))
  })

  it('rejects band points above the component max', () => {
    expect(issuesFor(p => { p.scoring.emiCoverage.bands[0].points = 40 })).toContainEqual(expect.stringMatching(/exceed component max/))
  })

  it('requires an LTV limit for every collateral type', () => {
    expect(issuesFor(p => { delete p.collateral.ltvLimits.STOCK })).toContainEqual(expect.stringMatching(/^collateral.ltvLimits.STOCK:/))
  })

  it('rejects unknown severities and malformed ids', () => {
    const issues = issuesFor(p => {
      p.id = 'My Policy'
      p.fraud.rules.missingIdentity.severity = 'SEVERE'
    })
    expect(issues).toContainEqual(expect.stringMatching(/^id:/))
    expect(issues).toContainEqual(expect.stringMatching(/^fraud.rules.missingIdentity.severity/))
  })

  it('error message lists every issue', () => {
    expect(() => parsePolicy({})).toThrow(/Invalid credit policy:\n {2}- /)
  })
})
