# Data Connectors

Connectors fetch data from external providers:

- Account Aggregators: bank statements and GST returns.
- The GST network and PAN verification.
- Commercial credit bureaus.

Connectors only fetch and normalise data. All credit judgement stays in the engine and your credit policy.

## Configuration

Choose a provider for each data source with environment variables:

| Variable | Used for | Values |
|---|---|---|
| `CONNECTOR_BANK_DATA` | Account Aggregator: bank statements → cash flow; GSTR-3B → verified turnover | `none`, `mock`, `setu` |
| `CONNECTOR_GST` | GSTIN status → `gstinNotActive` fraud rule | `none`, `mock`, `setu` |
| `CONNECTOR_KYC` | PAN verification and name match → `panNotVerified` fraud rule | `none`, `mock`, `setu` |
| `CONNECTOR_BUREAU` | Commercial bureau score or rank, DPD 90+, fraud markers → bureau overlay | `none`, `mock`, `gateway` |

`none` (the default) means the data isn't fetched. The engine treats missing bureau or verification data as neutral, so the decision falls back to cash flow.

**Connector failures never block underwriting.** If a provider errors or times out, the evaluation continues without that data. The failure is recorded in the evaluation's `connectors` summary and in the audit log.

## Account Aggregator (Setu)

Credrail is a Financial Information User (FIU) client of [Setu's Account Aggregator gateway](https://docs.setu.co/data/account-aggregator). Setu connects to all live AAs and bank FIPs.

### Flow

1. An analyst (application page → **Request bank data**) or your system (`POST /api/v1/applications/{id}/consents`) creates a consent request for the borrower's mobile number. The request covers 3–24 months of `DEPOSIT` data, plus `GSTR1_3B` if asked for.
2. The borrower opens the returned link and approves in their AA app.
3. Setu notifies Credrail, or the analyst presses **Check status**, or you call `POST /consents/{id}/sync`. Credrail re-reads the consent and, once it is `ACTIVE`, starts a one-time data session.
4. When the session is `COMPLETED` or `PARTIAL`, Credrail parses the ReBIT data (deposit v1.x/v2.0.0, gstr1_3b) and stores **derived figures only**:
   - monthly inflow and outflow, averages, and inflow volatility, from complete months;
   - transfers between the borrower's own linked accounts, which are excluded from income;
   - a count of returned or bounced payments (ECS/NACH returns, cheque returns, insufficient funds);
   - whether the account holder PAN matches the borrower;
   - GST: turnover per return period, annualised turnover, and periods not filed.

   Raw transactions are discarded.
5. The next evaluation uses this bank data, and GST-verified turnover replaces the declared turnover.

Consents are one-time (`fetchType: ONETIME`), with 1-month consent and data life, and the purpose is stated to the borrower as credit assessment.

### Setup

1. Create an FIU product on [Setu Bridge](https://bridge.setu.co) and note its client id, secret and product instance id.
2. Set:

   ```bash
   CONNECTOR_BANK_DATA=setu
   SETU_ENV=sandbox            # production once Setu has approved you
   SETU_AA_CLIENT_ID=...
   SETU_AA_CLIENT_SECRET=...
   SETU_AA_PRODUCT_INSTANCE_ID=...
   SETU_AA_WEBHOOK_SECRET=$(openssl rand -hex 24)
   SETU_AA_REDIRECT_URL=https://your-site.example/thanks   # optional
   ```

3. In Bridge, set the notification URL to `https://<your-credrail-host>/api/connectors/setu/notifications/<SETU_AA_WEBHOOK_SECRET>`.

Setu does not sign notifications. Credrail therefore:

- puts a secret in the URL, compared in constant time; a wrong secret returns 404;
- uses the notification only to find the consent;
- always re-reads the status from Setu's API.

A forged notification cannot change any data. Without notifications (for example, behind a firewall), use the sync button or endpoint.

## GSTIN and PAN verification (Setu)

Both use [Setu's data APIs](https://docs.setu.co/data/gst-verification) with one client id and secret, and a product instance per product:

```bash
CONNECTOR_GST=setu
CONNECTOR_KYC=setu
SETU_DATA_CLIENT_ID=...
SETU_DATA_CLIENT_SECRET=...
SETU_GST_PRODUCT_INSTANCE_ID=...
SETU_PAN_PRODUCT_INSTANCE_ID=...
```

- **GSTIN.** Status maps to `ACTIVE` (including provisional), `CANCELLED`, `SUSPENDED` or `NOT_FOUND`. Legal name, trade name, constitution and registration date are recorded.
- **PAN.** Each lookup is sent with `consent: "Y"` and a stated reason. The name on PAN is compared with the borrower's legal name, ignoring case, punctuation and suffixes such as Pvt Ltd. An unknown PAN returns "not verified". Credential or quota errors are reported as connector errors, not as an invalid PAN.

## Bureau (gateway)

Commercial bureaus (TransUnion CIBIL company reports and MSME Rank, CRIF High Mark, Experian, Equifax) give API access only to member lenders, each under its own specification. Credrail does not hold bureau credentials. Instead, it calls a small **bureau gateway** that you run, or that your LOS already provides. The gateway pulls the report under your membership and returns this JSON.

```bash
CONNECTOR_BUREAU=gateway
BUREAU_GATEWAY_URL=https://bureau-gateway.internal.example/credrail/report
BUREAU_GATEWAY_TOKEN=...   # sent as Authorization: Bearer
```

**Request** (`POST BUREAU_GATEWAY_URL`):

```json
{
  "pan": "AAGCA1234K",
  "gstin": "27AAGCA1234K1Z5",
  "legalName": "Acme Traders Pvt Ltd",
  "consentReference": "esign-7781",
  "consentCapturedAt": "2026-10-01T10:00:00.000Z",
  "purpose": "credit_assessment"
}
```

**Response** (`200`). Return `404`, or `"noRecord": true`, when the bureau has no file:

```json
{
  "reportId": "CIB-2026-000123",
  "bureau": "cibil",
  "noRecord": false,
  "score": null,
  "rank": 3,
  "dpd90Plus": false,
  "fraudOrWilfulDefault": false,
  "summary": { "activeFacilities": 4, "totalOutstanding": 3200000, "overdueAmount": 0, "enquiriesLast6Months": 2 },
  "fetchedAt": "2026-10-01T10:00:04.000Z"
}
```

- **Score and rank.** Send `score` (higher is better) or `rank` (1–10, where 1 is the lowest risk, as in CIBIL MSME Rank). The policy has separate bands for each (`bureau.scoreBands`, `bureau.rankBands`).
- **Flags.** `dpd90Plus` means any facility was 90+ days past due in the lookback window. `fraudOrWilfulDefault` covers bureau fraud, wilful-defaulter or suit-filed markers.
- **Validation.** Responses that break the contract are rejected and recorded as connector errors.

**Consent is required.** Underwriting pulls a bureau report only when a borrower consent has been recorded in the last 180 days, either from the application page or with `POST /api/v1/applications/{id}/consents` and `{"type": "BUREAU", "method": "DIGITAL", "reference": "..."}`. Without one, the bureau is reported as `skipped`. The consent reference is passed to your gateway for its records.

## Mock providers

`mock` returns deterministic fake data for development, demos and tests: the same PAN always gets the same report. **Never use mock providers for real decisions.** With `NODE_ENV=production`, mocks are refused unless `ALLOW_MOCK_CONNECTORS=true`, which the Docker demo sets.

| Input | Mock result |
|---|---|
| PAN with 4th character `X` | Bureau fraud alert |
| PAN ending in `D` | DPD 90+ history |
| PAN ending in `R` | Bureau returns a rank instead of a score |
| PAN ending in `Z` | PAN not verified |
| GSTIN ending in `C` | GSTIN cancelled |
| AA mobile ending in `0000` | Borrower rejects the consent |
| Anything else | Bureau score 450–850 (about 10% of PANs have no record), GSTIN active, PAN verified |

The mock Account Aggregator approves at once. It returns 12 months of ReBIT JSON for two accounts, with self-transfers and the occasional bounce, plus GST returns if requested. This exercises the same parsers as real data.

## Data handling

- Only derived metrics are stored, in `FinancialData.metrics` and `monthlyData`. Raw bank transactions and full reports are never stored.
- Mobile numbers are stored masked. Error messages and logs contain provider, path and HTTP status, never PAN, mobile numbers or report contents.
- Every consent request, status change, data receipt and bureau consent is in the application's append-only audit log, and emits `consent.updated` or `financial_data.received` webhooks.

## Adding a provider

1. Implement an interface from `lib/connectors/types.ts`: `BankDataConnector`, `GstConnector`, `KycConnector` or `BureauConnector`. Use `requestJson` from `lib/connectors/http.ts` for timeouts, retries and typed errors.
2. Register it in `lib/connectors/index.ts`.
3. Set `CONNECTOR_<SOURCE>=<name>` and the provider's credentials.

Guidelines:

- Return `null` (bureau) or a "not found" status for "no record". Throw only for real failures.
- Map the provider's response onto the interface, and keep provider-specific scoring out of the connector. Thresholds belong in the credit policy.
- Do not log PAN, GSTIN, mobile numbers or report contents.

Contributions of connectors (Finvu, OneMoney, Perfios, Karza, a CIBIL or CRIF gateway, ...) are welcome. Include tests against a fake `fetch`, as in `lib/connectors/__tests__/providers.test.ts`, and document the provider's sandbox in the pull request.
