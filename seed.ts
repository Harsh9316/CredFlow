// Seed script for CredFlow sample data
// Run with: npx tsx seed.ts

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Demo data uses a fixed-seed PRNG so every `npm run db:seed` produces the same
// numbers, and therefore the same underwriting results.
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

const hash = (password: string) => bcrypt.hashSync(password, 12)

async function main() {
  console.log('🌱 Seeding CredFlow database...')

  // Clean existing data
  await prisma.auditLog.deleteMany()
  await prisma.approval.deleteMany()
  await prisma.creditDecision.deleteMany()
  await prisma.collateral.deleteMany()
  await prisma.loanApplication.deleteMany()
  await prisma.financialData.deleteMany()
  await prisma.borrower.deleteMany()
  await prisma.settings.deleteMany()
  await prisma.user.deleteMany()
  await prisma.nBFC.deleteMany()

  // Create NBFCs
  const nbfc1 = await prisma.nBFC.create({
    data: {
      name: 'FinFirst Capital',
      code: 'FFC',
      licenseNo: 'N-07.02891',
      address: '12th Floor, BKC Tower, Mumbai 400051'
    }
  })

  const nbfc2 = await prisma.nBFC.create({
    data: {
      name: 'SME Growth Finance',
      code: 'SGF',
      licenseNo: 'N-13.01234',
      address: '5th Floor, Cyber Hub, Gurugram 122002'
    }
  })

  console.log('✅ Created 2 NBFCs')

  // Create Users
  const admin = await prisma.user.create({
    data: {
      email: 'admin@credflow.io',
      password: hash('Admin@123'),
      name: 'Rajesh Kumar',
      role: 'ADMIN',
      nbfcId: nbfc1.id
    }
  })

  const analyst = await prisma.user.create({
    data: {
      email: 'analyst@credflow.io',
      password: hash('Analyst@123'),
      name: 'Priya Sharma',
      role: 'ANALYST',
      nbfcId: nbfc1.id
    }
  })

  const viewer = await prisma.user.create({
    data: {
      email: 'viewer@credflow.io',
      password: hash('Viewer@123'),
      name: 'Amit Patel',
      role: 'VIEWER',
      nbfcId: nbfc1.id
    }
  })

  await prisma.user.create({
    data: {
      email: 'analyst2@credflow.io',
      password: hash('Analyst@123'),
      name: 'Sunita Reddy',
      role: 'ANALYST',
      nbfcId: nbfc1.id
    }
  })

  // Second tenant, used to check that NBFCs cannot see each other's data
  await prisma.user.create({
    data: {
      email: 'admin@smegrowth.in',
      password: hash('Admin@123'),
      name: 'Kavita Menon',
      role: 'ADMIN',
      nbfcId: nbfc2.id
    }
  })

  await prisma.settings.create({
    data: {
      nbfcId: nbfc2.id,
      approveThreshold: 75,
      referThreshold: 55,
      minEMICoverage: 1.75,
      creditPolicyVersion: 'sgf-v1.0'
    }
  })

  console.log('✅ Created 5 users across 2 NBFCs')

  // Create Settings
  await prisma.settings.create({
    data: {
      nbfcId: nbfc1.id,
      approveThreshold: 70,
      referThreshold: 50,
      minEMICoverage: 1.5,
      maxInflowCV: 0.5,
      minBusinessVintage: 12,
      industryRiskBands: JSON.stringify({
        'Manufacturing': 'LOW',
        'IT Services': 'LOW',
        'Healthcare': 'LOW',
        'Retail': 'MEDIUM',
        'Construction': 'MEDIUM',
        'Agriculture': 'MEDIUM',
        'Real Estate': 'HIGH',
        'Hospitality': 'HIGH',
        'Trading': 'MEDIUM',
        'Logistics': 'MEDIUM',
        'Food Processing': 'LOW'
      }),
      ltvLimits: JSON.stringify({
        'LAP': 70,
        'MACHINERY': 60,
        'INVOICE': 80,
        'STOCK': 50,
        'FD': 90,
        'NONE': 0
      })
    }
  })

  console.log('✅ Created settings')

  // Create Borrowers
  const borrowers = await Promise.all([
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'Sharma Auto Components',
        legalName: 'Sharma Auto Components Pvt Ltd',
        pan: 'AADCS1234K',
        gstin: '27AADCS1234K1ZP',
        industry: 'Manufacturing',
        subIndustry: 'Auto Parts',
        constitution: 'Pvt Ltd',
        vintage: 84,
        annualTurnover: 45000000,
        employeeCount: 45,
        address: 'Plot 45, MIDC Industrial Area',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411057',
        contactPerson: 'Vikram Sharma',
        contactPhone: '9876543210',
        contactEmail: 'vikram@sharmaauto.com'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'TechBridge Solutions',
        legalName: 'TechBridge Solutions LLP',
        pan: 'AABFT5678L',
        gstin: '29AABFT5678L1ZQ',
        industry: 'IT Services',
        subIndustry: 'Software Development',
        constitution: 'LLP',
        vintage: 48,
        annualTurnover: 28000000,
        employeeCount: 35,
        address: '3rd Floor, Tech Park',
        city: 'Bangalore',
        state: 'Karnataka',
        pincode: '560103',
        contactPerson: 'Ananya Desai',
        contactPhone: '9876543211',
        contactEmail: 'ananya@techbridge.in'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'Fresh Harvest Agro',
        legalName: 'Fresh Harvest Agro Products',
        pan: 'AADFH9012M',
        gstin: '24AADFH9012M1ZR',
        industry: 'Agriculture',
        subIndustry: 'Food Processing',
        constitution: 'Partnership',
        vintage: 36,
        annualTurnover: 18000000,
        employeeCount: 22,
        address: 'Village Dadra, Taluka Anand',
        city: 'Anand',
        state: 'Gujarat',
        pincode: '388001',
        contactPerson: 'Mahesh Patel',
        contactPhone: '9876543212',
        contactEmail: 'mahesh@freshharvest.co.in'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'Metro Retail Mart',
        legalName: 'Metro Retail Mart Pvt Ltd',
        pan: 'AADMR3456N',
        gstin: '07AADMR3456N1ZS',
        industry: 'Retail',
        subIndustry: 'General Merchandise',
        constitution: 'Pvt Ltd',
        vintage: 60,
        annualTurnover: 72000000,
        employeeCount: 85,
        address: '12, Main Market',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
        contactPerson: 'Ravi Gupta',
        contactPhone: '9876543213',
        contactEmail: 'ravi@metromart.in'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'BuildRight Constructions',
        legalName: 'BuildRight Constructions Pvt Ltd',
        pan: 'AADBR7890P',
        gstin: '33AADBR7890P1ZT',
        industry: 'Construction',
        subIndustry: 'Residential',
        constitution: 'Pvt Ltd',
        vintage: 72,
        annualTurnover: 95000000,
        employeeCount: 120,
        address: '15, Industrial Estate',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600032',
        contactPerson: 'Suresh Iyer',
        contactPhone: '9876543214',
        contactEmail: 'suresh@buildright.com'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'HealthPlus Diagnostics',
        legalName: 'HealthPlus Diagnostics Pvt Ltd',
        pan: 'AADHP2345Q',
        gstin: '36AADHP2345Q1ZU',
        industry: 'Healthcare',
        subIndustry: 'Diagnostics',
        constitution: 'Pvt Ltd',
        vintage: 42,
        annualTurnover: 32000000,
        employeeCount: 55,
        address: 'Near Apollo Hospital',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500034',
        contactPerson: 'Dr. Lakshmi Rao',
        contactPhone: '9876543215',
        contactEmail: 'lakshmi@healthplus.in'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'Swift Logistics',
        legalName: 'Swift Logistics Services Pvt Ltd',
        pan: 'AADSL6789R',
        gstin: '19AADSL6789R1ZV',
        industry: 'Logistics',
        subIndustry: 'Freight',
        constitution: 'Pvt Ltd',
        vintage: 54,
        annualTurnover: 58000000,
        employeeCount: 150,
        address: 'Transport Nagar',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700001',
        contactPerson: 'Arun Ghosh',
        contactPhone: '9876543216',
        contactEmail: 'arun@swiftlogistics.co.in'
      }
    }),
    prisma.borrower.create({
      data: {
        nbfcId: nbfc1.id,
        businessName: 'Sunrise Textiles',
        legalName: 'Sunrise Textiles Pvt Ltd',
        pan: 'AADST0123S',
        gstin: '24AADST0123S1ZW',
        industry: 'Manufacturing',
        subIndustry: 'Textiles',
        constitution: 'Pvt Ltd',
        vintage: 96,
        annualTurnover: 82000000,
        employeeCount: 200,
        address: 'Textile Park, Ring Road',
        city: 'Surat',
        state: 'Gujarat',
        pincode: '395010',
        contactPerson: 'Hitesh Shah',
        contactPhone: '9876543217',
        contactEmail: 'hitesh@sunrisetextiles.com'
      }
    })
  ])

  console.log(`✅ Created ${borrowers.length} borrowers`)

  // Generate monthly data for financial analysis
  function generateMonthlyData(avgInflow: number, volatility: number) {
    const months = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan']
    return months.map((month) => ({
      month,
      inflow: Math.round(avgInflow * (1 + (random() - 0.5) * volatility * 2)),
      outflow: Math.round(avgInflow * 0.7 * (1 + (random() - 0.5) * 0.3))
    }))
  }

  // Create Financial Data for each borrower
  for (const borrower of borrowers) {
    const avgInflow = (borrower.annualTurnover || 30000000) / 12
    const volatility = random() * 0.4 + 0.1
    const avgExpenses = avgInflow * (0.65 + random() * 0.15)
    const fcf = avgInflow - avgExpenses

    await prisma.financialData.create({
      data: {
        borrowerId: borrower.id,
        dataType: 'BANK_STATEMENT',
        periodStart: new Date('2025-08-01'),
        periodEnd: new Date('2026-01-31'),
        totalCredits: avgInflow * 6,
        totalDebits: avgExpenses * 6,
        avgMonthlyInflow: avgInflow,
        avgMonthlyExpenses: avgExpenses,
        freeCashFlow: fcf,
        inflowVolatility: volatility,
        monthlyData: JSON.stringify(generateMonthlyData(avgInflow, volatility))
      }
    })
  }

  console.log('✅ Created financial data for all borrowers')

  // Create Loan Applications with various statuses
  const applications = await Promise.all([
    // Approved applications
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0001',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[0].id,
        requestedAmount: 5000000,
        requestedTenure: 36,
        purpose: 'Purchase of CNC machinery for production expansion',
        status: 'SANCTIONED',
        sourcePlatform: 'Direct',
        priority: 'NORMAL',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-01-15'),
        reviewedAt: new Date('2026-01-18'),
        decidedAt: new Date('2026-01-20'),
        sanctionedAt: new Date('2026-01-22')
      }
    }),
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0002',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[1].id,
        requestedAmount: 2500000,
        requestedTenure: 24,
        purpose: 'Working capital for new project delivery',
        status: 'APPROVED',
        sourcePlatform: 'ERP',
        priority: 'HIGH',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-01-20'),
        reviewedAt: new Date('2026-01-22'),
        decidedAt: new Date('2026-01-25')
      }
    }),
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0003',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[7].id,
        requestedAmount: 8000000,
        requestedTenure: 48,
        purpose: 'Modernization of weaving units',
        status: 'SANCTIONED',
        sourcePlatform: 'Direct',
        priority: 'NORMAL',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-01-10'),
        reviewedAt: new Date('2026-01-14'),
        decidedAt: new Date('2026-01-18'),
        sanctionedAt: new Date('2026-01-20')
      }
    }),
    
    // Under Review applications
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0004',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[2].id,
        requestedAmount: 1500000,
        requestedTenure: 18,
        purpose: 'Cold storage facility construction',
        status: 'UNDER_REVIEW',
        sourcePlatform: 'POS',
        priority: 'NORMAL',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-02-05'),
        reviewedAt: new Date('2026-02-07')
      }
    }),
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0005',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[3].id,
        requestedAmount: 10000000,
        requestedTenure: 36,
        purpose: 'New retail outlet expansion in tier-2 cities',
        status: 'UNDER_REVIEW',
        sourcePlatform: 'Direct',
        priority: 'HIGH',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-02-06'),
        reviewedAt: new Date('2026-02-08')
      }
    }),
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0006',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[5].id,
        requestedAmount: 3500000,
        requestedTenure: 24,
        purpose: 'Purchase of advanced diagnostic equipment',
        status: 'UNDER_REVIEW',
        sourcePlatform: 'ERP',
        priority: 'URGENT',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-02-07')
      }
    }),

    // Applied (new) applications
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0007',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[4].id,
        requestedAmount: 15000000,
        requestedTenure: 48,
        purpose: 'Construction equipment purchase',
        status: 'APPLIED',
        sourcePlatform: 'Direct',
        priority: 'NORMAL',
        appliedAt: new Date('2026-02-08')
      }
    }),
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0008',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[6].id,
        requestedAmount: 6000000,
        requestedTenure: 36,
        purpose: 'Fleet expansion - 10 new trucks',
        status: 'APPLIED',
        sourcePlatform: 'POS',
        priority: 'HIGH',
        appliedAt: new Date('2026-02-08')
      }
    }),

    // Rejected application
    prisma.loanApplication.create({
      data: {
        applicationNo: 'FFC-2026-0009',
        nbfcId: nbfc1.id,
        borrowerId: borrowers[2].id,
        requestedAmount: 5000000,
        requestedTenure: 24,
        purpose: 'Land acquisition for new processing unit',
        status: 'REJECTED',
        sourcePlatform: 'Direct',
        priority: 'NORMAL',
        assignedTo: analyst.id,
        appliedAt: new Date('2026-01-08'),
        reviewedAt: new Date('2026-01-12'),
        decidedAt: new Date('2026-01-15')
      }
    })
  ])

  console.log(`✅ Created ${applications.length} loan applications`)

  // Create Collateral for some applications
  await prisma.collateral.create({
    data: {
      applicationId: applications[0].id,
      collateralType: 'MACHINERY',
      description: 'Existing CNC machines and manufacturing equipment',
      assessedValue: 3500000,
      ltv: 60,
      collateralCap: 2100000,
      hasPersonalGuarantee: true,
      guarantorName: 'Vikram Sharma',
      guarantorRelation: 'Director',
      valuationDate: new Date('2026-01-17'),
      valuationAgency: 'ValueFirst Appraisals'
    }
  })

  await prisma.collateral.create({
    data: {
      applicationId: applications[1].id,
      collateralType: 'INVOICE',
      description: 'Outstanding invoices from Fortune 500 clients',
      assessedValue: 3200000,
      ltv: 80,
      collateralCap: 2560000,
      hasPersonalGuarantee: false
    }
  })

  await prisma.collateral.create({
    data: {
      applicationId: applications[2].id,
      collateralType: 'LAP',
      description: 'Industrial property at Textile Park, Surat',
      assessedValue: 15000000,
      ltv: 70,
      collateralCap: 10500000,
      hasPersonalGuarantee: true,
      guarantorName: 'Hitesh Shah',
      guarantorRelation: 'Promoter',
      valuationDate: new Date('2026-01-12'),
      valuationAgency: 'CRISIL Valuations'
    }
  })

  await prisma.collateral.create({
    data: {
      applicationId: applications[3].id,
      collateralType: 'STOCK',
      description: 'Agricultural produce inventory',
      assessedValue: 1200000,
      ltv: 50,
      collateralCap: 600000,
      hasPersonalGuarantee: true,
      guarantorName: 'Mahesh Patel',
      guarantorRelation: 'Partner'
    }
  })

  await prisma.collateral.create({
    data: {
      applicationId: applications[4].id,
      collateralType: 'LAP',
      description: 'Commercial property - existing retail outlets',
      assessedValue: 18000000,
      ltv: 65,
      collateralCap: 11700000,
      hasPersonalGuarantee: true,
      guarantorName: 'Ravi Gupta',
      guarantorRelation: 'Director'
    }
  })

  console.log('✅ Created collateral records')

  // Create Credit Decisions
  await prisma.creditDecision.create({
    data: {
      applicationId: applications[0].id,
      creditScore: 78,
      decision: 'APPROVE',
      cashFlowEligible: 5800000,
      collateralEligible: 2100000,
      finalRecommendedAmt: 5000000,
      scoreBreakdown: JSON.stringify({
        cashFlowScore: 25,
        coverageScore: 22,
        stabilityScore: 16,
        collateralScore: 10,
        profileScore: 5,
        total: 78
      }),
      approvalReasons: JSON.stringify([
        'Strong EMI coverage ratio (≥2x)',
        'Positive free cash flow (₹3.1L/month)',
        'Established business with 7+ years vintage',
        'Secured by MACHINERY worth ₹35L',
        'Low-risk industry: Manufacturing'
      ]),
      riskFlags: JSON.stringify([]),
      recommendations: JSON.stringify([
        'Standard documentation requirements apply'
      ])
    }
  })

  await prisma.creditDecision.create({
    data: {
      applicationId: applications[1].id,
      creditScore: 82,
      decision: 'APPROVE',
      cashFlowEligible: 3200000,
      collateralEligible: 2560000,
      finalRecommendedAmt: 2500000,
      scoreBreakdown: JSON.stringify({
        cashFlowScore: 28,
        coverageScore: 23,
        stabilityScore: 17,
        collateralScore: 9,
        profileScore: 5,
        total: 82
      }),
      approvalReasons: JSON.stringify([
        'Strong EMI coverage ratio (≥2x)',
        'Positive free cash flow (₹2.3L/month)',
        'Stable cash inflows with low volatility',
        'Invoice-backed facility with 80% LTV',
        'Low-risk industry: IT Services'
      ]),
      riskFlags: JSON.stringify([]),
      recommendations: JSON.stringify([])
    }
  })

  await prisma.creditDecision.create({
    data: {
      applicationId: applications[8].id,
      creditScore: 42,
      decision: 'REJECT',
      cashFlowEligible: 1800000,
      collateralEligible: 0,
      finalRecommendedAmt: 0,
      scoreBreakdown: JSON.stringify({
        cashFlowScore: 12,
        coverageScore: 10,
        stabilityScore: 8,
        collateralScore: 0,
        profileScore: 12,
        total: 42
      }),
      approvalReasons: JSON.stringify([]),
      riskFlags: JSON.stringify([
        'Low EMI coverage ratio (0.8x)',
        'High inflow volatility (CV: 45%)',
        'Unsecured exposure - no collateral provided',
        'Requested amount significantly exceeds cash flow eligibility'
      ]),
      recommendations: JSON.stringify([
        'Recommend reapplication with collateral security',
        'Consider reducing loan amount to ₹15L based on cash flow'
      ])
    }
  })

  console.log('✅ Created credit decisions')

  // Create Approvals
  await prisma.approval.create({
    data: {
      applicationId: applications[0].id,
      approvedBy: admin.id,
      finalDecision: 'APPROVE',
      overrideSystem: false,
      sanctionedAmount: 5000000,
      sanctionedTenure: 36,
      interestRate: 14.5,
      processingFee: 50000,
      conditions: JSON.stringify([
        'Hypothecation of machinery to be completed before disbursement',
        'Personal guarantee of director to be executed',
        'Insurance on machinery for loan tenure'
      ])
    }
  })

  await prisma.approval.create({
    data: {
      applicationId: applications[2].id,
      approvedBy: admin.id,
      finalDecision: 'APPROVE',
      overrideSystem: false,
      sanctionedAmount: 8000000,
      sanctionedTenure: 48,
      interestRate: 13.75,
      processingFee: 80000,
      conditions: JSON.stringify([
        'Equitable mortgage of property to be registered',
        'Personal guarantee of promoter',
        'Quarterly stock statements required'
      ])
    }
  })

  console.log('✅ Created approvals')

  // Create Audit Logs
  const auditActions = [
    { applicationId: applications[0].id, userId: analyst.id, action: 'APPLICATION_RECEIVED', details: 'New loan application received' },
    { applicationId: applications[0].id, userId: analyst.id, action: 'STATUS_CHANGE', details: 'Status changed to UNDER_REVIEW' },
    { applicationId: applications[0].id, userId: analyst.id, action: 'FINANCIAL_ANALYSIS', details: 'Financial analysis completed' },
    { applicationId: applications[0].id, userId: analyst.id, action: 'COLLATERAL_ADDED', details: 'Collateral details captured' },
    { applicationId: applications[0].id, userId: analyst.id, action: 'DECISION_GENERATED', details: 'Credit decision generated - Score: 78' },
    { applicationId: applications[0].id, userId: admin.id, action: 'APPROVED', details: 'Application approved by NBFC Admin' },
    { applicationId: applications[0].id, userId: admin.id, action: 'SANCTIONED', details: 'Loan sanctioned for ₹50L @ 14.5% p.a.' },
  ]

  for (const log of auditActions) {
    await prisma.auditLog.create({
      data: {
        applicationId: log.applicationId,
        userId: log.userId,
        action: log.action,
        details: JSON.stringify({ message: log.details }),
        timestamp: new Date()
      }
    })
  }

  console.log('✅ Created audit logs')

  console.log('\n🎉 Seeding completed successfully!')
  console.log('\nDemo Credentials:')
  console.log('  Admin:   admin@credflow.io / Admin@123')
  console.log('  Analyst: analyst@credflow.io / Analyst@123')
  console.log('  Viewer:  viewer@credflow.io / Viewer@123')
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
