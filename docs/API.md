# Credrail API

Connect your loan origination system, ERP or marketplace to Credrail. The interactive reference is served by every Credrail instance at **`/docs/api`**, and the OpenAPI 3.1 document at **`/api/v1/openapi.json`**.

## Authentication

1. Sign in as an NBFC admin and open **Developers**.
2. Create an API key with the scopes you need. The key (`cr_<prefix>_<secret>`) is shown once, and Credrail stores only a hash.
3. Send it on every request:

```bash
curl https://credrail.example.com/api/v1/applications \
  -H "Authorization: Bearer cr_1a2b3c4d_..."
```

| Scope | Allows |
|---|---|
| `applications:read` | `GET /applications`, `GET /applications/{id}` |
| `applications:write` | `POST /applications` |
| `applications:evaluate` | `POST /applications/{id}/evaluate` |
| `evaluate` | `POST /evaluate` (stateless) |
| `policy:read` | `GET /policy` |
| `events:read` | `GET /events` |

Every key belongs to one NBFC and only sees that NBFC's data. Actions taken with a key are recorded in the audit trail under the key's name. Revoking a key takes effect immediately.

> **The API can recommend but never sanction.** Approvals are made by a signed-in user in the dashboard, with maker-checker where your credit policy requires it.

## Create an application

```bash
curl -X POST https://credrail.example.com/api/v1/applications \
  -H "Authorization: Bearer $CREDRAIL_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: erp-order-8812" \
  -d '{
    "borrower": {
      "businessName": "Shakti Auto Components Pvt Ltd",
      "pan": "AAGCS4321K",
      "gstin": "27AAGCS4321K1Z5",
      "industry": "Manufacturing",
      "constitution": "Pvt Ltd",
      "vintage": 84,
      "annualTurnover": 16000000,
      "contactPerson": "R. Iyer",
      "contactPhone": "9811111111"
    },
    "requestedAmount": 2500000,
    "requestedTenure": 36,
    "sourceReference": "erp-order-8812",
    "financial": {
      "monthlyData": [
        { "month": "2026-04", "inflow": 1350000, "outflow": 690000 },
        { "month": "2026-05", "inflow": 1420000, "outflow": 710000 },
        { "month": "2026-06", "inflow": 1390000, "outflow": 705000 }
      ]
    },
    "collateral": { "type": "LAP", "assessedValue": 8000000, "ltv": 60, "hasPersonalGuarantee": true }
  }'
```

- Pass `borrowerId` instead of `borrower` to reuse a borrower your NBFC already has.
- Financials can come from `monthlyData` (Credrail derives averages and volatility) or from explicit averages. To use bank statements fetched through an Account Aggregator instead, request a consent after creating the application (next section).

## Bank data, GST returns and bureau consent

Fetch the borrower's bank statements (and, optionally, GST returns) through an Account Aggregator:

```bash
curl -X POST https://credrail.example.com/api/v1/applications/$ID/consents \
  -H "Authorization: Bearer $CREDRAIL_KEY" -H "Content-Type: application/json" \
  -d '{ "type": "ACCOUNT_AGGREGATOR", "mobile": "9876543210", "includeGst": true, "months": 12 }'
```

The response has a `consentUrl`. Send it to the borrower, who approves the request in their Account Aggregator app. Credrail then fetches the data, either when the provider notifies it or when you call `POST /consents/{id}/sync`. The data is reduced to monthly inflows and outflows, inflow volatility, returned-payment count and GST turnover. Raw transactions are not stored. You receive a `financial_data.received` event, and the next evaluation uses this data. Turnover from GST returns replaces the declared turnover.

A bureau report is pulled only after you record that the borrower consented:

```bash
curl -X POST https://credrail.example.com/api/v1/applications/$ID/consents \
  -H "Authorization: Bearer $CREDRAIL_KEY" -H "Content-Type: application/json" \
  -d '{ "type": "BUREAU", "method": "DIGITAL", "reference": "esign-7781" }'
```

Without a bureau consent, the evaluation's `connectors.bureau.status` is `skipped`.

## Run underwriting

```bash
curl -X POST https://credrail.example.com/api/v1/applications/$ID/evaluate \
  -H "Authorization: Bearer $CREDRAIL_KEY"
```

The response includes the full evaluation: decision, score breakdown, recommended amount, reasons, risk flags, fraud checks and bureau overlay. It also includes the policy version (`id`, `version`, `checksum`) the evaluation ran under and which data connectors were used.

### Stateless evaluation

`POST /evaluate` runs the engine on the posted data under your active policy and returns the result **without storing anything**. Use it to pre-screen leads, or to run Credrail's decisioning inside your own system of record.

## Idempotency

Send an `Idempotency-Key` header on `POST /applications`:

- If you retry with the same key and the same body, you get the original response back, with an `Idempotent-Replayed: true` header, and no duplicate is created.
- Reusing a key with a different body returns `422 idempotency_key_reused`.
- A request still in progress with that key returns `409 request_in_progress`.
- Failed requests release the key, so you can retry them.

## Errors

```json
{ "error": { "code": "invalid_request", "message": "Request body failed validation",
             "details": [{ "path": "requestedAmount", "message": "Too small: expected number to be >0" }] } }
```

| Status | Codes |
|---|---|
| 400 | `invalid_request`, `invalid_json` |
| 401 | `unauthorized` (missing, unknown or revoked key) |
| 403 | `insufficient_scope` |
| 404 | `not_found` (including other NBFCs' records) |
| 409 | `invalid_state`, `request_in_progress` |
| 422 | `missing_financials`, `idempotency_key_reused`, `connector_unavailable` |

## Webhooks

Register endpoints on the **Developers** page. Each endpoint gets a signing secret (`whsec_...`, shown once).

| Event | When |
|---|---|
| `application.created` | An application was created (dashboard or API) |
| `application.evaluated` | The underwriting engine produced a recommendation |
| `application.pending_approval` | A maker approved a sanction that needs a checker |
| `application.sanctioned` | A sanction took effect |
| `application.rejected` | An analyst rejected the application |
| `application.referred` | Referred for further review |
| `application.returned` | A checker returned a sanction to the maker |

Each delivery is a `POST` with this body:

```json
{ "id": "evt_...", "type": "application.sanctioned", "createdAt": "2026-10-16T10:30:00.000Z",
  "data": { "application": { "id": "...", "applicationNo": "FFC-2026-0017", "status": "SANCTIONED", "...": "..." } } }
```

and these headers:

| Header | Value |
|---|---|
| `Credrail-Event` | Event type |
| `Credrail-Delivery` | Delivery id. It stays the same across retries, so use it to de-duplicate. |
| `Credrail-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` |

**Verify every delivery** before trusting it:

```js
import { createHmac, timingSafeEqual } from 'node:crypto'

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map(p => p.split('=')))
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false // replay window
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest()
  const actual = Buffer.from(v1, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
```

**Delivery guarantees**

- **At least once.** Events are recorded in the same database transaction as the change they describe, so none are lost.
- **When they're sent.** Deliveries go out right after the request. Retries use backoff (1m, 5m, 30m, 2h, 6h, 12h, 24h), up to 8 attempts, after which the delivery is marked `FAILED`.
- **Success.** Any 2xx response counts as success. Redirects are not followed.
- **Destinations.** Endpoints must use `https` and must not resolve to private or internal addresses. For local development only, `WEBHOOK_ALLOW_PRIVATE_URLS=true` lifts this.
- **Scheduled retries.** Run `npm run webhooks:dispatch` (or `-- --watch`) on a schedule so retries continue after restarts.

Prefer polling? `GET /events?after=<last id>` returns the same events in order.
