// Runtime validation for ApplicationInput, for callers receiving it over the wire.

import { z } from 'zod'
import { COLLATERAL_TYPES } from './policy'
import type { ApplicationInput } from './types'

export const ApplicationInputSchema = z.object({
  requestedAmount: z.number().positive(),
  requestedTenure: z.number().int().min(1).max(360).describe('Months'),
  borrower: z.object({
    pan: z.string().nullish(),
    gstin: z.string().nullish(),
    vintage: z.number().int().min(0).describe('Months in business'),
    industry: z.string().min(1),
    annualTurnover: z.number().min(0).nullish(),
  }),
  financial: z.object({
    avgMonthlyInflow: z.number().min(0),
    avgMonthlyExpenses: z.number().min(0),
    freeCashFlow: z.number(),
    inflowVolatility: z.number().min(0).describe('Coefficient of variation of monthly inflows'),
    monthlyData: z.array(z.object({ month: z.string(), inflow: z.number().min(0), outflow: z.number().min(0) })).optional(),
  }),
  collateral: z
    .object({
      type: z.enum(COLLATERAL_TYPES),
      assessedValue: z.number().min(0),
      ltv: z.number().min(0).max(100),
      hasPersonalGuarantee: z.boolean(),
    })
    .nullish(),
  bureau: z
    .object({
      score: z.number().nullish(),
      rank: z.number().int().min(1).nullish(),
      hasDelinquency: z.boolean().optional(),
      hasFraudAlert: z.boolean().optional(),
    })
    .nullish(),
  verifications: z
    .object({
      gstinStatus: z.enum(['ACTIVE', 'CANCELLED', 'SUSPENDED', 'NOT_FOUND']).optional(),
      panValid: z.boolean().optional(),
      panNameMatch: z.number().min(0).max(1).optional(),
    })
    .nullish(),
}) satisfies z.ZodType<ApplicationInput>

export function parseApplicationInput(input: unknown): ApplicationInput {
  return ApplicationInputSchema.parse(input)
}
