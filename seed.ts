// Demo data for Credrail. Wipes the database, then creates two NBFCs, their users and
// policies, and a realistic book of applications.
//
// Every application is evaluated by the real engine under its NBFC's policy, so scores,
// reasons and recommended amounts are exactly what the product would produce. Dates are
// relative to today, and maker-checker and audit records follow the policy's rules.
//
// Run with: npm run db:seed   (never against a production database)

import { readFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'
import { parse } from 'yaml'
import {
  checkerRequirements,
  evaluateApplication,
  type ApplicationInput,
  type CollateralType,
  type CreditPolicy,
  type MonthlyFlow,
} from '@credrail/engine'
import prisma from './lib/db'
import { applyPolicy, getActivePolicy } from './lib/policy'

const readPolicy = (file: string) => parse(readFileSync(`policies/${file}`, 'utf8'))
const hash = (password: string) => bcrypt.hashSync(password, 12)

// Fixed-seed PRNG: every run produces the same numbers and therefore the same decisions
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(20260101)

const DAY = 86_400_000
const daysAgo = (d: number, hour = 11) => {
  const t = new Date(Date.now() - d * DAY)
  t.setHours(hour, Math.floor(random() * 60), 0, 0)
  return t
}
const later = (from: Date, days: number, hour = 15) => {
  const t = new Date(from.getTime() + days * DAY)
  t.setHours(hour, Math.floor(random() * 60), 0, 0)
  return t
}

type Outcome = 'APPLIED' | 'EVALUATED' | 'REFERRED' | 'SANCTIONED' | 'PENDING_CHECKER' | 'REJECTED'

type Scenario = {
  name: string
  legal: string
  pan: string
  /** GSTIN state code; the GSTIN is built from the PAN unless `gstinOverride` is set */
  state: [code: string, name: string]
  city: string
  industry: string
  constitution: string
  vintage: number
  turnover: number
  contact: [name: string, phone: string, email: string]
  amount: number
  tenure: number
  purpose: string
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  /** Monthly inflow as a share of turnover/12, expense ratio, and inflow volatility */
  inflowRatio?: number
  expenseRatio: number
  cv: number
  collateral?: { type: CollateralType; value: number; ltv: number; guarantor?: [string, string] }
  outcome: Outcome
  appliedDaysAgo: number
  sanctionShare?: number
  rate?: number
  overrideReason?: string
  gstinOverride?: string
  source?: string
}

const gstinFor = (stateCode: string, pan: string) => `${stateCode}${pan}1Z${'0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[pan.charCodeAt(9) % 34]}`

function monthlyFlows(avgInflow: number, avgOutflow: number, cv: number, endDate: Date): MonthlyFlow[] {
  const months: MonthlyFlow[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(endDate)
    d.setDate(1)
    d.setMonth(d.getMonth() - i - 1)
    const swing = (random() - 0.5) * 2 * cv * 1.6
    months.push({
      month: d.toLocaleString('en-IN', { month: 'short' }),
      inflow: Math.round(avgInflow * (1 + swing)),
      outflow: Math.round(avgOutflow * (1 + (random() - 0.5) * 0.2)),
    })
  }
  return months
}

const FFC: Scenario[] = [
  { name: 'Sharma Auto Components', legal: 'Sharma Auto Components Pvt Ltd', pan: 'AADCS1234K', state: ['27', 'Maharashtra'], city: 'Pune', industry: 'Manufacturing', constitution: 'Pvt Ltd', vintage: 96, turnover: 5_40_00_000, contact: ['Rakesh Sharma', '98220 41187', 'rakesh@sharmaauto.in'], amount: 75_00_000, tenure: 48, purpose: 'CNC machining line', expenseRatio: 0.72, cv: 0.12, collateral: { type: 'MACHINERY', value: 1_30_00_000, ltv: 60, guarantor: ['Rakesh Sharma', 'Managing Director'] }, outcome: 'SANCTIONED', appliedDaysAgo: 82, rate: 13.5 },
  { name: 'TechBridge Solutions', legal: 'TechBridge Solutions LLP', pan: 'AAQFT5521M', state: ['29', 'Karnataka'], city: 'Bengaluru', industry: 'IT Services', constitution: 'LLP', vintage: 64, turnover: 3_60_00_000, contact: ['Anita Rao', '99000 21456', 'anita@techbridge.io'], amount: 25_00_000, tenure: 24, purpose: 'Working capital for new contracts', expenseRatio: 0.7, cv: 0.14, collateral: { type: 'INVOICE', value: 42_00_000, ltv: 80 }, outcome: 'SANCTIONED', appliedDaysAgo: 74, rate: 14.5 },
  { name: 'HealthPlus Diagnostics', legal: 'HealthPlus Diagnostics Pvt Ltd', pan: 'AAFCH7712Q', state: ['36', 'Telangana'], city: 'Hyderabad', industry: 'Healthcare', constitution: 'Pvt Ltd', vintage: 58, turnover: 4_20_00_000, contact: ['Dr. Kiran Reddy', '98490 33221', 'kiran@healthplus.in'], amount: 55_00_000, tenure: 48, purpose: 'MRI scanner', expenseRatio: 0.7, cv: 0.1, collateral: { type: 'MACHINERY', value: 95_00_000, ltv: 60 }, outcome: 'SANCTIONED', appliedDaysAgo: 66, rate: 13.75 },
  { name: 'Annapurna Foods', legal: 'Annapurna Foods Pvt Ltd', pan: 'AAKCA3390F', state: ['24', 'Gujarat'], city: 'Ahmedabad', industry: 'Food Processing', constitution: 'Pvt Ltd', vintage: 120, turnover: 6_00_00_000, contact: ['Mehul Patel', '98250 77410', 'mehul@annapurnafoods.in'], amount: 60_00_000, tenure: 60, purpose: 'Cold storage expansion', expenseRatio: 0.75, cv: 0.13, collateral: { type: 'LAP', value: 1_40_00_000, ltv: 65 }, outcome: 'SANCTIONED', appliedDaysAgo: 58, rate: 12.75 },
  { name: 'Coastal Logistics', legal: 'Coastal Logistics Partners', pan: 'AAHFC6612D', state: ['33', 'Tamil Nadu'], city: 'Chennai', industry: 'Logistics', constitution: 'Partnership', vintage: 72, turnover: 3_80_00_000, contact: ['S. Venkatesh', '98400 55190', 'venkat@coastallogistics.in'], amount: 45_00_000, tenure: 36, purpose: 'Fleet of 6 reefer trucks', expenseRatio: 0.7, cv: 0.16, collateral: { type: 'MACHINERY', value: 72_00_000, ltv: 60 }, outcome: 'SANCTIONED', appliedDaysAgo: 49, rate: 14 },
  { name: 'Sunrise Textiles', legal: 'Sunrise Textiles Pvt Ltd', pan: 'AAGCS8821P', state: ['24', 'Gujarat'], city: 'Surat', industry: 'Textiles', constitution: 'Pvt Ltd', vintage: 84, turnover: 4_80_00_000, contact: ['Nikhil Desai', '98980 12345', 'nikhil@sunrisetex.in'], amount: 50_00_000, tenure: 48, purpose: 'Looms upgrade', expenseRatio: 0.74, cv: 0.15, collateral: { type: 'LAP', value: 1_10_00_000, ltv: 65 }, outcome: 'SANCTIONED', appliedDaysAgo: 41, rate: 13.25 },
  { name: 'Greenleaf Pharma', legal: 'Greenleaf Pharma Pvt Ltd', pan: 'AAJCG4410H', state: ['06', 'Haryana'], city: 'Gurugram', industry: 'Pharmaceuticals', constitution: 'Pvt Ltd', vintage: 54, turnover: 2_60_00_000, contact: ['Pooja Malhotra', '98110 66520', 'pooja@greenleafpharma.in'], amount: 20_00_000, tenure: 24, purpose: 'Raw material stocking', expenseRatio: 0.68, cv: 0.11, collateral: { type: 'FD', value: 30_00_000, ltv: 90 }, outcome: 'SANCTIONED', appliedDaysAgo: 33, rate: 12.5 },
  { name: 'Shakti Auto Components', legal: 'Shakti Auto Components Pvt Ltd', pan: 'AAGCS4321K', state: ['27', 'Maharashtra'], city: 'Nashik', industry: 'Manufacturing', constitution: 'Pvt Ltd', vintage: 84, turnover: 1_68_00_000, contact: ['R. Iyer', '98111 11111', 'iyer@shaktiauto.in'], amount: 40_00_000, tenure: 36, purpose: 'Press shop expansion', expenseRatio: 0.5, cv: 0.12, collateral: { type: 'LAP', value: 80_00_000, ltv: 60, guarantor: ['R. Iyer', 'Director'] }, outcome: 'PENDING_CHECKER', appliedDaysAgo: 6, source: 'API' },
  { name: 'Metro Retail Mart', legal: 'Metro Retail Mart Pvt Ltd', pan: 'AADCM3456N', state: ['07', 'Delhi'], city: 'New Delhi', industry: 'Retail', constitution: 'Pvt Ltd', vintage: 60, turnover: 7_20_00_000, contact: ['Ravi Gupta', '98765 43213', 'ravi@metromart.in'], amount: 1_00_00_000, tenure: 36, purpose: 'Two new outlets', priority: 'HIGH', expenseRatio: 0.88, cv: 0.32, collateral: { type: 'LAP', value: 1_20_00_000, ltv: 65 }, outcome: 'EVALUATED', appliedDaysAgo: 4 },
  { name: 'Fresh Harvest Agro', legal: 'Fresh Harvest Agro Producer Co', pan: 'AAFCF2290B', state: ['24', 'Gujarat'], city: 'Anand', industry: 'Agriculture', constitution: 'Pvt Ltd', vintage: 30, turnover: 1_80_00_000, contact: ['Jignesh Patel', '97250 10021', 'jignesh@freshharvest.in'], amount: 15_00_000, tenure: 18, purpose: 'Seasonal procurement', expenseRatio: 0.9, cv: 0.42, collateral: { type: 'STOCK', value: 22_00_000, ltv: 50 }, outcome: 'REFERRED', appliedDaysAgo: 11 },
  { name: 'BuildRight Constructions', legal: 'BuildRight Constructions Pvt Ltd', pan: 'AABCB7781L', state: ['33', 'Tamil Nadu'], city: 'Coimbatore', industry: 'Construction', constitution: 'Pvt Ltd', vintage: 108, turnover: 9_50_00_000, contact: ['K. Murugan', '98430 22107', 'murugan@buildright.in'], amount: 1_50_00_000, tenure: 48, purpose: 'Equipment for metro contract', priority: 'URGENT', expenseRatio: 0.85, cv: 0.3, outcome: 'APPLIED', appliedDaysAgo: 2 },
  { name: 'Swift Logistics', legal: 'Swift Logistics Pvt Ltd', pan: 'AAMCS5512E', state: ['19', 'West Bengal'], city: 'Kolkata', industry: 'Logistics', constitution: 'Pvt Ltd', vintage: 42, turnover: 5_80_00_000, contact: ['Arjun Sen', '98300 41122', 'arjun@swiftlogistics.in'], amount: 60_00_000, tenure: 36, purpose: 'Warehouse fit-out', expenseRatio: 0.8, cv: 0.2, outcome: 'APPLIED', appliedDaysAgo: 1, source: 'API' },
  { name: 'Royal Banquets', legal: 'Royal Banquets & Hospitality', pan: 'AAKFR9902C', state: ['08', 'Rajasthan'], city: 'Jaipur', industry: 'Hospitality', constitution: 'Partnership', vintage: 20, turnover: 1_40_00_000, contact: ['Vikram Singh', '94140 55601', 'vikram@royalbanquets.in'], amount: 50_00_000, tenure: 36, purpose: 'Renovation', expenseRatio: 0.95, cv: 0.55, outcome: 'REJECTED', appliedDaysAgo: 37 },
  { name: 'Prime Traders', legal: 'Prime Traders', pan: 'ABCPT4411R', state: ['09', 'Uttar Pradesh'], city: 'Lucknow', industry: 'Trading', constitution: 'Proprietorship', vintage: 26, turnover: 2_20_00_000, contact: ['Sanjay Verma', '98390 77810', 'sanjay@primetraders.in'], amount: 30_00_000, tenure: 24, purpose: 'Inventory', expenseRatio: 0.8, cv: 0.22, outcome: 'REJECTED', appliedDaysAgo: 19, gstinOverride: '09AXZPT9911Q1Z2' },
]

const SGF: Scenario[] = [
  { name: 'Kaveri Electricals', legal: 'Kaveri Electricals Pvt Ltd', pan: 'AAHCK3321J', state: ['29', 'Karnataka'], city: 'Mysuru', industry: 'Manufacturing', constitution: 'Pvt Ltd', vintage: 78, turnover: 2_40_00_000, contact: ['Suresh Gowda', '98450 33190', 'suresh@kaverielec.in'], amount: 10_00_000, tenure: 18, purpose: 'Working capital line', expenseRatio: 0.7, cv: 0.12, outcome: 'SANCTIONED', appliedDaysAgo: 28, rate: 18 },
  { name: 'Urban Threads', legal: 'Urban Threads', pan: 'ABDPU6612L', state: ['27', 'Maharashtra'], city: 'Mumbai', industry: 'Retail', constitution: 'Proprietorship', vintage: 30, turnover: 1_10_00_000, contact: ['Farah Shaikh', '98200 99120', 'farah@urbanthreads.in'], amount: 8_00_000, tenure: 12, purpose: 'Festive season stock', expenseRatio: 0.84, cv: 0.3, outcome: 'EVALUATED', appliedDaysAgo: 3 },
]

async function seedApplications(
  nbfc: { id: string; code: string },
  scenarios: Scenario[],
  policy: CreditPolicy,
  policyId: string,
  users: { maker: string; checker: string }
) {
  // Oldest first, so application numbers follow the order they arrived in
  const ordered = [...scenarios].sort((a, b) => b.appliedDaysAgo - a.appliedDaysAgo)
  let seq = 0
  const tally: Record<string, string> = {}

  for (const s of ordered) {
    seq++
    const appliedAt = daysAgo(s.appliedDaysAgo, 10)
    const gstin = s.gstinOverride ?? gstinFor(s.state[0], s.pan)
    const avgInflow = Math.round((s.turnover / 12) * (s.inflowRatio ?? 1))
    const avgOutflow = Math.round(avgInflow * s.expenseRatio)
    const monthly = monthlyFlows(avgInflow, avgOutflow, s.cv, appliedAt)

    const borrower = await prisma.borrower.create({
      data: {
        nbfcId: nbfc.id,
        businessName: s.name,
        legalName: s.legal,
        pan: s.pan,
        gstin,
        industry: s.industry,
        constitution: s.constitution,
        vintage: s.vintage,
        annualTurnover: s.turnover,
        city: s.city,
        state: s.state[1],
        contactPerson: s.contact[0],
        contactPhone: s.contact[1],
        contactEmail: s.contact[2],
        createdAt: appliedAt,
      },
    })

    await prisma.financialData.create({
      data: {
        borrowerId: borrower.id,
        dataType: 'BANK_STATEMENT',
        periodStart: new Date(appliedAt.getTime() - 180 * DAY),
        periodEnd: appliedAt,
        avgMonthlyInflow: avgInflow,
        avgMonthlyExpenses: avgOutflow,
        freeCashFlow: avgInflow - avgOutflow,
        inflowVolatility: s.cv,
        totalCredits: avgInflow * 6,
        totalDebits: avgOutflow * 6,
        monthlyData: JSON.stringify(monthly),
      },
    })

    const evaluated = s.outcome !== 'APPLIED'
    const reviewedAt = later(appliedAt, 1, 12)
    const decidedAt = later(appliedAt, 2 + Math.floor(random() * 3), 16)
    const checkedAt = later(decidedAt, 1, 11)

    const input: ApplicationInput = {
      requestedAmount: s.amount,
      requestedTenure: s.tenure,
      borrower: { pan: s.pan, gstin, vintage: s.vintage, industry: s.industry, annualTurnover: s.turnover },
      financial: { avgMonthlyInflow: avgInflow, avgMonthlyExpenses: avgOutflow, freeCashFlow: avgInflow - avgOutflow, inflowVolatility: s.cv, monthlyData: monthly },
      collateral: s.collateral ? { type: s.collateral.type, assessedValue: s.collateral.value, ltv: s.collateral.ltv, hasPersonalGuarantee: !!s.collateral.guarantor } : null,
      bureau: null,
    }
    const result = evaluateApplication(input, policy)

    // Statuses follow from the outcome; sanctions only for engine approvals (or an explicit override)
    const sanctionAmount = Math.min(s.amount, Math.round((result.finalRecommendedAmt * (s.sanctionShare ?? 1)) / 10_000) * 10_000)
    const isOverride = (s.outcome === 'SANCTIONED' || s.outcome === 'PENDING_CHECKER') && result.decision !== 'APPROVE'
    const checkerReasons = checkerRequirements(policy, { sanctionedAmount: sanctionAmount, isOverride })
    const status = {
      APPLIED: 'APPLIED',
      EVALUATED: 'UNDER_REVIEW',
      REFERRED: 'UNDER_REVIEW',
      PENDING_CHECKER: 'PENDING_APPROVAL',
      SANCTIONED: 'SANCTIONED',
      REJECTED: 'REJECTED',
    }[s.outcome]
    tally[s.name] = `${s.outcome} · engine ${result.decision} ${result.creditScore} · rec ${result.finalRecommendedAmt} · fraud ${result.fraud.riskLevel}`

    const app = await prisma.loanApplication.create({
      data: {
        applicationNo: `${nbfc.code}-${appliedAt.getFullYear()}-${String(seq).padStart(4, '0')}`,
        nbfcId: nbfc.id,
        borrowerId: borrower.id,
        requestedAmount: s.amount,
        requestedTenure: s.tenure,
        purpose: s.purpose,
        priority: s.priority ?? 'NORMAL',
        sourcePlatform: s.source ?? 'Direct',
        status,
        appliedAt,
        createdAt: appliedAt,
        reviewedAt: evaluated ? reviewedAt : null,
        decidedAt: ['SANCTIONED', 'REJECTED'].includes(s.outcome) ? (s.outcome === 'SANCTIONED' && checkerReasons.length ? checkedAt : decidedAt) : null,
        sanctionedAt: s.outcome === 'SANCTIONED' ? (checkerReasons.length ? checkedAt : decidedAt) : null,
      },
    })

    if (s.collateral) {
      await prisma.collateral.create({
        data: {
          applicationId: app.id,
          collateralType: s.collateral.type,
          assessedValue: s.collateral.value,
          ltv: s.collateral.ltv,
          collateralCap: Math.round((s.collateral.value * s.collateral.ltv) / 100),
          hasPersonalGuarantee: !!s.collateral.guarantor,
          guarantorName: s.collateral.guarantor?.[0] ?? null,
          guarantorRelation: s.collateral.guarantor?.[1] ?? null,
          valuationDate: appliedAt,
        },
      })
    }

    const audit: { action: string; userId: string; timestamp: Date; details: Record<string, unknown> }[] = [
      { action: 'APPLICATION_CREATED', userId: users.maker, timestamp: appliedAt, details: { applicationNo: app.applicationNo, requestedAmount: s.amount, requestedTenure: s.tenure } },
    ]

    if (evaluated) {
      await prisma.creditDecision.create({
        data: {
          applicationId: app.id,
          creditScore: result.creditScore,
          decision: result.decision,
          cashFlowEligible: result.cashFlowEligible,
          collateralEligible: result.collateralEligible,
          finalRecommendedAmt: result.finalRecommendedAmt,
          scoreBreakdown: JSON.stringify(result.scoreBreakdown),
          approvalReasons: JSON.stringify(result.approvalReasons),
          riskFlags: JSON.stringify(result.riskFlags),
          recommendations: JSON.stringify(result.recommendations),
          calculationInputs: JSON.stringify({
            ...input,
            emi: result.emi,
            emiCoverageRatio: result.emiCoverageRatio,
            creditPolicyVersion: `${policy.id}@${policy.version}`,
            connectors: {},
            fraudPreCheck: { riskLevel: result.fraud.riskLevel, passed: result.fraud.passed, flagCount: result.fraud.flags.length, summary: result.fraud.summary },
            bureauOverlay: { available: false, modifier: 0 },
          }),
          policyId,
          generatedAt: reviewedAt,
          createdAt: reviewedAt,
        },
      })
      audit.push({
        action: result.fraud.riskLevel === 'HIGH_RISK' ? 'FRAUD_FLAG_RAISED' : 'RECOMMENDATION_GENERATED',
        userId: users.maker,
        timestamp: reviewedAt,
        details: { creditScore: result.creditScore, decision: result.decision, recommendedAmount: result.finalRecommendedAmt, policy: `${policy.id}@${policy.version}` },
      })
    }

    if (s.outcome === 'REFERRED') {
      audit.push({ action: 'REFERRED_FOR_REVIEW', userId: users.maker, timestamp: decidedAt, details: { overrideReason: 'Volatile seasonal inflows; requesting 12 months of statements' } })
    }

    if (s.outcome === 'REJECTED') {
      await prisma.approval.create({
        data: { applicationId: app.id, approvedBy: users.maker, finalDecision: 'REJECT', status: 'CONFIRMED', approvedAt: decidedAt },
      })
      audit.push({ action: 'APPLICATION_REJECTED', userId: users.maker, timestamp: decidedAt, details: {} })
    }

    if (s.outcome === 'SANCTIONED' || s.outcome === 'PENDING_CHECKER') {
      const needsChecker = checkerReasons.length > 0
      const confirmed = s.outcome === 'SANCTIONED'
      await prisma.approval.create({
        data: {
          applicationId: app.id,
          approvedBy: users.maker,
          finalDecision: 'APPROVE',
          status: needsChecker && !confirmed ? 'PENDING_CHECKER' : 'CONFIRMED',
          checkerReasons: needsChecker ? checkerReasons : undefined,
          checkedBy: needsChecker && confirmed ? users.checker : null,
          checkedAt: needsChecker && confirmed ? checkedAt : null,
          checkerRemarks: needsChecker && confirmed ? 'Terms verified against appraisal note' : null,
          overrideSystem: isOverride,
          overrideReason: isOverride ? s.overrideReason ?? 'Relationship history' : null,
          sanctionedAmount: sanctionAmount,
          sanctionedTenure: s.tenure,
          interestRate: s.rate ?? policy.affordability.annualInterestRate,
          processingFee: 1.5,
          approvedAt: decidedAt,
        },
      })
      audit.push({
        action: needsChecker ? 'SANCTION_SUBMITTED_FOR_CHECK' : 'APPLICATION_APPROVED',
        userId: users.maker,
        timestamp: decidedAt,
        details: { sanctionedAmount: sanctionAmount, checkerReasons },
      })
      if (needsChecker && confirmed) {
        audit.push({ action: 'SANCTION_CONFIRMED_BY_CHECKER', userId: users.checker, timestamp: checkedAt, details: { remarks: 'Terms verified against appraisal note' } })
      }
    }

    await prisma.auditLog.createMany({
      data: audit.map(a => ({ applicationId: app.id, userId: a.userId, action: a.action, timestamp: a.timestamp, details: JSON.stringify(a.details) })),
    })
  }

  await prisma.nBFC.update({ where: { id: nbfc.id }, data: { applicationSeq: seq } })
  return tally
}

async function main() {
  console.log('🌱 Seeding Credrail database...')

  // Wipe all data. TRUNCATE (not DELETE) because the audit log is append-only.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(', ')} CASCADE`)
  }

  const ffc = await prisma.nBFC.create({
    data: { name: 'FinFirst Capital', code: 'FFC', licenseNo: 'N-07.02891', address: '12th Floor, BKC Tower, Mumbai 400051' },
  })
  const sgf = await prisma.nBFC.create({
    data: { name: 'SME Growth Finance', code: 'SGF', licenseNo: 'N-13.01234', address: '5th Floor, Cyber Hub, Gurugram 122002' },
  })

  const [admin, analyst] = await Promise.all([
    prisma.user.create({ data: { email: 'admin@credrail.dev', password: hash('Admin@123'), name: 'Rajesh Kumar', role: 'ADMIN', nbfcId: ffc.id } }),
    prisma.user.create({ data: { email: 'analyst@credrail.dev', password: hash('Analyst@123'), name: 'Priya Sharma', role: 'ANALYST', nbfcId: ffc.id } }),
    prisma.user.create({ data: { email: 'viewer@credrail.dev', password: hash('Viewer@123'), name: 'Amit Patel', role: 'VIEWER', nbfcId: ffc.id } }),
    prisma.user.create({ data: { email: 'analyst2@credrail.dev', password: hash('Analyst@123'), name: 'Sunita Reddy', role: 'ANALYST', nbfcId: ffc.id } }),
  ])
  const sgfAdmin = await prisma.user.create({
    data: { email: 'admin@smegrowth.in', password: hash('Admin@123'), name: 'Kavita Menon', role: 'ADMIN', nbfcId: sgf.id },
  })
  console.log('✅ Created 2 NBFCs and 5 users')

  // Credit policies, from the versioned YAML files in policies/
  await applyPolicy(ffc.id, readPolicy('credrail-default.yaml'))
  await applyPolicy(sgf.id, readPolicy('unsecured-working-capital.yaml'))
  const ffcPolicy = await getActivePolicy(ffc.id)
  const sgfPolicy = await getActivePolicy(sgf.id)
  console.log('✅ Applied credit policies')

  const ffcTally = await seedApplications(ffc, FFC, ffcPolicy.policy, ffcPolicy.policyId!, { maker: analyst.id, checker: admin.id })
  const sgfTally = await seedApplications(sgf, SGF, sgfPolicy.policy, sgfPolicy.policyId!, { maker: sgfAdmin.id, checker: sgfAdmin.id })
  console.log(`✅ Created ${FFC.length + SGF.length} applications, each evaluated by the engine`)
  if (process.env.SEED_VERBOSE) console.log({ ffcTally, sgfTally })

  console.log('\n🎉 Seeding completed successfully!')
  console.log('\nDemo Credentials:')
  console.log('  Admin:   admin@credrail.dev / Admin@123')
  console.log('  Analyst: analyst@credrail.dev / Analyst@123')
  console.log('  Viewer:  viewer@credrail.dev / Viewer@123')
  console.log('  Second NBFC admin: admin@smegrowth.in / Admin@123')
}

main()
  .catch(e => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
