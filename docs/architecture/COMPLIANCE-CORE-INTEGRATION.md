# Compliance Core Integration — ARMA API Hub (Phase 7 · Chat 5 · FINAL)

- Status: **FINALIZED** against the converged Phase 7 Core tree
- Owner: Full Stack Tech & Solutions LLC — Platform / Integration lane
- Compliance Core baseline: `thefsts/FSTS-COMPLIANCE-CORE` @
  `c7ac04b2d40624bef1742f819a9f7eee43e3d12c` (main; convergence PR #30 merged)
- API Hub baseline: `thefsts/arma-api-hub` @
  `176c870660be72516f80691b4be72d5d5d271c41` (main; integration PR #2)
- Authoritative handoff: `registry/phase7/handoff-manifest.json`
  (`FSTS-PHASE7-CORE-CONVERGENCE-HANDOFF`, version `1.0.0`)
- Governed service contract: `FSTS-COMPLIANCE-CORE-LIVE-SERVICE`, contract
  version `1.0.0`, supported governed API `v1`

> **Dependency hold RELEASED.** The Phase 7 Chat 1–4 convergence is merged into
> Core `main` and consumed **verbatim** by the API Hub transport client. Nothing
> in this document invents, renames, restates, or redistributes ownership of any
> governed contract, field, version, scope, failure code, or operation. Every
> governed artifact is vendored from Core at the pinned SHA and loaded from the
> vendored registry tree (`contracts/compliance-core/core-handoff`).

## 1. Purpose

This document defines how the ARMA API Hub connects to the FSTS Compliance
Core as the **first real system connection** of Phase 7. The API Hub is the
external transport for the connection; the Compliance Core remains the
compliance authority. The connection is governed end to end and fails closed
whenever authority or security is uncertain.

This lane certifies exactly one connection — **Compliance Core ↔ ARMA API
Hub**. It does not onboard any other FSTS product. ARMA System 360, Operon,
PATCHES, REGIVANTA, QUALIVANTA, Law Shield, Cannabis, and every other product
remain unconnected until a PM-authorized product-intake phase begins.

## 2. Locked responsibility split

The boundary is locked and must not be weakened.

**Compliance Core owns (authority):** compliance authority and compliance
state; legal governance; policy governance; applicability; controls;
verification; evidence metadata; release / adoption / drift / rollback
authority; Core authorization; Core idempotency; Core audit linkage; tenancy
authority; onboarding state.

**ARMA API Hub owns (transport):** external API transport; connectors;
webhooks; delivery; retry execution; external/vendor rate limits; quotas;
vendor API usage & cost telemetry transport; routing.

The API Hub transports. The Compliance Core decides. The API Hub never makes a
compliance decision, never authors a legal or policy conclusion, and never
becomes the system of record for compliance state. The split is asserted by the
readiness test (`CORE_OWNED_CONCERNS` and `TRANSPORT_OWNED_CONCERNS` must not
overlap).

## 3. Hard rule: no direct database access

The API Hub **must never** read from or write to the Compliance Core Convex
database directly. There is no shared database, no cross-project Convex client,
and no privileged query path. Every interaction crosses a signed, governed
request boundary owned by the Compliance Core. The transport client contains no
`convex` dependency, no `convex/_generated` import, and no Convex client; the
readiness test fails closed if any is introduced. This mirrors the existing
platform rule that no product may directly query another product's database.

## 4. The governed path

The certified path for an authorized service interaction is:

```
AUTHORIZED SERVICE
  → ARMA API HUB                (transport: identity, signing, routing, delivery)
  → SIGNED GOVERNED REQUEST     (API Hub signs the exact bytes it forwards)
  → COMPLIANCE CORE PIPELINE    (runGovernedPipeline — the single authority)
  → TENANT/PRODUCT AUTHORIZATION (Core decides)
  → GOVERNED OPERATION          (Core executes)
  → AUDIT                       (Core audits; API Hub audits transport)
  → BOUNDED RESPONSE            (bounded failure codes / bounded success)
  → API HUB DELIVERY            (API Hub delivers, retries, dead-letters)
```

The single authoritative boundary is `runGovernedPipeline`
(`convex/lib/apiPipeline.ts`), wired by `buildGovernedPorts`
(`convex/apiService.ts`). Every Phase 7 lane funnels through this one boundary:
there is no second auth/authz pipeline, no client-authoritative
tenant/product, no direct product→Convex path, and no API Hub→Core Convex path.

The second certified path is the policy/legal-governance path, which the API
Hub transports but does not decide:

```
LEGAL CHANGE
  → DETECTED → REVIEW_REQUIRED → HUMAN_LEGAL_REVIEW
  → APPROVED_CANONICAL_UPDATE → APPLICABILITY_REVIEW → CONTROL_POLICY_IMPACT_REVIEW
  → POLICY APPROVAL → SIGNED RELEASE
  → DISTRIBUTION → RECEIPT → APPLICATION/ADOPTION → VERIFICATION
  → EVIDENCE METADATA → ASSESSMENT → DRIFT / EXCEPTION / ROLLBACK
```

Every stage after “ARMA API HUB” on the first path, and every stage on the
second path, is owned by the Compliance Core. The API Hub's role is limited to
carrying the signed request in and the bounded response out.

## 5. Transport-only boundary (enforced)

The API Hub side of the connection is composed of transport-only modules. Each
transport module is marked `TRANSPORT_ONLY` and must never become a Core
authority. The boundary is enforced by:

- the transport adapter (`packages/compliance-core-client`), which loads the
  real converged registries and refuses to operate unless every required
  contract is present (`assertContractsAvailable`);
- the readiness test (`tests/integration/compliance-core-readiness.test.ts`),
  which asserts the FINALIZED state and fails closed if a fabricated contract
  or a bypass path is introduced;
- the E2E test (`tests/integration/compliance-core-e2e.test.ts`), which runs the
  real Core governed pipeline, policy path, and legal path from the vendored
  fixture;
- the existing control-plane guards (service binding, scoped capability,
  destination allow list, kill switch).

## 6. The 12 authoritative converged contracts

The API Hub consumes exactly the 12 contracts named by the Core handoff
manifest. Each is `AVAILABLE` in Core `main` @ `c7ac04b` and consumed verbatim.

| # | Contract id | Lane | Core sources |
|---|-------------|------|--------------|
| 1 | onboarding-identity | Chat 1 | `onboardingState.ts`, `onboardingRegistry.ts`, `apiOnboarding.ts` |
| 2 | governed-service-request-response | Chat 2 | `serviceContract.ts`, `serviceDispatch.ts`, `registry/service/contract.json` |
| 3 | operation-registry | Chat 2 | `apiContract.ts`, `registry/service/operation-registry.json` |
| 4 | scope-registry | Chats 1–3 | `apiAuthorization.ts`, `registry/service/scope-registry.json` |
| 5 | failure-taxonomy | Chats 1,2,4 | `apiErrors.ts`, `registry/service/failure-taxonomy.json` |
| 6 | version-negotiation | Chats 1–2 | `apiVersion.ts`, `registry/service/version-negotiation.json` |
| 7 | replay-idempotency | Chats 1–2 | `idempotency.ts`, `apiRequest.ts`, `registry/service/idempotency-semantics.json` |
| 8 | policy-delivery-adoption-drift | Chat 3 | `delivery.ts`, `policyRelease.ts`, `registry/policy-lifecycle/handoffs.json` |
| 9 | legal-regulatory-change-transport | Chat 4 | `legalApi.ts`, `legalChangePipeline.ts`, `legal-change-transport.mjs` |
| 10 | audit-correlation | Chats 1–4 | `audit.ts`, `apiCorrelation.ts`, `onboardingAudit.ts` |
| 11 | credential-reference | Chat 1 | `onboardingRegistry.ts`, `apiService.ts` |
| 12 | health-readiness | Chat 2 | `apiHealth.ts`, `registry/service/health-readiness-contract.json` |

The registry counts consumed verbatim: 26 API/service operations, 11 governed
actions, 22 Core scopes, 8 Hub scopes, 18 service failure codes (17 mandated +
`NOT_FOUND`), governed API `v1` only.

## 7. Envelope mapping

The API Hub carries its own signed `ServiceRequestEnvelope`
(`packages/contracts/src/envelopes.ts`) for external callers. The governed
request to the Compliance Core is a **separate** envelope owned by the Core,
whose shape is `GovernedRequest` (`convex/lib/apiRequest.ts`). The API Hub
builds that envelope with `buildGovernedEnvelope` using the Core's exact field
names — nothing is renamed:

- signed fields (`SIGNED_FIELDS`): `apiVersion`, `tenantId`,
  `serviceIdentityId`, `productId`, `environment`, `action`, `resourceType`,
  `resourceId`, `timestamp`, `nonce`, `requestId`, `correlationId`,
  `idempotencyKey`, `payloadHash`;
- idempotency fields (`IDEMPOTENCY_FIELDS`) exclude `timestamp`, `nonce`,
  `requestId`, `correlationId`;
- signature: HMAC-SHA256 over the canonicalized (sorted-key) signed fields;
- freshness window 300000 ms; future skew 30000 ms;
- nonce pattern `^[A-Za-z0-9._:-]{16,128}$`; correlation/request id pattern
  `^[A-Za-z0-9._:-]{8,128}$`.

## 8. Identity, signing, integrity, and replay

- **Service identity.** The API Hub uses a real, registered service identity.
  Callers are bound to a server-derived service identity; a caller-supplied
  `serviceIdentityId` is never trusted. The Compliance Core independently
  verifies the governed request; the API Hub's identity is not a substitute for
  the Core's own authorization.
- **Signing / integrity.** The API Hub signs the exact bytes it forwards. A
  tampered body, path, timestamp, or nonce breaks verification.
- **Correlation.** Every request carries a correlation ID; causation IDs are
  preserved so a full chain can be reconstructed across both platforms.
- **Replay protection.** The API Hub enforces an anti-replay nonce window and a
  nonce registry. The Compliance Core independently enforces its own replay
  protection; a nonce is never reused across the boundary.
- **Idempotency.** Mutating operations carry a tenant-scoped idempotency key
  and a request hash. A replay of the same key with a different body is a
  conflict and fails closed.
- **Versioning.** The governed contract version is negotiated and checked. A
  version or contract mismatch fails closed (no silent downgrade).

## 9. Tenant / product / environment context

Every governed request carries tenant, product, and environment context. The
API Hub transports the context; the Compliance Core authorizes against it.
Cross-tenant, cross-product, and cross-environment access is denied by the
Core. The API Hub must never widen the context it was given, and must never
substitute one tenant/product/environment for another in transit.

## 10. Production identity and onboarding

The onboarding contract preserves the honesty invariants:

- `APPROVED != ACTIVE`;
- `PROVISIONED != VERIFIED`;
- `VERIFIED != CERTIFIED`.

Only an `ACTIVE` onboarding produces consumable traffic
(`producesConsumableTraffic` / `assertConsumableTraffic`). The API Hub must not
manufacture onboarding state, and must never treat transport success as Core
authorization. Credential material stays outside Git: only credential
*references* are stored; the boundary resolves the secret out-of-band.

## 11. Bounded failures and retry classification

- **Bounded failures.** Both platforms return bounded, machine-readable failure
  codes. Unknown Core codes fail closed to `INTERNAL_FAILURE`; raw internal
  error text is never surfaced.
- **Retry classification.** Failures are classified as retryable or terminal.
  Authentication, authorization, version, contract, replay, and idempotency
  conflicts are **terminal** (never retried). Transport unavailability and
  timeouts are **retryable** within a bounded budget.
- **Retry exhaustion.** Exhausted retries move to dead-letter with a bounded
  reason code; they are never silently dropped.
- **Fail closed.** When authority or security is uncertain, both platforms fail
  closed. The API Hub never “best-effort” forwards an unauthorized or
  unverifiable request.

## 12. Health and readiness

The API Hub exposes connector health and readiness for the Compliance Core
connection. Readiness aggregates fail-closed: if a required dependency is
unavailable, the connection reports `UNAVAILABLE` rather than `AVAILABLE`. The
Core health/readiness contract pins `complianceClaim: NONE` and
`certificationClaim: NONE` — a healthy connection is never a compliance or
certification verdict. Kill-switch state is reflected in every health report.

## 13. Legal-change transport (transport-only)

The API Hub consumes `FSTS-COMPLIANCE-CORE-API-HUB::LEGAL-CHANGE-TRANSPORT`
version `1.0.0` (`transportOnly: true`, `carriesComplianceAuthority: false`).
It carries legal-change notifications and preserves the Core pipeline
`DETECTED → REVIEW_REQUIRED → HUMAN_LEGAL_REVIEW → APPROVED_CANONICAL_UPDATE →
APPLICABILITY_REVIEW → CONTROL_POLICY_IMPACT_REVIEW`. There is **no automatic
legal enforcement**, **no AI-authored canonical law**, and **no unresolved
conflict auto-resolution**. Every notification must reference a Core-governed
operation (`assertNotificationRequiresCoreGovernance`) and must carry none of
the forbidden authority fields.

## 14. Secret management

- No secrets in GitHub. No private signing keys in the repository.
- The repository contains references and configuration only.
- Key material lives in deployment/platform secret storage; the API Hub stores
  key *references* (key IDs) and credential lifecycle state, never key material.
- The `.env.example` is sanitized; the secret scan gate fails closed on
  credential material. The only tolerated finding is the Core's own reference
  constant inside the vendored conformance fixture, which is explicitly scoped
  and documented in `scripts/secret-scan.mjs`.

## 15. Cost boundary (preserved)

The cost boundary is unchanged and must not be duplicated:

- **ARMA API Hub** owns external API / vendor / connector transport cost.
- **FSTS AI Hub** owns AI / model / token / agent execution cost.
- **REGIVANTA** owns profitability / margin / budget analysis.
- **Compliance Core** must not duplicate any of these systems.

The Compliance Core connection carries compliance requests and responses. It
does not carry vendor cost accounting, AI token accounting, or profitability
analysis, and the API Hub does not emit a second authoritative vendor charge.

## 16. Honesty invariants (never weakened)

`PASS != COMPLIANT`, `IMPLEMENTED != CERTIFIED`, `READY != CERTIFIED`,
`APPROVED != RELEASED`, `RELEASED != ADOPTED`, `RECEIVED != APPLIED`,
`APPROVED != ACTIVE`, `PROVISIONED != VERIFIED`, `VERIFIED != CERTIFIED`.

Transport success never manufactures `RECEIVED`, `APPLIED`, `VERIFIED`,
compliance, or certification. The policy lifecycle keeps `DRIFTED` and
`ROLLED_BACK` distinct from the happy path.

## 17. Finalization state

The integration is **FINALIZED**. Every required contract is `AVAILABLE` and
consumed verbatim from Core `main` @ `c7ac04b`. The finalization gate in
`contracts/compliance-core/intake-manifest.json` reports
`READY_FOR_PM_REVIEW`; PM merge authorization for PR #2 is pending. No merge is
performed by this lane.
