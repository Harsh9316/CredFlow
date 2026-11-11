import { afterEach, describe, expect, it, vi } from 'vitest'
import { scoreDefaultRisk } from '@credrail/engine'
import { explainDefaultRisk, getPdModel, llmExplanationsEnabled } from '../default-risk'

afterEach(() => vi.unstubAllEnvs())

describe('default-risk configuration', () => {
  it('is off unless CREDRAIL_PD_MODEL is set', () => {
    vi.stubEnv('CREDRAIL_PD_MODEL', '')
    expect(getPdModel()).toBeNull()
  })

  it('loads and validates the configured model', () => {
    vi.stubEnv('CREDRAIL_PD_MODEL', 'ml/models/uci-taiwan.json')
    expect(getPdModel()?.id).toBe('uci-taiwan-logreg')
  })

  it('needs both the flag and an API key before calling Claude', async () => {
    vi.stubEnv('CREDRAIL_LLM_EXPLANATIONS', 'true')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(llmExplanationsEnabled()).toBe(false)

    vi.stubEnv('CREDRAIL_PD_MODEL', 'ml/models/uci-taiwan.json')
    const risk = scoreDefaultRisk(getPdModel()!, {})
    await expect(explainDefaultRisk(risk, 'APPROVE')).resolves.toBeNull()
  })
})
