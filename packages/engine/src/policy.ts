// Credit policy schema. A policy is plain data (usually a YAML file) that fully
// determines how an application is checked, scored, sized and explained.

import { z } from 'zod'

export const COLLATERAL_TYPES = ['LAP', 'MACHINERY', 'INVOICE', 'STOCK', 'FD', 'NONE'] as const
export const RISK_BANDS = ['LOW', 'MEDIUM', 'HIGH'] as const
export const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const

const points = z.number().int().min(0)
const severity = z.enum(SEVERITIES)

// A metric is compared against each band in order; the first match wins.
// `higher-is-better` matches when value >= threshold, `lower-is-better` when value <= threshold.
const bandedComponent = z
  .object({
    max: points,
    direction: z.enum(['higher-is-better', 'lower-is-better']),
    bands: z.array(z.object({ threshold: z.number(), points })).min(1),
    otherwise: points,
  })
  .superRefine((c, ctx) => {
    for (let i = 1; i < c.bands.length; i++) {
      const prev = c.bands[i - 1].threshold
      const cur = c.bands[i].threshold
      const ordered = c.direction === 'higher-is-better' ? cur < prev : cur > prev
      if (!ordered) {
        ctx.addIssue({
          code: 'custom',
          path: ['bands', i, 'threshold'],
          message: `bands must be ordered from best to worst (${c.direction})`,
        })
      }
    }
    for (const [i, b] of c.bands.entries()) {
      if (b.points > c.max) {
        ctx.addIssue({ code: 'custom', path: ['bands', i, 'points'], message: `points exceed component max of ${c.max}` })
      }
    }
    if (c.otherwise > c.max) {
      ctx.addIssue({ code: 'custom', path: ['otherwise'], message: `points exceed component max of ${c.max}` })
    }
  })

const fraudRule = <T extends z.ZodRawShape>(params: T) =>
  z.object({ enabled: z.boolean().default(true), severity, ...params })

export const CreditPolicySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and hyphens'),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),

    decision: z.object({
      approveThreshold: z.number().min(0).max(100),
      referThreshold: z.number().min(0).max(100),
    }),

    affordability: z.object({
      // `amortized`: EMI = standard reducing-balance instalment at annualInterestRate.
      // `flat-factor`: EMI = amount / tenure and eligibility = maxEMI * tenure * flatFactor
      //  (CredFlow v0.1 behaviour, kept so old decisions can be reproduced).
      method: z.enum(['amortized', 'flat-factor']),
      annualInterestRate: z.number().min(0).max(100),
      flatFactor: z.number().positive().default(0.85),
      minEMICoverage: z.number().positive(),
      // Recommended amount for unsecured loans is cash-flow eligibility times this.
      unsecuredHaircut: z.number().min(0).max(1),
      // Secured loans may exceed the collateral cap by this multiple.
      collateralHeadroom: z.number().min(1),
    }),

    scoring: z.object({
      // Free cash flow divided by (requested amount / 12).
      cashFlow: bandedComponent,
      // Free cash flow divided by EMI.
      emiCoverage: bandedComponent,
      // Coefficient of variation of monthly inflows.
      stability: bandedComponent,
      collateral: z.object({
        max: points,
        // Collateral cap divided by requested amount.
        coverageBands: z.array(z.object({ threshold: z.number(), points })).min(1),
        otherwise: points,
        preferredTypes: z.array(z.enum(COLLATERAL_TYPES)).default([]),
        preferredTypeBonus: points.default(0),
        personalGuaranteeBonus: points.default(0),
      }),
      profile: z.object({
        max: points,
        // Business vintage in months.
        vintageBands: z.array(z.object({ threshold: z.number(), points })).min(1),
        vintageOtherwise: points,
        industryPoints: z.object({ LOW: points, MEDIUM: points, HIGH: points }),
      }),
    }),

    collateral: z.object({
      // Every collateral type must have a limit (an enum-keyed record is exhaustive).
      ltvLimits: z.record(z.enum(COLLATERAL_TYPES), z.number().min(0).max(100)),
    }),

    industries: z.object({
      riskBands: z.record(z.string(), z.enum(RISK_BANDS)),
      defaultBand: z.enum(RISK_BANDS),
    }),

    // Thresholds used only to word reasons and flags; they do not change the score.
    explanations: z.object({
      strongEMICoverage: z.number().positive(),
      stableInflowCV: z.number().min(0),
      maxInflowCV: z.number().min(0),
      establishedVintageMonths: z.number().int().min(0),
      minBusinessVintageMonths: z.number().int().min(0),
    }),

    fraud: z.object({
      // Flags at or above this severity force a REJECT recommendation.
      hardStopSeverity: severity,
      rules: z.object({
        panGstinMismatch: fraudRule({}),
        missingIdentity: fraudRule({}),
        inflowSpike: fraudRule({ multipleOfAverage: z.number().positive(), minMonths: z.number().int().min(1) }),
        turnoverBankShortfall: fraudRule({ minBankToTurnoverRatio: z.number().positive() }),
        excessiveBankFlow: fraudRule({ maxBankToTurnoverRatio: z.number().positive() }),
        newEntityLargeLoan: fraudRule({ maxVintageMonths: z.number().int().min(0), amountAbove: z.number().min(0) }),
        loanExceedsTurnover: fraudRule({}),
      }),
    }),

    bureau: z.object({
      fraudAlertModifier: z.number(),
      delinquencyModifier: z.number(),
      // First band whose minScore the bureau score meets applies.
      scoreBands: z.array(z.object({ minScore: z.number(), modifier: z.number() })),
      otherwiseModifier: z.number(),
    }),
  })
  .superRefine((p, ctx) => {
    if (p.decision.referThreshold > p.decision.approveThreshold) {
      ctx.addIssue({ code: 'custom', path: ['decision', 'referThreshold'], message: 'referThreshold must not exceed approveThreshold' })
    }
    const s = p.scoring
    const total = s.cashFlow.max + s.emiCoverage.max + s.stability.max + s.collateral.max + s.profile.max
    if (total !== 100) {
      ctx.addIssue({ code: 'custom', path: ['scoring'], message: `component max points must add up to 100 (got ${total})` })
    }
  })

export type CreditPolicy = z.output<typeof CreditPolicySchema>
export type CreditPolicyInput = z.input<typeof CreditPolicySchema>
export type CollateralType = (typeof COLLATERAL_TYPES)[number]
export type RiskBand = (typeof RISK_BANDS)[number]
export type Severity = (typeof SEVERITIES)[number]

export class PolicyValidationError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super(`Invalid credit policy:\n${issues.map(i => `  - ${i.path || '(root)'}: ${i.message}`).join('\n')}`)
    this.name = 'PolicyValidationError'
  }
}

// Validates an untrusted policy object (e.g. parsed YAML) and fills defaults.
export function parsePolicy(input: unknown): CreditPolicy {
  const result = CreditPolicySchema.safeParse(input)
  if (!result.success) {
    throw new PolicyValidationError(
      result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
    )
  }
  return result.data
}
