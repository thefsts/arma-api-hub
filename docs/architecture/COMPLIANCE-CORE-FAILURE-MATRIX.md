# Compliance Core Connection — Failure & Resilience Matrix (Phase 7 · Chat 5 · FINAL)

- Status: **FINALIZED** against the converged Phase 7 Core tree
  (Core main `c7ac04b2d40624bef1742f819a9f7eee43e3d12c`)
- Scope: the ARMA API Hub ↔ FSTS Compliance Core governed connection
- Principle: **fail closed whenever authority or security is uncertain**
- Failure vocabularies (both consumed verbatim from Core, never invented):
  - **Internal governed-pipeline codes** — the `API_ERROR_CODES` closed set
    emitted by the authoritative boundary
    (`convex/lib/apiPipeline.ts` → `runGovernedPipeline`). These are what the
    real pipeline actually throws; the E2E suite asserts them directly.
  - **Published LIVE SERVICE taxonomy** — the 18-code closed set in
    `registry/service/failure-taxonomy.json` (17 mandated + `NOT_FOUND`). This
    is the service-facing surface. The Hub's `classifyCoreFailure` maps an
    incoming code into this set and **fails closed to `INTERNAL_FAILURE`** for
    any code it does not model — raw internal text is never surfaced.

Legend — **Retry:** `TERMINAL` (never retry) · `RETRYABLE` (bounded retry) ·
`DLQ` (dead-letter after exhaustion). **Owner:** `CORE` decides · `HUB`
transports.

## 1. Negative cases (20 — all must deny / fail closed)

Cases 7–20 are exercised by `tests/integration/compliance-core-e2e.test.ts`
against the **real** Core pipeline fixture (vendored verbatim from Core main).
The "Core pipeline code" column is the observed authoritative code; the
"Service taxonomy code" column is the published surface the Hub maps to.

| # | Scenario | Owner | Core pipeline code (observed) | Service taxonomy code | Retry | Fail-closed rule |
|---|----------|-------|-------------------------------|-----------------------|-------|------------------|
| 1 | Core unavailable | CORE | — | `DEPENDENCY_UNAVAILABLE` | RETRYABLE → DLQ | Never synthesize a decision when the Core is unreachable |
| 2 | Timeout (Core slow) | HUB | — | `DEPENDENCY_UNAVAILABLE` | RETRYABLE → DLQ | A timed-out request is never treated as accepted |
| 3 | Duplicate delivery | HUB | — | (dedupe) | TERMINAL | A duplicate never produces a second authoritative effect |
| 4 | Retry exhaustion | HUB | — | (DLQ) | DLQ | Exhaustion is recorded, never silently dropped |
| 5 | Rate limit (external/vendor) | HUB | `RATE_LIMITED` | `RATE_LIMITED` | RETRYABLE (bounded) | Rate-limited requests are never force-forwarded |
| 6 | Quota exhaustion | HUB | `RATE_LIMITED` | `RATE_LIMITED` | TERMINAL until reset | Quota exhaustion fails closed, never over-spends |
| 7 | Stale request (past window) | CORE | `REQUEST_STALE` | `STALE_REQUEST` | TERMINAL | Stale requests never execute |
| 8 | Future-skewed request | CORE | `REQUEST_FUTURE` | `STALE_REQUEST` | TERMINAL | Requests beyond future skew never execute |
| 9 | Tampered signed field | CORE | `REQUEST_TAMPERED` | `INTEGRITY_FAILED` | TERMINAL | An unverifiable request is never forwarded |
| 10 | Replay (nonce reuse) | CORE | `NONCE_REPLAY` | `REPLAY_DENIED` | TERMINAL | A replayed request never executes twice |
| 11 | Idempotency conflict (same key, diff body) | CORE | `IDEMPOTENCY_CONFLICT` | `IDEMPOTENCY_CONFLICT` | TERMINAL | A conflicting key never produces a second effect |
| 12 | Cross-tenant access | CORE | `TENANT_ACCESS_DENIED` | `TENANT_DENIED` | TERMINAL | Tenant context is never widened in transit |
| 13 | Cross-product access | CORE | `PRODUCT_ISOLATION_VIOLATION` | `PRODUCT_DENIED` | TERMINAL | Product context is never widened in transit |
| 14 | Cross-environment access | CORE | `ENVIRONMENT_NOT_AUTHORIZED` | `ENVIRONMENT_DENIED` | TERMINAL | Environment context is never widened in transit |
| 15 | Scope escalation | CORE | `FORBIDDEN` | `SCOPE_DENIED` | TERMINAL | An unmapped/insufficient scope is never widened |
| 16 | Forged / unknown identity | CORE | `CREDENTIAL_INVALID` | `AUTHENTICATION_FAILED` | TERMINAL | A caller-supplied identity is never trusted |
| 17 | Inactive integration | CORE | `IDENTITY_SUSPENDED` | `INTEGRATION_INACTIVE` | TERMINAL | Non-ACTIVE onboarding produces no consumable traffic |
| 18 | Version mismatch | CORE | `UNKNOWN_API_VERSION` | `UNSUPPORTED_VERSION` | TERMINAL | No silent version downgrade |
| 19 | Unknown operation | CORE | `CONTRACT_UNKNOWN` | `UNKNOWN_OPERATION` | TERMINAL | An unrecognized operation is never executed |
| 20 | Malformed envelope | CORE | `NONCE_INVALID` | `VALIDATION_FAILED` | TERMINAL | A malformed request is never forwarded |

### Additional authority-boundary denials (must also fail closed)

| # | Scenario | Owner | Required behavior | Fail-closed rule |
|---|----------|-------|-------------------|------------------|
| 21 | Audit gap | CORE | If the Core audit cannot be written, the governed operation fails closed; the Hub records transport audit | No governed effect without its audit record |
| 22 | Direct DB attempt | HUB | `assertNoDirectCoreDatabaseAccess` throws on any Convex import/client | No direct Core Convex read/write, ever |
| 23 | Unauthorized product intake | HUB | Scope freeze: only the Compliance Core connection is onboarded | No other FSTS product is connected |
| 24 | Auto legal enforcement | HUB | `assertTransportOnlyNotification` throws; transport-only contract | No automatic legal enforcement |
| 25 | Unreviewed legal update | CORE | `assertAcceptRequiresReview` / `assertNoAutoApply` throw | No canonical update without human legal review |
| 26 | Direct legal-change product action | HUB | `assertNotificationRequiresCoreGovernance` throws | Every legal change crosses Core governance |

## 2. Positive controls (legitimate ACTIVE traffic must succeed)

Positive controls prove the boundary is not merely "always deny": real,
authorized ACTIVE traffic flows end to end.

| # | Control | Expected |
|---|---------|----------|
| P1 | Signed governed request, ACTIVE identity, authorized scope, in-window | `runGovernedPipeline` returns `ok`, operation dispatched, audit appended |
| P1b | Envelope **built by the Hub client** (`buildGovernedEnvelope`) | The real Core pipeline verifies the Hub's signature and returns `ok` |
| P2 | Same idempotency key + same body (replay of stored outcome) | Returns the stored outcome; no second authoritative effect |
| P3 | ACTIVE onboarding | `producesConsumableTraffic` true; `assertConsumableTraffic` does not throw |
| P4 | Policy happy path | `APPROVED → RELEASED → DISTRIBUTED → RECEIVED → APPLIED → VERIFIED`; `DRIFTED` and `ROLLED_BACK` remain distinct |
| P5 | Legal happy path | `DETECTED → REVIEW_REQUIRED → HUMAN_LEGAL_REVIEW → APPROVED_CANONICAL_UPDATE → APPLICABILITY_REVIEW → CONTROL_POLICY_IMPACT_REVIEW` |
| P6 | Full E2E chain | `runE2ECertification()` passes all 15 stages and all invariants |

## 3. Cross-cutting invariants

1. **No direct DB access.** No scenario permits a direct read/write to the
   Compliance Core Convex database. Every path crosses the signed boundary.
2. **Bounded everything.** Every failure surfaces a bounded, machine-readable
   code. No unbounded errors, no leaked internals, no stack traces.
3. **Two vocabularies, one authority.** The Core's internal pipeline codes are
   the authoritative decision codes; the published service taxonomy is the
   service-facing surface. The Hub maps between them and fails closed to
   `INTERNAL_FAILURE` for anything unmodelled.
4. **Terminal vs retryable is explicit.** Auth, authz, version, contract,
   replay, signature, and idempotency-conflict failures are always terminal.
5. **Idempotency conflict.** Same key + different body = conflict = terminal
   `IDEMPOTENCY_CONFLICT`; same key + same body = replay of the stored outcome.
6. **Kill switch wins.** An engaged kill switch halts the connection regardless
   of any other state.
7. **Correlation preserved.** Every failure carries the originating correlation
   ID so the chain is reconstructable across both platforms.
