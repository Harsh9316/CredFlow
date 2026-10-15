// Runs the demo seed only when the database has no NBFCs yet (used by the Docker entrypoint).
import { execFileSync } from 'node:child_process'
import prisma from '../lib/db'

async function main() {
  const count = await prisma.nBFC.count()
  await prisma.$disconnect()
  if (count > 0) {
    console.log(`Database already has ${count} NBFC(s); skipping demo seed.`)
    return
  }
  execFileSync('npx', ['tsx', 'seed.ts'], { stdio: 'inherit' })
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
