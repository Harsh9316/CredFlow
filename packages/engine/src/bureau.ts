// Bureau data is a score MODIFIER, never a gate on its own.
// Absence of bureau data does not imply rejection; cash-flow underwriting stays primary.

import type { CreditPolicy } from './policy'
import type { ApplicationInput, BureauOverlayResult } from './types'

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export function applyBureauOverlay(bureau: ApplicationInput['bureau'], policy: CreditPolicy): BureauOverlayResult {
  const score = bureau?.score ?? null
  const rank = bureau?.rank ?? null
  if (!bureau || (score === null && rank === null)) {
    return {
      available: false,
      delinquencyFlag: false,
      fraudAlert: false,
      modifier: 0,
      notes: ['Bureau data not available. Proceeding with cash-flow based assessment.'],
    }
  }

  const config = policy.bureau
  const delinquencyFlag = !!bureau.hasDelinquency

  if (bureau.hasFraudAlert) {
    return {
      available: true,
      bureauScore: score ?? undefined,
      bureauRank: rank ?? undefined,
      delinquencyFlag,
      fraudAlert: true,
      modifier: config.fraudAlertModifier,
      notes: ['BUREAU FRAUD ALERT: Application must be rejected or escalated.'],
    }
  }

  const notes: string[] = []
  let modifier = 0

  if (delinquencyFlag) {
    modifier += config.delinquencyModifier
    notes.push(`Bureau shows DPD 90+ history. Score adjusted by ${signed(config.delinquencyModifier)}.`)
  }

  if (score !== null) {
    const band = config.scoreBands.find(b => score >= b.minScore)
    const bandModifier = band ? band.modifier : config.otherwiseModifier
    modifier += bandModifier
    notes.push(
      band
        ? `Bureau score ${score} (band ${band.minScore}+). Modifier ${signed(bandModifier)}.`
        : `Bureau score ${score} (below all bands). Modifier ${signed(bandModifier)}.`
    )
  } else if (rank !== null) {
    const band = [...config.rankBands].sort((a, b) => a.maxRank - b.maxRank).find(b => rank <= b.maxRank)
    const bandModifier = band ? band.modifier : config.rankOtherwiseModifier
    modifier += bandModifier
    notes.push(
      band
        ? `Bureau rank ${rank} (band up to ${band.maxRank}, 1 = lowest risk). Modifier ${signed(bandModifier)}.`
        : `Bureau rank ${rank} (above all bands, 1 = lowest risk). Modifier ${signed(bandModifier)}.`
    )
  }

  return { available: true, bureauScore: score ?? undefined, bureauRank: rank ?? undefined, delinquencyFlag, fraudAlert: false, modifier, notes }
}
