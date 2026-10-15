#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL must be set (postgresql://...)" >&2
  exit 1
fi

# Generate and persist a session secret if none was provided, so a demo
# starts with one command and sessions survive container restarts.
if [ -z "$SESSION_SECRET" ]; then
  if [ ! -f /data/session_secret ]; then
    node -e "console.log(require('crypto').randomBytes(48).toString('base64'))" > /data/session_secret
  fi
  SESSION_SECRET="$(cat /data/session_secret)"
  export SESSION_SECRET
fi

npx prisma migrate deploy

# Load demo data only into an empty database; the seed script wipes existing rows.
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  npx tsx scripts/seed-if-empty.ts
fi

exec npx next start -p "${PORT:-3000}"
