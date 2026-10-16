// OpenAPI 3.1 document for /api/v1. Request bodies are generated from the same Zod schemas
// the handlers validate with, so the spec cannot drift from what the server accepts.

import { z } from 'zod'
import { ApplicationInputSchema } from '@credrail/engine'
import { CreateApplicationSchema } from './services/applications'
import { API_SCOPES } from './api-keys'
import { EVENT_TYPES } from './services/events'
import { BureauConsentSchema, RequestBankDataSchema } from './services/data-consents'

const toSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (schema: object) => ({ 'application/json': { schema } })
const errorResponses = {
  400: { description: 'Invalid request', content: json(ref('Error')) },
  401: { description: 'Missing, invalid or revoked API key', content: json(ref('Error')) },
  403: { description: 'API key lacks the required scope', content: json(ref('Error')) },
}

const str = { type: 'string' }
const num = { type: 'number' }
const strings = { type: 'array', items: str }
const nullable = (s: object) => ({ anyOf: [s, { type: 'null' }] })

export function buildOpenApiDocument(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Credrail API',
      version: '1.0.0',
      description: [
        'Submit loan applications, run explainable underwriting under your credit policy, and receive results by webhook.',
        '',
        '**Authentication:** create an API key on the Developers page and send it as `Authorization: Bearer cr_...`. Each endpoint lists the scope it needs.',
        '',
        '**Idempotency:** send an `Idempotency-Key` header on `POST /applications` to retry safely. A retry with the same key and body returns the original response.',
        '',
        '**Sanctioning:** the API can create and evaluate applications, but approvals are made by a signed-in analyst in the dashboard (with maker-checker where your policy requires it).',
        '',
        `**Webhooks:** events are POSTed to your endpoints with a \`Credrail-Signature: t=<unix>,v1=<hex>\` header, where v1 is the HMAC-SHA256 of \`<t>.<raw body>\` using the endpoint's signing secret. Event types: ${EVENT_TYPES.filter(t => t !== 'webhook.test').map(t => `\`${t}\``).join(', ')}.`,
      ].join('\n'),
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'Applications' },
      { name: 'Data consents' },
      { name: 'Decisioning' },
      { name: 'Policy' },
      { name: 'Events' },
    ],
    paths: {
      '/applications': {
        post: {
          tags: ['Applications'],
          operationId: 'createApplication',
          summary: 'Create an application',
          description: 'Scope: `applications:write`. Creates the borrower (or uses `borrowerId`), the application, its financials and collateral. Emits `application.created`.',
          parameters: [{ name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 } }],
          requestBody: { required: true, content: json(ref('CreateApplication')) },
          responses: { 201: { description: 'Created', content: json(ref('Application')) }, ...errorResponses, 404: { description: 'borrowerId not found', content: json(ref('Error')) }, 422: { description: 'Idempotency-Key reused with a different body', content: json(ref('Error')) } },
        },
        get: {
          tags: ['Applications'],
          operationId: 'listApplications',
          summary: 'List applications',
          description: 'Scope: `applications:read`. Newest first, cursor-paginated.',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['APPLIED', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
            { name: 'cursor', in: 'query', schema: str, description: '`nextCursor` from the previous page' },
          ],
          responses: {
            200: { description: 'OK', content: json({ type: 'object', properties: { data: { type: 'array', items: ref('Application') }, nextCursor: nullable(str) }, required: ['data', 'nextCursor'] }) },
            ...errorResponses,
          },
        },
      },
      '/applications/{id}': {
        get: {
          tags: ['Applications'],
          operationId: 'getApplication',
          summary: 'Get an application',
          description: 'Scope: `applications:read`.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
          responses: { 200: { description: 'OK', content: json(ref('Application')) }, ...errorResponses, 404: { description: 'Not found', content: json(ref('Error')) } },
        },
      },
      '/applications/{id}/evaluate': {
        post: {
          tags: ['Decisioning'],
          operationId: 'evaluateStoredApplication',
          summary: 'Run underwriting on a stored application',
          description: 'Scope: `applications:evaluate`. Uses the latest bank data (an Account Aggregator fetch replaces figures sent at creation) and GST-verified turnover when available. Runs fraud pre-checks, the bureau overlay (only with a bureau connector and a recorded borrower consent) and the scorecard under your active policy, stores the recommendation and emits `application.evaluated`. Re-running replaces the previous recommendation.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
          responses: {
            200: { description: 'OK', content: json({ type: 'object', properties: { application: ref('Application'), evaluation: ref('Evaluation'), policy: ref('PolicyRef'), connectors: { type: 'object' } } }) },
            ...errorResponses,
            404: { description: 'Not found', content: json(ref('Error')) },
            409: { description: 'Application is not in a state that can be evaluated', content: json(ref('Error')) },
            422: { description: 'No financial data for the borrower', content: json(ref('Error')) },
          },
        },
      },
      '/applications/{id}/consents': {
        post: {
          tags: ['Data consents'],
          operationId: 'createConsent',
          summary: 'Request bank/GST data or record a bureau consent',
          description: [
            'Scope: `applications:write`. Emits `consent.updated`.',
            '',
            '`type: ACCOUNT_AGGREGATOR` creates an Account Aggregator consent request. Send the returned `consentUrl` to the borrower; once they approve it, call `/consents/{id}/sync` (or wait for the provider notification) and the bank statements, and GST returns if requested, are fetched, reduced to monthly figures and used at the next evaluation. Emits `financial_data.received`.',
            '',
            '`type: BUREAU` records that the borrower consented to a bureau pull. Underwriting pulls a bureau report only when such a consent, under 180 days old, exists.',
          ].join('\n'),
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }, { name: 'Idempotency-Key', in: 'header', required: false, schema: { type: 'string', maxLength: 255 } }],
          requestBody: {
            required: true,
            content: json({
              oneOf: [
                { allOf: [{ type: 'object', required: ['type'], properties: { type: { const: 'ACCOUNT_AGGREGATOR' } } }, toSchema(RequestBankDataSchema)] },
                { allOf: [{ type: 'object', required: ['type'], properties: { type: { const: 'BUREAU' } } }, toSchema(BureauConsentSchema)] },
              ],
            }),
          },
          responses: {
            201: { description: 'Created', content: json(ref('Consent')) },
            ...errorResponses,
            404: { description: 'Application not found', content: json(ref('Error')) },
            409: { description: 'Application already decided', content: json(ref('Error')) },
            422: { description: 'No Account Aggregator connector configured', content: json(ref('Error')) },
            502: { description: 'The provider returned an error', content: json(ref('Error')) },
          },
        },
        get: {
          tags: ['Data consents'],
          operationId: 'listConsents',
          summary: "List an application's consents",
          description: 'Scope: `applications:read`.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
          responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { data: { type: 'array', items: ref('Consent') } } }) }, ...errorResponses },
        },
      },
      '/consents/{id}': {
        get: {
          tags: ['Data consents'],
          operationId: 'getConsent',
          summary: 'Get a consent',
          description: 'Scope: `applications:read`. Returns the stored state; use `/sync` to refresh it from the provider.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
          responses: { 200: { description: 'OK', content: json(ref('Consent')) }, ...errorResponses, 404: { description: 'Not found', content: json(ref('Error')) } },
        },
      },
      '/consents/{id}/sync': {
        post: {
          tags: ['Data consents'],
          operationId: 'syncConsent',
          summary: 'Refresh a consent from its provider',
          description: 'Scope: `applications:write`. Re-reads the consent; when it is approved, starts the data fetch and stores the results once ready. Safe to call repeatedly: data is stored once.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }],
          responses: { 200: { description: 'OK', content: json(ref('Consent')) }, ...errorResponses, 404: { description: 'Not found', content: json(ref('Error')) }, 502: { description: 'The provider returned an error', content: json(ref('Error')) } },
        },
      },
      '/evaluate': {
        post: {
          tags: ['Decisioning'],
          operationId: 'evaluate',
          summary: 'Evaluate without storing',
          description: 'Scope: `evaluate`. Evaluates the posted application under your active credit policy and returns the full result. Nothing is stored and no events are emitted.',
          requestBody: { required: true, content: json(ref('ApplicationInput')) },
          responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { evaluation: ref('Evaluation'), policy: ref('PolicyRef') } }) }, ...errorResponses },
        },
      },
      '/policy': {
        get: {
          tags: ['Policy'],
          operationId: 'getPolicy',
          summary: 'Get the active credit policy',
          description: 'Scope: `policy:read`. The full policy document the engine applies to your decisions.',
          responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { checksum: str, isDefault: { type: 'boolean' }, policy: { type: 'object' } } }) }, ...errorResponses },
        },
      },
      '/events': {
        get: {
          tags: ['Events'],
          operationId: 'listEvents',
          summary: 'List events',
          description: 'Scope: `events:read`. Events in the order they happened; poll with `after` set to the last id you processed.',
          parameters: [
            { name: 'after', in: 'query', schema: str },
            { name: 'type', in: 'query', schema: { type: 'string', enum: EVENT_TYPES.filter(t => t !== 'webhook.test') } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
          ],
          responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { data: { type: 'array', items: ref('Event') }, hasMore: { type: 'boolean' } } }) }, ...errorResponses },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: `API key from the Developers page. Scopes: ${Object.keys(API_SCOPES).map(s => `\`${s}\``).join(', ')}.`,
        },
      },
      schemas: {
        CreateApplication: toSchema(CreateApplicationSchema),
        ApplicationInput: toSchema(ApplicationInputSchema),
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: str, message: str, details: {} } } },
        },
        Consent: {
          type: 'object',
          properties: {
            id: str,
            applicationId: nullable(str),
            kind: { type: 'string', enum: ['ACCOUNT_AGGREGATOR', 'BUREAU'] },
            provider: str,
            status: { type: 'string', enum: ['CREATING', 'PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'PAUSED', 'EXPIRED', 'FAILED'] },
            consentUrl: { ...nullable(str), description: 'Link for the borrower to approve; present while PENDING' },
            fiTypes: strings,
            dataRange: nullable({ type: 'object', properties: { from: str, to: str } }),
            mobile: { ...nullable(str), description: 'Masked' },
            sessionStatus: nullable({ type: 'string', enum: ['PENDING', 'PARTIAL', 'COMPLETED', 'EXPIRED', 'FAILED'] }),
            method: nullable({ type: 'string', enum: ['DIGITAL', 'PHYSICAL'] }),
            reference: nullable(str),
            error: nullable(str),
            dataReceived: { type: 'boolean' },
            data: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['ACCOUNT_AGGREGATOR', 'GST_RETURNS'] }, avgMonthlyInflow: nullable(num), avgMonthlyOutflow: nullable(num), metrics: { type: 'object' } } } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            completedAt: nullable({ type: 'string', format: 'date-time' }),
          },
        },
        PolicyRef: { type: 'object', properties: { id: str, version: str, checksum: str } },
        Event: { type: 'object', properties: { id: str, type: str, createdAt: { type: 'string', format: 'date-time' }, data: { type: 'object' } } },
        ScoreBreakdown: {
          type: 'object',
          properties: { cashFlowScore: num, coverageScore: num, stabilityScore: num, collateralScore: num, profileScore: num, total: num },
        },
        Evaluation: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['APPROVE', 'REFER', 'REJECT'] },
            creditScore: num,
            scoreBreakdown: ref('ScoreBreakdown'),
            emi: num,
            emiCoverageRatio: num,
            cashFlowEligible: num,
            collateralEligible: num,
            finalRecommendedAmt: num,
            industryRisk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            approvalReasons: strings,
            riskFlags: strings,
            recommendations: strings,
            fraud: {
              type: 'object',
              properties: {
                passed: { type: 'boolean' },
                riskLevel: { type: 'string', enum: ['CLEAR', 'REVIEW', 'HIGH_RISK'] },
                summary: str,
                flags: { type: 'array', items: { type: 'object', properties: { code: str, severity: str, description: str, recommendation: str } } },
              },
            },
            bureau: { type: 'object', properties: { available: { type: 'boolean' }, bureauScore: num, bureauRank: { type: 'integer', minimum: 1, description: '1 = lowest risk' }, modifier: num, notes: strings } },
            policy: { type: 'object', properties: { id: str, version: str } },
          },
        },
        Application: {
          type: 'object',
          properties: {
            id: str,
            applicationNo: str,
            status: { type: 'string', enum: ['APPLIED', 'UNDER_REVIEW', 'PENDING_APPROVAL', 'SANCTIONED', 'REJECTED', 'WITHDRAWN'] },
            requestedAmount: num,
            requestedTenure: { type: 'integer' },
            purpose: nullable(str),
            priority: str,
            sourcePlatform: nullable(str),
            sourceReference: nullable(str),
            appliedAt: { type: 'string', format: 'date-time' },
            borrower: { type: 'object', properties: { id: str, businessName: str, industry: str, constitution: str, vintage: { type: 'integer' }, city: nullable(str), state: nullable(str) } },
            collateral: nullable({ type: 'object', properties: { type: str, assessedValue: num, ltv: num, hasPersonalGuarantee: { type: 'boolean' } } }),
            evaluation: nullable({
              type: 'object',
              properties: {
                decision: str, creditScore: num, scoreBreakdown: ref('ScoreBreakdown'), cashFlowEligible: num, collateralEligible: num,
                recommendedAmount: num, approvalReasons: strings, riskFlags: strings, recommendations: strings,
                policy: nullable(ref('PolicyRef')), evaluatedAt: { type: 'string', format: 'date-time' },
              },
            }),
            approval: nullable({
              type: 'object',
              properties: {
                decision: str,
                status: { type: 'string', enum: ['CONFIRMED', 'PENDING_CHECKER', 'RETURNED'] },
                sanctionedAmount: nullable(num), sanctionedTenure: nullable({ type: 'integer' }), interestRate: nullable(num),
                overrideSystem: { type: 'boolean' }, decidedAt: { type: 'string', format: 'date-time' }, checkedAt: nullable({ type: 'string', format: 'date-time' }),
              },
            }),
          },
        },
      },
    },
  }
}
