// Credit policy CLI.
//
//   npm run policy -- validate policies/*.yaml
//   npm run policy -- apply policies/credrail-default.yaml --nbfc FFC
//   npm run policy -- list --nbfc FFC
//
// `apply` validates the file, stores it as a new immutable version and makes it active.

import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { PolicyValidationError, parsePolicy } from '@credrail/engine'

function usage(): never {
  console.error(`Usage:
  npm run policy -- validate <file.yaml> [more files...]
  npm run policy -- apply <file.yaml> --nbfc <NBFC code>
  npm run policy -- list --nbfc <NBFC code>`)
  process.exit(2)
}

const readDocument = (file: string): unknown => parse(readFileSync(file, 'utf8'))

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function findNbfc(code: string | undefined) {
  if (!code) usage()
  const { default: prisma } = await import('../lib/db')
  const nbfc = await prisma.nBFC.findUnique({ where: { code } })
  if (!nbfc) {
    console.error(`No NBFC with code ${code}`)
    process.exit(1)
  }
  return { prisma, nbfc }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (command === 'validate') {
    const files = args.filter(a => !a.startsWith('--'))
    if (files.length === 0) usage()
    let failed = 0
    for (const file of files) {
      try {
        const p = parsePolicy(readDocument(file))
        console.log(`✓ ${file}  (${p.id}@${p.version})`)
      } catch (e) {
        failed++
        console.error(`✗ ${file}\n${e instanceof PolicyValidationError ? e.message : String(e)}`)
      }
    }
    process.exit(failed ? 1 : 0)
  }

  if (command === 'apply') {
    const file = args.find(a => !a.startsWith('--') && a !== flag(args, '--nbfc'))
    if (!file) usage()
    const { prisma, nbfc } = await findNbfc(flag(args, '--nbfc'))
    const { applyPolicy } = await import('../lib/policy')
    const result = await applyPolicy(nbfc.id, readDocument(file))
    console.log(`${result.created ? 'Applied' : 'Re-activated'} ${result.policy.id}@${result.policy.version} for ${nbfc.name} (checksum ${result.checksum.slice(0, 12)}…)`)
    await prisma.$disconnect()
    return
  }

  if (command === 'list') {
    const { prisma, nbfc } = await findNbfc(flag(args, '--nbfc'))
    const rows = await prisma.creditPolicy.findMany({
      where: { nbfcId: nbfc.id },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { decisions: true } } },
    })
    if (rows.length === 0) console.log(`${nbfc.name} has no policies; the built-in default applies.`)
    for (const r of rows) {
      console.log(`${r.isActive ? '*' : ' '} ${r.policyKey}@${r.version}  ${r.checksum.slice(0, 12)}  ${r._count.decisions} decision(s)`)
    }
    await prisma.$disconnect()
    return
  }

  usage()
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
