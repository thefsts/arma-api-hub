# ARMA API HUB — Phase 0 Convex Security Hold Corrections

## 1. Return validators on every Convex function
- [x] Add accurate `returns` validator to all 121 functions (convex/lib/returns.ts)
- [x] Add repo test failing when a function lacks `args` or `returns` (tests/convex/guardrails.test.ts)

## 2. Tenant and resource authorization
- [x] Server-derived authorization context (subject/service -> scopes) (convex/lib/authz.ts)
- [x] Enforce scope on every read (systems, services, tenants, customers, credentials, idempotency, nonces, webhooks, health, incidents, cost, usage, budgets, quotas, limits, audit)
- [x] Global admin only when explicitly modeled/audited/tested (principalAuthorizations.global)

## 3. Service-identity binding
- [x] Bind service callers to server-derived service identity (requireServiceBinding)
- [x] Reject mismatched serviceId
- [x] Negative tests: service A cannot read/affect service B (tests/security/service-binding.test.ts)

## 4. Reactive time-dependent queries
- [x] Remove Date.now() from query handlers (capabilities.hasCapability reads materialized status)
- [x] Deterministic design + ADR (docs/security/ADR-0005-authentication-decision.md)
- [x] Search all public queries for nondeterminism (guardrail rule)

## 5. Auth configuration
- [x] convex/auth.config.ts decision documented + implemented (Option 2: internal functions)
- [x] No fake provider, no hard-coded claims

## 6. Role-claim trust
- [x] Verify claim origin from trusted issuer (ARMA_TRUSTED_ISSUER, fail closed)
- [x] Fail closed on missing/malformed/conflicting
- [x] Tests for forged/missing/unknown/conflicting claims (tests/security/role-claims.test.ts)

## 7. Cost-data isolation tests
- [x] tenant A/B, customer A/B, service A/B, viewer/operator scope, correlation-ID, cost-event-ID, vendor-period, REGIVANTA export, AI Hub association (tests/security/cost-isolation.test.ts)

## 8. CI enforcement
- [x] Fail on missing args/returns, Date.now() in query, unbounded collect, .filter(), public sensitive fn without authz, unverified service ID, missing auth config (scripts/convex-guardrails.mjs + ci.yml)

## 9. Report and PR accuracy
- [x] Fetch main, recalc SHA/ahead-behind/files/insertions
- [x] Update PR description
- [x] Re-run all validation
- [x] Leave PR #1 open/unmerged
- [x] Final report
