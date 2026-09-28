# Compliance Core Connection — Failure & Resilience Matrix

- Status: **PREPARED — NOT FINALIZED (dependency hold active)**
- Scope: the ARMA API Hub ↔ FSTS Compliance Core governed connection
- Principle: **fail closed whenever authority or security is uncertain**

This matrix defines the required behavior for every failure and resilience
scenario in the Phase 7 Chat 5 scope. Each row states which side owns the
decision, the required API Hub behavior, the retry classification, and the
fail-closed rule. Bounded failure codes are drawn from the existing API Hub
vocabulary; the Compliance Core's governed codes are `PENDING` (Phase 7
Chat 1) and are consumed verbatim, never invented.

Legend — **Retry:** `TERMINAL` (never retry) · `RETRYABLE` (bounded retry) ·
`DLQ` (dead-letter after exhaustion).

| # | Scenario | Owner of decision | Required API Hub behavior | Retry | Fail-closed rule |
|---|----------|-------------------|---------------------------|-------|------------------|
| 1 | Core unavailable | Compliance Core | Report connector `UNAVAILABLE`; do not forward as success; return bounded `UNAVAILABLE` | RETRYABLE → DLQ | Never synthesize a decision when the Core is unreachable |
| 2 | API Hub unavailable | API Hub | Callers receive bounded `UNAVAILABLE`; no partial state written | RETRYABLE (caller) | No request is accepted that cannot be fully processed |
| 3 | Timeout (Core slow) | Both | Enforce a bounded deadline; classify as retryable; never hang | RETRYABLE → DLQ | A timed-out request is never treated as accepted |
| 4 | Duplicate delivery | API Hub | Dedupe on `deliveryId`/`eventId`; at-least-once semantics | TERMINAL (dedupe) | A duplicate never produces a second authoritative effect |
| 5 | Retries | API Hub | Bounded retry budget with backoff; preserve correlation | RETRYABLE | Retries never bypass authz/signature/version checks |
| 6 | Retry exhaustion | API Hub | Move to dead-letter with bounded reason code | DLQ | Exhaustion is recorded, never silently dropped |
| 7 | Rate limits | API Hub (external) / Core (internal) | Enforce external rate limits; honor Core rate signals | RETRYABLE (bounded) | Rate-limited requests are never force-forwarded |
| 8 | Quota exhaustion | API Hub | Block on vendor quota exhaustion; bounded `RATE_LIMIT`/quota code | TERMINAL until reset | Quota exhaustion fails closed, never over-spends |
| 9 | Stale requests | Both | Reject requests outside the clock-skew window | TERMINAL | Stale requests never execute |
| 10 | Signature failure | API Hub | Reject on tampered body/path/timestamp/nonce; timing-safe compare | TERMINAL | An unverifiable request is never forwarded |
| 11 | Replay | Both | Reject reused nonce; independent nonce windows on each side | TERMINAL | A replayed request never executes twice |
| 12 | Partial failure | Both | Return bounded partial-failure signal; no false success | TERMINAL / RETRYABLE per code | Partial success is never reported as full success |
| 13 | Version mismatch | Both | Reject incompatible governed contract version; no downgrade | TERMINAL | No silent version downgrade |
| 14 | Contract mismatch | Both | Reject unknown/foreign contract; no best-effort parse | TERMINAL | An unrecognized contract is never executed |
| 15 | Audit failure | Both | If the Core audit cannot be written, the governed operation fails closed; API Hub records transport audit | TERMINAL | No governed effect without its audit record |

## Cross-cutting invariants

1. **No direct DB access.** No scenario permits a direct read/write to the
   Compliance Core Convex database. Every path crosses the signed boundary.
2. **Bounded everything.** Every failure surfaces a bounded, machine-readable
   code. No unbounded errors, no leaked internals, no stack traces.
3. **Terminal vs retryable is explicit.** Auth, authz, version, contract,
   replay, signature, and idempotency-conflict failures are always terminal.
4. **Idempotency conflict.** Same key + different body = conflict = terminal
   `IDEMPOTENCY` failure; same key + same body = replay of the stored outcome.
5. **Kill switch wins.** An engaged kill switch halts the connection regardless
   of any other state.
6. **Correlation preserved.** Every failure carries the originating correlation
   ID so the chain is reconstructable across both platforms.

## Security scenarios (certification set)

The Phase 7 Chat 5 security certification must deny, fail-closed, each of the
following. Full end-to-end certification is `PENDING` the Chat 1–4 contracts;
the readiness test asserts the boundary that makes these denials enforceable.

- cross-tenant access
- cross-product access
- auth bypass
- scope escalation
- forged identity
- forged tenant
- forged environment
- tampering
- invalid signature
- stale request
- replay
- nonce reuse
- duplicate
- idempotency conflict
- rate abuse
- retry storm
- quota exhaustion
- dependency outage
- audit gap
- contract/version mismatch
- direct DB attempt
- unauthorized product intake
- auto legal enforcement
- unreviewed legal update
- direct legal-change product action
