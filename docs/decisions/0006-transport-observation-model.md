# ADR 0006 — Transport observation model and operational honesty

- **Status:** Accepted (Phase 9)
- **Date:** Phase 9
- **Supersedes:** none
- **Related:** ADR 0001 (control-plane boundary), ADR 0002 (runtime architecture), ADR 0004 (cost ownership), `docs/architecture/PHASE9-CORE-REBASELINE.md`

## Context

The API Hub needed production operations: request/response tracing, failure
accounting, dependency availability, internal SLO measurement, and transport
cost attribution. The risk in adding observability to a governance boundary is
that observability quietly becomes a second authority. A "health" endpoint that
says `COMPLIANT`, a cost table that starts tracking margin, or a trace record
that stores a raw signed body would each break the locked architecture:

```
FSTS PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE -> HUB -> PRODUCT
```

The Hub transports. The Core decides. Nothing the Hub records may be read as a
compliance, certification, or authorization verdict.

## Decision

### 1. One append-oriented observation model

All transport telemetry is a single `transportObservations` table. Requests,
responses, hops, failures, retries, replays, rate-limit events, health
observations, and cost observations are rows in that table distinguished by
`kind`. There is no second event stream and no mutable per-request state.

Rows are append-only. The only destructive operation is retention purge, which
is bounded and only deletes rows whose `expiresAt` has elapsed.

### 1a. Storage model — one observation stream, two derived operational stores

The observation stream is `transportObservations` and nothing else. Two further
tables exist, but neither is a parallel observation stream: they are bounded,
derived operational stores that are recomputable from the observation stream and
carry no independent telemetry authority.

- `dependencyHealthSnapshots` stores the **raw dependency counters** the Hub
  observed plus the server-derived state and source. It exists so the Hub can
  derive health without trusting a caller-asserted state, and so a Core-boundary
  handoff can send raw counters only. It is read by the health queries and is not
  an event log.
- `sloWindows` stores **bounded aggregations** over the observation stream
  (counts, latency summary, availability, error budget). It is a cache of a
  computation, not a source of truth, and can be rebuilt from
  `transportObservations`.

Transport cost is **not** given a Phase 9 table. The Hub's canonical cost store
is the pre-existing `apiCostEvents`; the Core usage/cost handoff is a pure
projection (`transportCostRecordSchema` / `toCoreUsageTelemetry()`) over that
store. Adding a `transportCostRecords` table would have created a second cost
authority, so it was removed before the final gate. This keeps ADR 0006's
"single observation stream, no parallel authority" invariant intact.

### 2. A closed field allow-list

`packages/observability/src/telemetry.ts` defines `SAFE_OBSERVATION_FIELDS` (a
closed set) and `FORBIDDEN_OBSERVATION_FIELDS`. `projectObservation()` drops the
entire candidate if any field is unknown, forbidden, non-scalar, out of range,
or contains control characters. There is no partial acceptance: a rejected
projection is never persisted.

Forbidden fields include request/response bodies, payloads, signatures, secrets,
credentials, tokens, private keys, API keys, authorization headers, raw
evidence, and verdicts.

### 3. Hub-minted trace identity

The caller's correlation reference is an untrusted lookup key. The authoritative
identity is the Hub-minted `traceId` (`trc_` + 32 hex), bound to a canonical
routing context hash over product, tenant, environment, hub routing identity, and
service. Reusing a caller reference under a different context fails closed with
`INTEGRITY_FAILED` / `CALLER_REFERENCE_CONTEXT_MISMATCH`. A client-supplied
trace id is never trusted.

### 4. Four operational states, never a compliance state

The only operational states are `AVAILABLE`, `DEGRADED`, `UNAVAILABLE`, and
`UNKNOWN`. `COMPLIANT`, `CERTIFIED`, `SECURE`, `APPROVED`, `RELEASED`, and
`VERIFIED` are forbidden vocabulary. Every stored row and every derived response
carries the literals `complianceClaim: 'NONE'` and `certificationClaim: 'NONE'`.

### 5. Fail-closed health derivation

`deriveOperationalState()` evaluates in a fixed order: kill switch → no checks →
stale mandatory check → all checks stale → failing mandatory check → failing
optional check → otherwise available. `UNKNOWN` never silently becomes
`AVAILABLE`. A throwing probe is unverifiable, not healthy.

### 6. Internal SLO targets, not SLAs

SLO windows carry the literal `targetClass: 'INTERNAL_OPERATIONAL_TARGET'` and
`complianceClaim: 'NONE'`. They are operational measurements used to detect
regression. They are not contractual service levels, not compliance
requirements, and not certification evidence.

### 7. Cost ownership is not merged

The Hub's transport cost lives in the existing canonical `apiCostEvents` store;
Phase 9 adds **no** second cost table. Transport cost is API-Hub-owned transport
cost only: external API calls, connectors, webhooks, messaging, transport, and
storage. Model, token, and agent cost belongs to AI Hub; profitability and margin
analysis belongs to REGIVANTA Cost Guard. Foreign categories and foreign fields
are rejected by `assertCostOwnershipBoundary()`. The Hub projects a governed
usage fact from `apiCostEvents` into the Core `api-hub-usage-telemetry` handoff
shape (`transportCostRecordSchema` / `toCoreUsageTelemetry()`); it does not become
the cost authority for that value and does not persist a parallel copy.

### 8. All Convex functions are internal

Every observability operation is an `internalQuery` or `internalMutation`. None
is client-callable. Reads enforce the caller's server-derived service, tenant,
and environment scope. There is no public observability function, because no
governed contract requires one.

## Consequences

- Operators can answer "what did the Hub transport, and how did it fail?" without
  being able to answer "is this tenant compliant?" from Hub data alone.
- Adding a field requires editing the closed allow-list, which is a deliberate
  review gate.
- Retention must be resolved by the caller (`retentionPolicyRef` + `expiresAt`);
  a row without `expiresAt` is never treated as expired, which is the
  conservative fail-closed choice.
- Cross-chat dependency: the Core remains the sole authority for policy state,
  health admission, and usage-telemetry acceptance. Any change to the governed
  handoff shape must land in the Core registry first and be re-baselined here.
