# Phase 0 Correction Report — ARMA API Hub + Cost and Usage Guard

- Repository: `https://github.com/thefsts/arma-api-hub` (public, proprietary)
- Owner: Full Stack Tech & Solutions LLC
- GitHub identity: `thefsts` · git email `amorebey@gmail.com`
- Canonical branch: `main`
- Working branch: `foundation/platform-runtime`
- Pull request: #1 (open, unmerged)
- PM baseline `main` SHA: `3a8dd30a9c7cf0f531d4ff9793c654cdae2afacd`
- Branch HEAD SHA: `a01d920` (this report's commit)
- Ahead/behind `origin/main`: 10 ahead, 0 behind (no force-push, no history rewrite)

## 1. Convex project connection

The repository is connected to the existing Convex project. No new Convex
project was created.

- Convex team: `ARMA` (Full Stack Tech Solutions)
- Convex project: `arma-api-hub`
- Development deployment: `merry-mockingbird-631`
- Deployment URL: `https://merry-mockingbird-631.convex.cloud`
- Dashboard URL: `https://dashboard.convex.dev/t/ARMA/arma-api-hub/merry-mockingbird-631`
  (kept out of public application UI and generated API documentation)

All Convex backend code lives under `convex/`. `.env.local` is git-ignored and
was never committed. Only a sanitized `.env.example` with placeholder variable
names is tracked. No deployment credentials, access tokens, or deploy keys are
committed. The private dashboard URL does not appear in any tracked file.

## 2. Schema

`convex/schema.ts` defines 36 tables with 160 indexes. The 20 core tables are
`systems`, `services`, `externalIntegrations`, `serviceIdentities`,
`credentialVersions`, `capabilityGrants`, `connectionPolicies`,
`contractDefinitions`, `contractVersions`, `webhookEndpoints`,
`webhookDeliveries`, `deliveryAttempts`, `idempotencyRecords`, `nonceRecords`,
`eventRecords`, `receiptRecords`, `connectorHealth`, `connectorIncidents`,
`killSwitches`, and `auditEvents`.

The 16 Cost and Usage Guard tables are `apiVendors`, `vendorPriceVersions`,
`connectorSubscriptions`, `apiUsageRecords`, `apiCostEvents`, `rateLimitWindows`,
`quotaAllocations`, `usageBudgets`, `spendingLimits`, `costAnomalies`,
`optimizationDecisions`, `cacheUsageRecords`, `batchUsageRecords`,
`retryWasteRecords`, `vendorShutdownControls`, and `costExportReceipts`.

Every expected read path has an index: vendor and effective date; connector,
system, tenant, and customer reference against the billing period; correlation
identifier; causation identifier; idempotency key; cost-event identifier;
request identifier; pricing-version identifier; budget status; anomaly status;
and shutdown status. No read path uses an unbounded `.collect()`; every read is
index-bounded and limited.

The schema stores no raw private keys, no plaintext secrets, no full protected
payloads, no LawShield evidence, no payment-card data, no cannabis regulator
credentials, no camera or audio evidence, and no unrelated product data. The
guard stores vendor references and price versions, never vendor credentials.

## 3. Functions

The backend exposes 120 functions across 20 modules. Public queries and
mutations are minimal and authorization-aware; privileged lifecycle, retry,
receipt, audit, credential, and cost operations are internal functions.

- Core modules: `systems`, `services`, `externalIntegrations`,
  `serviceIdentities`, `credentials`, `capabilities`, `policies`, `contracts`,
  `events`, `webhooks`, `connectors`, `killSwitches`, `idempotency`, `nonces`,
  `receipts`, `audit`.
- Cost modules: `costVendors` (vendors, price versions, subscriptions),
  `costEvents` (usage records, cost events with deduplication), `costControls`
  (rate limits, quotas, budgets, spending limits, vendor shutdown),
  `costOptimization` (anomalies, optimization decisions, cache, batch, retry
  waste, export receipts).
- Shared helpers: `lib/authz`, `lib/redaction`, `lib/ids`, `lib/errors`,
  `lib/validators`, `lib/audit`, `lib/cost`.

## 4. Cost and Usage Guard

The locked cost-ownership boundary is implemented and documented. The API Hub
owns external API, connector, webhook, retry, data-transfer, and API-storage
cost and is the authoritative source for the charge a vendor levies for an
external request. The FSTS AI Hub owns AI model, provider, token, prompt, agent,
retrieval, and AI-execution cost. REGIVANTA Cost Guard owns profitability,
margin, allocation, budgets, forecasts, and executive reporting. The API Hub
does not compute profitability or margin and does not select AI models or
inspect prompts. The AI Hub does not recreate API billing, connector quota,
webhook-cost, retry-cost, or vendor-price logic. REGIVANTA does not re-measure
vendor usage.

Money is stored as integer minor currency units and never as a floating-point
number; the deterministic cost primitives reject a non-integer or
unsafe-integer input. Every calculated amount records the currency, quantity,
unit type, unit price, pricing source, vendor price version, effective date,
calculation version, and estimated or finalized status. Vendor price versions
are immutable, and historical usage is never overwritten with a new vendor
price. The cost ledger deduplicates on both the cost-event identifier and the
idempotency key, so the same external charge is never counted twice.

The guard provides request deduplication, idempotency, safe response caching,
batching, retry ceilings, exponential backoff, circuit breakers, webhook
consolidation, request coalescing, approved vendor selection, quota-aware
routing, payload-size controls, unused-connector detection, budget warnings,
throttling, approval requirements, hard blocking, and emergency vendor
shutdown. Cost optimization never bypasses tenant isolation, authorization,
data classification, legal retention, safety controls, emergency-event
handling, contract compatibility, or audit requirements. A protected or
regulated response is never cached unless the contract explicitly allows it and
the cache is tenant-scoped.

## 5. Contracts and fixtures

Eleven normalized cost events are defined as strict, versioned contracts with
sanitized fixtures: `apiHub.apiUsageRecorded`, `apiHub.apiCostRecorded`,
`apiHub.retryWasteRecorded`, `apiHub.cacheSavingsRecorded`,
`apiHub.batchSavingsRecorded`, `apiHub.quotaThresholdReached`,
`apiHub.budgetThresholdReached`, `apiHub.costAnomalyDetected`,
`apiHub.connectorSpendBlocked`, `apiHub.vendorShutdownActivated`, and
`apiHub.costExported`. Each identifies the authoritative source hub, event and
schema version, vendor, connector, FSTS system, tenant and customer scope where
authorized, correlation and causation identifiers, idempotency key, usage
quantity and unit, exact monetary amount and currency, vendor price version,
estimated or finalized status, event timestamp, and audit reference.

The AI Hub handoff contract (`apiHub.aiExecutionCostReference`) references an
authoritative API Hub cost event and carries no monetary field and no AI
content. The REGIVANTA export contract (`apiHub.costExport`) carries measured
usage and cost and no profitability field. Thirteen sanitized fixtures are
committed under `contracts/cost/`. No production vendor appears in any fixture.

## 6. Tests and exact results

`pnpm test` → **12 test files passed, 89 tests passed** (51 core + 38 cost).

- `tests/cost/primitives.test.ts` — 9 tests (deterministic cost primitives).
- `tests/cost/backend.test.ts` — 17 tests (convex-test backend scenarios).
- `tests/cost/contracts.test.ts` — 12 tests (contract and fixture validation).

The 20 required cost scenarios are covered: one authoritative charge per
cost-event ID; duplicate cost-event rejection; idempotent replay; correct vendor
price version by effective date; no floating-point monetary storage; retry-waste
calculation; cache-savings calculation; batch-savings calculation; quota warning
threshold; spending-limit throttle; spending-limit hard block; emergency vendor
shutdown; tenant-safe cost attribution; customer-scope isolation; AI Hub
reference without duplicate billing; REGIVANTA export without profitability
fields; prohibited AI-model selection in the API Hub; prohibited API billing
recreation in the AI Hub contract; cost events contain correlation and causation
IDs; and an audit event for every warning, throttle, block, approval, and
shutdown.

## 7. Verification results

- Convex code generation: passed (`npx convex codegen`).
- TypeScript typecheck: passed (24 workspace tasks; `convex/` typechecked
  separately with `tsc -p convex/tsconfig.json --noEmit`).
- Schema validation: passed (schema deployed to the development deployment).
- Backend unit tests: passed.
- Contract tests: passed.
- `npx convex dev --once`: passed against `merry-mockingbird-631` (development).
- Format check, lint, secret scan (125 tracked files clean), dependency check
  (15 workspace packages clean), and build: all passed.
- CI: `Verify (Node 24 / pnpm)` passed on PR #1.

## 8. Documentation

Added: `docs/architecture/COST-OWNERSHIP-BOUNDARIES.md`,
`docs/architecture/API-COST-AND-USAGE-GUARD.md`,
`docs/decisions/0004-cost-ownership-and-normalized-events.md`,
`docs/runbooks/VENDOR-SPEND-LIMIT.md`, and
`docs/runbooks/EMERGENCY-VENDOR-SHUTDOWN.md`. Updated the threat model, the data
classification standard, the runtime architecture document, the Phase 0 plan,
and the PR description.

## 9. Phase 0 limits honored

Phase 0 establishes schemas, contracts, indexes, validated types, deterministic
cost-calculation primitives, policy boundaries, sanitized fixtures, tests, and
documentation. It does not connect real vendor accounts, does not import
production invoices, does not activate production billing, and does not send
live cost events to the AI Hub or to REGIVANTA. No schema change was deployed to
production; the schema was deployed only to the authorized development
deployment. PR #1 remains open and unmerged.

## 10. Blockers and remaining Phase 1 work

- No production deployment provider selected (documented tradeoffs required).
- No production vendor account connected (out of scope for Phase 0).
- No production invoice import or finalization process (deferred to an ADR).
- No production cost-export transport to REGIVANTA (deferred to an ADR).
- No production AI Hub association transport (deferred to an ADR).
- No production anomaly-detection thresholds (deferred to an ADR).
- Six source repositories were unavailable (404) during the reuse assessment and
  are reported as unavailable, not invented.

Phase 1 lanes: contracts and registry; runtime and delivery; security and
identity; console and onboarding; and the Cost and Usage Guard production
integration (vendor accounts, invoice finalization, cost export, AI Hub
association, anomaly thresholds).
