# Security Policy

Credrail handles borrower financial and identity data, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [GitHub Security Advisories](https://github.com/Harsh9316/credrail/security/advisories/new).

Include the affected version or commit, steps to reproduce, and the impact you expect. We aim to acknowledge reports within 3 working days.

## Deployment checklist

- Set `SESSION_SECRET` to a random value of at least 32 characters, and never reuse the example value.
- Keep `NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS` unset or `false`.
- Do not run the demo seed (`npm run db:seed`) against a production database. It deletes all data.
- Serve over HTTPS. Session cookies are marked `secure` when `NODE_ENV=production`.
- Run on PostgreSQL with the bundled migrations. The `audit_log_append_only` migration makes the database reject `UPDATE`/`DELETE` on the audit log.
- Keep `WEBHOOK_ALLOW_PRIVATE_URLS` unset in production. It allows webhooks to internal addresses and exists for local development only.
- Keep the `CONNECTOR_*` variables at `none` or a real provider. `mock` providers return fake bureau and KYC data.
- API keys and webhook signing secrets are shown once. API keys are stored only as SHA-256 hashes. Webhook secrets are stored as-is, because they are needed to sign deliveries, so protect database backups accordingly.
- Run `npm run webhooks:dispatch` on a schedule so failed deliveries are retried.

