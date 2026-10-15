// Bureau data is a score MODIFIER, never a gate on its own.
// Absence of bureau data does not imply rejection; cash-flow underwriting stays primary.

import type { CreditPolicy } from './policy'
import type { ApplicationInput, BureauOverlayResult } from './types'

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export function applyBureauOverlay(bureau: ApplicationInput['bureau'], policy: CreditPolicy): BureauOverlayResult {
  if (!bureau || bureau.score === undefined || bureau.score === null) {
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
      bureauScore: bureau.score,
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

  const band = config.scoreBands.find(b => bureau.score >= b.minScore)
  const bandModifier = band ? band.modifier : config.otherwiseModifier
  modifier += bandModifier
  notes.push(
    band
      ? `Bureau score ${bureau.score} (band ${band.minScore}+). Modifier ${signed(bandModifier)}.`
      : `Bureau score ${bureau.score} (below all bands). Modifier ${signed(bandModifier)}.`
  )

  return { available: true, bureauScore: bureau.score, delinquencyFlag, fraudAlert: false, modifier, notes }
}
