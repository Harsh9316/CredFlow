// Sends due webhook deliveries (including retries). Deliveries are normally sent right after
// the request that created them; run this on a schedule (e.g. every minute) to pick up retries
// and anything interrupted by a restart:
//   npm run webhooks:dispatch            # once
//   npm run webhooks:dispatch -- --watch # loop every 30s
import prisma from '../lib/db'
import { dispatchPendingWebhooks } from '../lib/webhooks'

async function once() {
  let total = 0
  for (;;) {
    const { attempted } = await dispatchPendingWebhooks(100)
    total += attempted
    if (attempted < 100) break
  }
  console.log(`${new Date().toISOString()} attempted ${total} deliveries`)
}

async function main() {
  if (!process.argv.includes('--watch')) {
    await once()
    await prisma.$disconnect()
    return
  }
  for (;;) {
    await once().catch(e => console.error(e))
    await new Promise(r => setTimeout(r, 30_000))
  }
}

main().catch(async e => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
