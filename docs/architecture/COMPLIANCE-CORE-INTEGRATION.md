# Compliance Core Integration — ARMA API Hub (Phase 7 · Chat 5)

- Status: **PREPARED — NOT FINALIZED (dependency hold active)**
- Owner: Full Stack Tech & Solutions LLC — Platform / Integration lane
- Compliance Core baseline: `thefsts/FSTS-COMPLIANCE-CORE` @ `4bf0c4b171864dc9d6d288ce18f6e0aa3463e797`
- API Hub baseline: `thefsts/arma-api-hub` @ `176c870660be72516f80691b4be72d5d5d271c41`
- Contract version: **PENDING — owned by Compliance Core (Phase 7 Chats 1–4)**

> **Dependency hold.** This document describes the *prepared* integration
> architecture. The governed connection to the FSTS Compliance Core is **not
> finalized** because the Phase 7 Chat 1–4 contracts are not yet available.
> No wire contract, field, version, or operation is invented here. Where a
> contract is required, this document names the required artifact and marks it
> `PENDING`. See `contracts/compliance-core/intake-manifest.json`.

## 1. Purpose

This document defines how the ARMA API Hub connects to the FSTS Compliance
Core as the **first real system connection** of Phase 7. The API Hub is the
external transport for the connection; the Compliance Core remains the
compliance authority. The connection is governed end to end and fails closed
whenever authority or security is uncertain.

This lane certifies exactly one connection — **Compliance Core ↔ ARMA API
Hub**. It does not onboard any other FSTS product. ARMA System 360, Operon,
PATCHES, REGIVANTA, QUALIVANTA, and every other product remain unconnected
until a PM-authorized product-intake phase begins.

## 2. Locked responsibility split

The boundary is locked and must not be weakened.

**Compliance Core owns (authority):**

- compliance authority and compliance state;
- legal governance;
- policy governance;
- applicability;
- controls;
- evidence metadata;
- release / adoption / drift / rollback authority.

**ARMA API Hub owns (transport):**

- external transport;
- connectors;
- webhooks;
- delivery;
- retries;
- external rate limits;
- vendor quotas;
- API usage / cost telemetry transport;
- routing.

The API Hub transports. The Compliance Core decides. The API Hub never makes a
compliance decision, never authors a legal or policy conclusion, and never
becomes the system of record for compliance state.

## 3. Hard rule: no direct database access

The API Hub **must never** read from or write to the Compliance Core Convex
database directly. There is no shared database, no cross-project Convex client,
and no privileged query path. Every interaction crosses a signed, governed
request boundary owned by the Compliance Core. This mirrors the existing
platform rule that no product may directly query another product's database.

## 4. The governed path

The certified path for an authorized service interaction is:

```
AUTHORIZED SERVICE
  → ARMA API HUB                (transport: identity, signing, routing, delivery)
  → SIGNED GOVERNED REQUEST     (API Hub signs the exact bytes it forwards)
  → COMPLIANCE CORE PIPELINE    (Chat 1 governed pipeline — the authority)
  → TENANT/PRODUCT AUTHORIZATION (Core decides)
  → GOVERNED OPERATION          (Core executes)
  → AUDIT                       (Core audits; API Hub audits transport)
  → BOUNDED RESPONSE            (bounded failure codes / bounded success)
  → API HUB DELIVERY            (API Hub delivers, retries, dead-letters)
```

The second certified path is the legal-governance path, which the API Hub
transports but does not decide:

```
LEGAL CHANGE
  → HUMAN REVIEW
  → CANONICAL UPDATE
  → APPLICABILITY
  → CONTROL/POLICY IMPACT
  → APPROVAL
  → RELEASE
  → DISTRIBUTION
  → RECEIPT
  → APPLICATION
  → VERIFICATION
  → DRIFT / EXCEPTION / ROLLBACK
```

Every stage after "ARMA API HUB" on the first path, and every stage on the
second path, is owned by the Compliance Core. The API Hub's role is limited to
carrying the signed request in and the bounded response out.

## 5. Transport-only boundary (enforced)

The API Hub side of the connection is composed of transport-only modules. Each
transport module is marked `TRANSPORT_ONLY` and must never become a Core
authority. The boundary is enforced by:

- the transport adapter (`packages/compliance-core-client`), which refuses to
  operate until the Phase 7 Chat 1–4 contracts are present;
- the readiness test (`tests/integration/compliance-core-readiness.test.ts`),
  which fails closed if a fabricated contract or a bypass path is introduced;
- the existing control-plane guards (service binding, scoped capability,
  destination allow list, kill switch).

## 6. Envelope mapping

The API Hub already carries a signed `ServiceRequestEnvelope`
(`packages/contracts/src/envelopes.ts`). The governed request to the Compliance
Core is a **separate** envelope owned by the Compliance Core. The mapping
between the two is defined by the Phase 7 Chat 1 contract and is `PENDING`.

What the API Hub contributes to the mapping (transport-owned, already
implemented):

- `serviceId`, `keyId`, `timestamp`, `nonce`, `bodyHash`, `signature`
  (`HMAC-SHA256`, versioned and replaceable);
- `correlation.correlationId` and optional `correlation.causationId`;
- `idempotency.key` + `idempotency.requestHash`;
- `routing.source` / `routing.destination`;
- `tenant` scope where applicable;
- `classification`;
- `operation` (dotted).

What the Compliance Core owns and defines (`PENDING`):

- the governed request contract ID and version;
- the governed operation set and their required scopes;
- the tenant/product/environment authorization semantics;
- the bounded failure-code vocabulary for the governed boundary;
- the governed response shape.

## 7. Identity, signing, integrity, and replay

- **Service identity.** The API Hub uses a real, registered service identity.
  Callers are bound to a server-derived service identity; a caller-supplied
  `serviceId` is never trusted. The Compliance Core independently verifies the
  governed request; the API Hub's identity is not a substitute for the Core's
  own authorization.
- **Signing / integrity.** The API Hub signs the exact bytes it forwards
  (canonical request string over method, path, timestamp, nonce, body hash).
  A tampered body, path, timestamp, or nonce breaks verification.
- **Correlation.** Every request carries a correlation ID; causation IDs are
  preserved so a full chain can be reconstructed across both platforms.
- **Replay protection.** The API Hub enforces an anti-replay nonce window
  (2× clock skew) and a nonce registry. The Compliance Core independently
  enforces its own replay protection; a nonce is never reused across the
  boundary.
- **Idempotency.** Mutating operations carry a tenant-scoped idempotency key
  and a request hash. A replay of the same key with a different body is a
  conflict and fails closed.
- **Versioning.** The governed contract version is negotiated and checked. A
  version or contract mismatch fails closed (no silent downgrade).

## 8. Tenant / product / environment context

Every governed request carries tenant, product, and environment context. The
API Hub transports the context; the Compliance Core authorizes against it.
Cross-tenant, cross-product, and cross-environment access is denied by the
Core. The API Hub must never widen the context it was given, and must never
substitute one tenant/product/environment for another in transit.

## 9. Bounded failures and retry classification

- **Bounded failures.** Both platforms return bounded, machine-readable failure
  codes. The API Hub never surfaces an unbounded or opaque error to a caller,
  and never leaks Core internals.
- **Retry classification.** Failures are classified as retryable or terminal.
  Authentication, authorization, version, contract, replay, and idempotency
  conflicts are **terminal** (never retried). Transport unavailability and
  timeouts are **retryable** within a bounded budget.
- **Retry exhaustion.** Exhausted retries move to dead-letter with a bounded
  reason code; they are never silently dropped.
- **Fail closed.** When authority or security is uncertain, both platforms fail
  closed. The API Hub never "best-effort" forwards an unauthorized or
  unverifiable request.

## 10. Health and readiness

The API Hub exposes connector health and readiness for the Compliance Core
connection. Readiness aggregates fail-closed: if a required dependency is
unavailable, the connection reports `UNAVAILABLE` rather than `AVAILABLE`.
Kill-switch state is reflected in every health report.

## 11. Secret management

- No secrets in GitHub. No private signing keys in the repository.
- The repository contains references and configuration only.
- Key material lives in deployment/platform secret storage; the API Hub stores
  key *references* (key IDs) and credential lifecycle state, never key material.
- The `.env.example` is sanitized; the secret scan gate fails closed on
  credential material.

## 12. Cost boundary (preserved)

The cost boundary is unchanged and must not be duplicated:

- **ARMA API Hub** owns external API / vendor usage and cost telemetry.
- **FSTS AI Hub** owns AI / model / token cost.
- **REGIVANTA** owns profitability / margin / budget analysis.
- **Compliance Core** must not duplicate any of these systems.

The Compliance Core connection carries compliance requests and responses. It
does not carry vendor cost accounting, AI token accounting, or profitability
analysis, and the API Hub does not emit a second authoritative vendor charge.

## 13. Dependency hold and required contracts

Finalization is gated on the Phase 7 Chat 1–4 contracts. The required artifacts
are listed by name in `contracts/compliance-core/intake-manifest.json`. Until
those artifacts are present and reviewed, the integration remains
`PENDING_DEPENDENCY` and the readiness test fails closed.

| Required artifact | Producing chat | Status |
|-------------------|----------------|--------|
| Governed request contract (ID, version, operations, scopes) | Phase 7 Chat 1 | PENDING |
| Governed response + bounded failure-code vocabulary | Phase 7 Chat 1 | PENDING |
| Tenant/product/environment authorization contract | Phase 7 Chat 2 | PENDING |
| Replay/idempotency semantics contract | Phase 7 Chat 2 | PENDING |
| Legal-governance handoff contract | Phase 7 Chat 3 | PENDING |
| Policy release / adoption / drift handoff contract | Phase 7 Chat 3 | PENDING |
| Audit correlation contract | Phase 7 Chat 4 | PENDING |
| Service-identity / credential exchange contract | Phase 7 Chat 4 | PENDING |

## 14. What is prepared vs. what is pending

**Prepared (this branch):** the transport-side boundary, the transport adapter
interface and fail-closed guard, the failure/resilience matrix, the contract
intake manifest, and the readiness tests. These are contract-agnostic and
consume the real contracts verbatim once available.

**Pending:** the Phase 7 Chat 1–4 contracts themselves, and the final
end-to-end certification against the real integrated path. Neither is invented
here.
