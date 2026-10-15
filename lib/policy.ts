// Loads an NBFC's credit policy from its Settings row and merges it over the engine defaults.

import prisma from './db'
import { DEFAULT_CONFIG, type CollateralType, type EngineConfig, type RiskBand } from './decision-engine'

export type CreditPolicy = EngineConfig & { version: string }

function parseJson<T>(value: string | null | undefined): T | Record<string, never> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function getCreditPolicy(nbfcId: string): Promise<CreditPolicy> {
  const settings = await prisma.settings.findUnique({ where: { nbfcId } })

  if (!settings) {
    return { ...DEFAULT_CONFIG, version: 'default' }
  }

  return {
    version: settings.creditPolicyVersion,
    approveThreshold: settings.approveThreshold,
    referThreshold: settings.referThreshold,
    minEMICoverage: settings.minEMICoverage,
    maxInflowCV: settings.maxInflowCV,
    minBusinessVintage: settings.minBusinessVintage,
    ltvLimits: {
      ...DEFAULT_CONFIG.ltvLimits,
      ...parseJson<Record<CollateralType, number>>(settings.ltvLimits)
    },
    industryRiskBands: {
      ...DEFAULT_CONFIG.industryRiskBands,
      ...parseJson<Record<string, RiskBand>>(settings.industryRiskBands)
    }
  }
}
