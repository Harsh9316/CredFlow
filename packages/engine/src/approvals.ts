import type { CreditPolicy } from './policy'
import { lakh } from './format'

/**
 * Why a sanction needs a second person (checker) under this policy.
 * An empty list means the maker's approval takes effect immediately.
 */
export function checkerRequirements(
  policy: CreditPolicy,
  sanction: { sanctionedAmount: number; isOverride: boolean }
): string[] {
  const { checkerRequiredAbove, checkerRequiredForOverrides } = policy.approvals
  const reasons: string[] = []
  if (checkerRequiredAbove !== null && sanction.sanctionedAmount > checkerRequiredAbove) {
    reasons.push(`Sanction of ${lakh(sanction.sanctionedAmount)} exceeds the single-approver limit of ${lakh(checkerRequiredAbove)}`)
  }
  if (checkerRequiredForOverrides && sanction.isOverride) {
    reasons.push('Decision overrides the system recommendation')
  }
  return reasons
}

/** Whether a user may confirm or return a sanction that someone else submitted. */
export function canActAsChecker(
  policy: CreditPolicy,
  checker: { userId: string; role: string },
  makerUserId: string
): boolean {
  return checker.userId !== makerUserId && (policy.approvals.checkerRoles as string[]).includes(checker.role)
}
