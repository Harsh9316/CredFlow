# Data Connectors

Connectors fetch data from external providers: credit bureaus, the GST network, PAN verification and Account Aggregators. They only fetch data. All credit judgement stays in the engine and your credit policy.

## Configuration

Choose a provider for each data source with environment variables:

| Variable | Used for | Values |
|---|---|---|
| `CONNECTOR_BUREAU` | Commercial bureau score, DPD 90+ history, fraud markers → bureau overlay | `none`, `mock` |
| `CONNECTOR_GST` | GSTIN status (active / cancelled / suspended) → `gstinNotActive` fraud rule | `none`, `mock` |
| `CONNECTOR_KYC` | PAN verification → `panNotVerified` fraud rule | `none`, `mock` |
| `CONNECTOR_BANK_DATA` | Monthly inflows / outflows from an Account Aggregator consent | `none`, `mock` |

`none` (the default) means the data isn't fetched. The engine treats missing bureau or verification data as neutral, so the decision falls back to cash flow.

**Connector failures never block underwriting.** If a provider errors or times out, the evaluation continues without that data, and the failure is recorded in the evaluation's `connectors` summary and in the audit log.

## Mock providers

`mock` returns deterministic fake data (the same PAN always gets the same report), for development, demos and tests. **Never use mock providers for real decisions.**

| Input | Mock result |
|---|---|
| PAN with 4th character `X` | Bureau fraud alert |
| PAN ending in `D` | DPD 90+ history |
| PAN ending in `Z` | PAN not verified |
| GSTIN ending in `C` | GSTIN cancelled |
| Anything else | Bureau score 450–850 (about 10% of PANs have no bureau record), GSTIN active, PAN verified |

## Adding a real provider

1. Implement the interface from `lib/connectors/types.ts`:

   ```ts
   import type { BureauConnector } from './types'

   export const acmeBureau: BureauConnector = {
     provider: 'acme',
     async fetchReport({ pan, gstin, legalName }) {
       const res = await fetch('https://api.acme-bureau.example/commercial', {
         method: 'POST',
         headers: { authorization: `Bearer ${process.env.ACME_BUREAU_KEY}` },
         body: JSON.stringify({ pan, gstin, name: legalName }),
         signal: AbortSignal.timeout(10_000),
       })
       if (res.status === 404) return null // no record: thin file
       if (!res.ok) throw new Error(`Acme bureau returned ${res.status}`)
       const r = await res.json()
       return {
         provider: 'acme',
         reportId: r.reportId,
         score: r.score,
         hasDelinquency: r.maxDpd >= 90,
         hasFraudAlert: r.flags.includes('FRAUD') || r.flags.includes('WILFUL_DEFAULTER'),
         fetchedAt: new Date().toISOString(),
       }
     },
   }
   ```

2. Register it in `lib/connectors/index.ts` (`const bureau = { mock: mockBureau, acme: acmeBureau }`).
3. Set `CONNECTOR_BUREAU=acme` and the provider's credentials.

Guidelines:

- Return `null` for "no record". Throw only for real failures.
- Set a timeout on every call.
- Map the provider's response onto the interface fields, and keep provider-specific scoring out of the connector. Thresholds belong in the credit policy.
- Do not log full PAN, GSTIN or report contents.

Contributions of real connectors are welcome. Please include a mock-backed test and document the provider's sandbox in the pull request.
