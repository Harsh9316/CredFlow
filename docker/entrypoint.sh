#!/bin/sh
set -e

# Generate and persist a session secret if none was provided, so a demo
# starts with one command and sessions survive container restarts.
if [ -z "$SESSION_SECRET" ]; then
  if [ ! -f /data/session_secret ]; then
    node -e "console.log(require('crypto').randomBytes(48).toString('base64'))" > /data/session_secret
  fi
  SESSION_SECRET="$(cat /data/session_secret)"
  export SESSION_SECRET
fi

npx prisma db push --skip-generate

# Load demo data only on first start; the seed script wipes existing rows.
if [ "${SEED_DEMO_DATA:-true}" = "true" ] && [ ! -f /data/.seeded ]; then
  npx tsx seed.ts
  touch /data/.seeded
fi

exec npx next start -p "${PORT:-3000}"
