# ARMA API HUB — Phase 8 PM HOLD Corrections

## 0. Baseline (fetched)
- [x] main 356d00b (unchanged); PR#6 head 545106f (mine); PR#3 98ca214 OPEN; PR#4 d240470 OPEN
- [x] PR#6 OPEN/DRAFT/MERGEABLE/CLEAN; CI 36615852812 SUCCESS; 7 ahead / 0 behind main
- [x] New branch phase8/chat5-hub-convergence = parallel integration (no hardening); DO NOT TOUCH

## 6. Exact product/tenant/environment uniqueness (schema first — dependency)
- [x] Add composite index (productId+tenantId+environment) to schema
- [x] register: exact binding query; 0->create, identical replay->existing id, conflict->CONFLICT
- [x] route: distinguish 0/1/>1 via exact index; >1->CONFLICT; no .first(); no .take(10) uniqueness
- [x] Hostile test with >10 sibling records (onboarding-sibling-ambiguity.test.ts, 12 siblings)

## 5. Harden hostile durable records
- [x] Validate credentialExpiresAt finite (NaN/+/-Infinity fail closed) in decideRouting
- [x] Audit other authority-bearing numeric/time fields
- [x] Hostile durable-record tests (onboarding-hostile-records.test.ts, 17 tests)

## 7. Fix ambiguous read contract
- [x] Add getByProductTenantEnvironment (exact binding); update callers/tests
- [x] getByProductTenant must not arbitrarily .first(); fail closed on ambiguity
- [x] Verify no remaining ambiguous callers (deprecated getByProductTenant has no production callers)

## 4. Harden onboarding administration authorization
- [x] Require explicit trusted authority (global/admin) for register/advanceState/setLifecycleState
- [x] Negative tests: cross-product/tenant/env, lifecycle mutations, scope/operation/routingIdentity tampering

## 2. Complete route <-> signed envelope binding
- [x] Bind ALL authority-bearing fields (productId/tenantId/environment/hubRoutingIdentity<->serviceIdentityId/apiVersion/operation<->action)
- [x] Document scope/contractVersion/resourceType/resourceId mapping
- [x] Hostile mismatch tests for EVERY bound field (route-envelope-binding.test.ts, 9 tests)

## 3. Real trusted routing-gate adapter
- [x] Adapter supplies trusted `now` (server clock); caller cannot supply expiry clock
- [x] No new public Convex function; use existing internal boundary
- [x] Source-of-truth matrix for all routing fields

## 1. Real governed worker composition root
- [x] Build DEVELOPMENT worker composition: queue->handler->gate adapter->clock->credential resolve->transport
- [x] Exact execution trace reserved job->handler->routing decision->transport.forward
- [x] Structural test: no ungoverned alternate path to Core dispatch (worker-composition.test.ts, 9 tests)

## 8. Retry/hold/dead-letter semantics
- [x] classifyRoutingDenial: TERMINAL vs HELD/DEFERRED vs CLEAN_RETRYABLE vs AMBIGUOUS
- [x] HELD: no retry budget, keeps identity/ordering, resumable after release
- [x] Ambiguous->reconciliation; temporary governance state not silently dead-lettered
- [x] Extend Queue/processor with HELD state
- [x] Disposition-mapping test suite (worker-hold-semantics.test.ts, 25 tests)

## 9. Replay/idempotency/correlation/cost proof
- [x] Prove preservation of requestId/correlationId/causationId/idempotencyKey/costEventId/identity/product/tenant/env
- [x] Cost: no charge on denial; no dup on safe retry; no second charge on replay; ambiguous no blind charge
- [x] Tests: replay/conflict/retry/ambiguous/held-resume/repeat/dup-delivery/cost-dedup (replay-idempotency-cost.test.ts, 9 tests)

## 10. Prove no bypass
- [x] Report every caller of forward/createGovernedDispatcher/createGovernedJobHandler/processJob/route (audit complete)

## 11. Hostile authorization boundaries
- [x] Add/verify all negatives (tenant/service/product/env cross, credential, version, scope, forged history, dup binding, >10 siblings, route mismatch, lifecycle, missing/suspended/revoked, gate failure) — matrix in report Point 13

## 12. Validation
- [x] pnpm validate at final head (107e8d9) EXIT 0; 29 files / 333 tests; 128 Convex fns (0 public/128 internal); all stages pass
- [x] Focused test groups (AUTHORIZATION/HOSTILE/BINDING/WORKER/HOLD/RETRY/AMBIGUOUS/IDEMPOTENCY/COST/CORRELATION) — report Point 15

## 13. Evidence classification
- [x] Label every proof MOCKED / IN-PROCESS / CONFIGURED DEV RUNTIME / LIVE DEV E2E — report Point 16

## 14. Push / PR rules
- [x] Push to phase8/api-hub-integration-review (545106f..107e8d9 fast-forward); PR#6 OPEN/DRAFT/UNMERGED; no merges/deploy

## 15. Final report
- [x] Produce 21-point final report (PHASE-8-PM-HOLD-CORRECTIONS-REPORT.md)
