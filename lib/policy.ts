// Per-NBFC credit policy: loading the active version and applying new versions.

import { createHash } from 'node:crypto'
import prisma from './db'
import { DEFAULT_POLICY, parsePolicy, type CreditPolicy } from '@credflow/engine'

export type ActivePolicy = {
  policy: CreditPolicy
  /** CreditPolicy row id, or null when the NBFC has no policy and the built-in default applies. */
  policyId: string | null
  checksum: string
}

// Stable JSON (sorted keys) so the checksum depends only on content.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function policyChecksum(policy: CreditPolicy): string {
  return createHash('sha256').update(canonicalJson(policy)).digest('hex')
}

export async function getActivePolicy(nbfcId: string): Promise<ActivePolicy> {
  const row = await prisma.creditPolicy.findFirst({
    where: { nbfcId, isActive: true },
    orderBy: { activatedAt: 'desc' },
  })
  if (!row) {
    return { policy: DEFAULT_POLICY, policyId: null, checksum: policyChecksum(DEFAULT_POLICY) }
  }
  // Re-validate on read: a row edited by hand must not silently change behaviour
  return { policy: parsePolicy(JSON.parse(row.document)), policyId: row.id, checksum: row.checksum }
}

export class PolicyVersionConflictError extends Error {
  constructor(policyKey: string, version: string) {
    super(`Policy ${policyKey}@${version} already exists for this NBFC with different content. Bump the version to apply changes.`)
    this.name = 'PolicyVersionConflictError'
  }
}

/**
 * Validates a policy document and makes it the NBFC's active policy.
 * Re-applying an identical version just re-activates it; changed content under an
 * existing version is refused, so a version always means one exact set of rules.
 */
export async function applyPolicy(
  nbfcId: string,
  document: unknown,
  options: { createdBy?: string | null } = {}
): Promise<{ id: string; policy: CreditPolicy; checksum: string; created: boolean }> {
  const policy = parsePolicy(document)
  const checksum = policyChecksum(policy)

  return prisma.$transaction(async tx => {
    const existing = await tx.creditPolicy.findUnique({
      where: { nbfcId_policyKey_version: { nbfcId, policyKey: policy.id, version: policy.version } },
    })
    if (existing && existing.checksum !== checksum) {
      throw new PolicyVersionConflictError(policy.id, policy.version)
    }

    await tx.creditPolicy.updateMany({ where: { nbfcId, isActive: true }, data: { isActive: false } })

    const row = existing
      ? await tx.creditPolicy.update({ where: { id: existing.id }, data: { isActive: true, activatedAt: new Date() } })
      : await tx.creditPolicy.create({
          data: {
            nbfcId,
            policyKey: policy.id,
            name: policy.name,
            version: policy.version,
            document: JSON.stringify(policy),
            checksum,
            isActive: true,
            activatedAt: new Date(),
            createdBy: options.createdBy ?? null,
          },
        })

    return { id: row.id, policy, checksum, created: !existing }
  })
}
