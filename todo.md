# ARMA API HUB — Phase 8 Integration Review and Hardening

## 1. Establish baseline
- [x] Fetch main + PR branches; record SHAs (main 356d00b, PR3 98ca214, PR4 d240470)
- [x] Read repo instructions, ADRs, boundaries, cost boundaries, Compliance Core handoff
- [x] Create isolated branch phase8/api-hub-integration-review (from origin/main 356d00b)

## 2. Integrate and review existing work
- [x] Merge PR #3 (onboarding + routing) into integration branch
- [x] Merge PR #4 (PATCHES/Law Shield descriptors) into integration branch
- [x] Review combined implementation; baseline 214 tests pass, 127 internal functions
- [x] Confirmed defects:
      D1 scope-key mismatch: getByProductTenant/listByProduct scope on productId not routing identity
      D2 register not idempotent despite PR claim (CONFLICT on identical replay)
      D3 decideRouting fail-open on non-finite `now` (expiry bypass)
      D4 conflicting authorization: no uniqueness on (product,tenant,env); route uses .first()
      D5 dispatch-path gap: routing gate not wired into any transport path
- [x] Fix confirmed defects D1-D4 (productOnboardings.ts, productRouting.ts)
- [x] Add governed dispatch boundary (D5) + wire into worker; prove no bypass
      (compliance-core-client createGovernedDispatcher, worker governedDispatch.ts, 14 tests)
- [x] Regression suite for D1-D5 (onboarding-hardening.test.ts, 13 tests pass)
- [x] Trace service API + worker dispatch paths; document no-bypass proof
      (transport.forward has exactly 1 caller = createGovernedDispatcher; only reachable via createGovernedJobHandler; API app /v1/validate does NOT route/dispatch)

## 3. Preserve platform ownership
- [x] Confirm no direct Core DB access / no duplicated policy engine
      (no _generated/ConvexHttpClient/from convex in apps+packages; @arma/policy is Hub admission control, not compliance adjudication)
- [x] Confirm cost boundary preserved (API Hub / AI Hub / REGIVANTA)
      (COST_OWNERSHIP + cost.ts: API Hub authoritative for external vendor charges; AI Hub references; REGIVANTA owns margin/budget)
- [x] Confirm shared correlation/cost-event IDs, no duplicate charges
      (costEventEnvelopeSchema carries shared correlationId + costEventId; API Hub never emits profit/margin/company-wide cost)

## 4. Validate combined result
- [x] Run full validation pipeline (format:check, lint, typecheck, convex:guardrails, test, build, secret:scan, deps:check) -> EXIT=0
- [x] Run focused integration/security tests (governed-dispatch 14, onboarding-hardening 13; full suite 22 files / 241 tests)
- [x] Demonstrate authorized path reaches Core boundary; unauthorized rejected pre-dispatch
      (authorized ACTIVE forwarded exactly once; all denials -> calls.length===0)
- [x] Demonstrate suspension/revocation/replay/idempotency/outage fail safe
- [x] Confirm transport success never fabricates compliance verdict
      (dispatcher returns bounded TransportResult only; assertTransportDoesNotManufactureCoreState)
- [x] Confirm Convex args/returns + internal-only model retained (127 internal / 0 public, all args+returns)

## 5. Deliver for PM review
- [x] Push integration branch (phase8/api-hub-integration-review)
- [x] Open DRAFT PR #6 with baseline/SHAs, defects/fixes, validation, blockers, merge order
- [x] Confirm no secrets/customer data committed (secret:scan clean; only .env.example tracked)
- [x] Ensure green CI (run 36615404727 = SUCCESS)
