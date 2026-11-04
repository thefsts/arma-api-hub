# 04 — Conformance Test Kit Specification

**Package (proposed):** `@fsts/governed-product-conformance`
**Purpose:** the suite every future product must pass before the Hub will route its traffic. It is the acceptance gate for any product that adopts the governed product client.

---

## 1. Shape of the kit

The kit is a black-box harness. It is given a product's `createGovernedProductClient` factory, its manifest, a synthetic tenant, and a controllable fake Hub/Core transport. It then runs 23 conformance areas and produces a machine-readable `ConformanceReport` with per-area PASS/FAIL and evidence (the bounded result observed for each case). A product that fails any area is **not routable**; the Hub onboarding must not be advanced to `ACTIVE`.

The kit reuses the deterministic test doubles already proven in Task B (`createFakeHubCoreTransport`, `evaluateOnboarding`) and the Phase 8 worker tests (`governed-dispatch`, `replay-idempotency-cost`, `route-envelope-binding`). It does not require a live Core.

## 2. The 23 conformance areas

Each area below states what it proves, the adversarial case, and the required fail-closed outcome. "Fail closed" means a bounded denial, never a silent success and never a widened request.

### C1 — No direct Core access
**Proves:** the client has no path to the Core except the injected Hub transport.
**Case:** attempt to construct a client without a transport; attempt to reach a Core/Convex URL; scan the package dependency graph.
**Required:** construction fails without a transport; no Core/Convex dependency is present; any direct-Core attempt is a compile/runtime error, not a fallback.

### C2 — Identity binding
**Proves:** the client calls as its bound service identity only.
**Case:** supply a `routingIdentity` different from the manifest; tamper the envelope's `serviceIdentityId`.
**Required:** `PRODUCT_DENIED` / `IDENTITY_INVALID`; never forwarded.

### C3 — Tenant binding
**Proves:** a product cannot act for another tenant.
**Case:** construct with a tenant not in the onboarding's allowed tenants; swap `tenantId` in the envelope.
**Required:** `TENANT_ACCESS_DENIED` / `TENANT_DENIED`; never forwarded.

### C4 — Product binding
**Proves:** a product cannot impersonate another product.
**Case:** set `productId` to another product's id; reuse another product's manifest.
**Required:** `PRODUCT_ISOLATION_VIOLATION` / `PRODUCT_DENIED`; never forwarded.

### C5 — Environment binding
**Proves:** no environment escalation.
**Case:** a DEVELOPMENT onboarding invoking PRODUCTION; an environment outside `supportedEnvironments`.
**Required:** `ENVIRONMENT_NOT_AUTHORIZED` / `ENVIRONMENT_DENIED`; never forwarded.

### C6 — Scope enforcement
**Proves:** only declared, bound scopes route.
**Case:** call an operation whose scope is not in `requiredHubScopes`; declare a scope not in the 8-scope registry.
**Required:** `SCOPE_VIOLATION` / `SCOPE_DENIED`; never forwarded.

### C7 — Operation enforcement
**Proves:** only declared operations route.
**Case:** invoke an operation not in `requiredOperations`; invoke an unknown operation id.
**Required:** `UNKNOWN_OPERATION`; never forwarded.

### C8 — Credential references only
**Proves:** the client holds a reference, never a secret.
**Case:** supply a high-entropy string / `BEGIN PRIVATE KEY` / bearer token as `credentialReference`; attempt to put a secret in the manifest.
**Required:** construction rejects secret-like material; manifest validation rejects `secretMaterial: true`; only references reach the transport.

### C9 — Signing / integrity
**Proves:** every request is signed over the exact bytes.
**Case:** strip the signature; alter one signed field after signing; alter the body after hashing.
**Required:** `INTEGRITY_FAILED` / `SIGNATURE_INVALID`; never forwarded.

### C10 — Freshness
**Proves:** stale requests are rejected.
**Case:** a timestamp outside the freshness window; a caller-supplied clock attempting to move the window.
**Required:** `STALE_REQUEST`; the trusted clock is server-authoritative and caller cannot influence it.

### C11 — Nonce replay
**Proves:** a nonce is single-use.
**Case:** replay a previously accepted envelope verbatim; reuse a nonce with a new request id.
**Required:** `REPLAY_DETECTED` / `REPLAY_DENIED`; never forwarded twice.

### C12 — Idempotency
**Proves:** retries do not duplicate side effects; conflicting reuse is caught.
**Case:** retry a `CLEAN_RETRYABLE` with the same idempotency key (expect one side effect); reuse an idempotency key with a different payload (expect conflict).
**Required:** one accepted side effect on retry; `IDEMPOTENCY_CONFLICT` on payload mismatch.

### C13 — Version mismatch
**Proves:** no silent downgrade.
**Case:** contract version mismatch; unsupported API version; a downgrade attempt.
**Required:** `UNSUPPORTED_VERSION`; never forwarded.

### C14 — Route mismatch
**Proves:** the resolved route matches the signed envelope on every authority-bearing field.
**Case:** a routing ALLOW whose route disagrees with the envelope on product/tenant/environment/identity/apiVersion/operation.
**Required:** `ROUTE_ENVELOPE_MISMATCH`, disposition TERMINAL; never forwarded.

### C15 — Suspension
**Proves:** a suspended integration fails closed.
**Case:** onboarding in `SUSPENDED`.
**Required:** `INTEGRATION_INACTIVE` / `IDENTITY_SUSPENDED`, disposition HELD; work preserved, not discarded.

### C16 — Revocation
**Proves:** a revoked integration fails closed and terminally.
**Case:** onboarding in `REVOKED`; service identity `REVOKED`; credential `REVOKED`.
**Required:** `INTEGRATION_INACTIVE` / `IDENTITY_REVOKED` / `CREDENTIAL_REVOKED`, disposition TERMINAL; dead-lettered.

### C17 — Kill switch
**Proves:** an engaged kill switch stops all outbound calls.
**Case:** product/service/tenant/global kill switch engaged.
**Required:** fail closed (`UPSTREAM_UNAVAILABLE` / `INTEGRATION_INACTIVE`), disposition HELD; no forward.

### C18 — Hub outage
**Proves:** a Hub outage is bounded and classified, not a verdict.
**Case:** transport throws / returns 503.
**Required:** `UPSTREAM_UNAVAILABLE`, `CLEAN_RETRYABLE` (pre-side-effect) or `AMBIGUOUS` (post-side-effect); never a compliance verdict.

### C19 — Core outage
**Proves:** a Core outage is bounded and classified.
**Case:** Hub reports Core dependency unavailable.
**Required:** `UPSTREAM_UNAVAILABLE` / `DEPENDENCY_UNAVAILABLE`; retry classification preserved; never a verdict.

### C20 — Bounded errors
**Proves:** only the 16 consumed failure codes surface; everything else collapses to `UPSTREAM_UNAVAILABLE`.
**Case:** transport throws a non-bounded error; Core returns an unknown code.
**Required:** `UPSTREAM_UNAVAILABLE`; no raw stack trace, no internal detail leaked.

### C21 — Audit / correlation
**Proves:** every request and result carries correlation and request ids.
**Case:** assert `correlationId` and `requestId` are present on success and failure; assert they propagate to the Core audit record.
**Required:** non-empty ids on every result; audit record correlates to the request.

### C22 — Raw evidence rejection
**Proves:** raw sensitive evidence is rejected by default.
**Case:** submit a payload containing raw sensitive fields (e.g. full device contents, raw PII blobs) where only metadata/reference is allowed.
**Required:** `VALIDATION_FAILED`; the client rejects raw sensitive evidence and requires a secure reference.

### C23 — False compliance claims
**Proves:** the client cannot manufacture or forward COMPLIANT/CERTIFIED.
**Case:** attempt to set a verdict field; include `COMPLIANT`/`CERTIFIED`/`AUTHORIZED`/`ATTESTED` in an evidence payload; attempt to read a verdict from a result.
**Required:** construction/type rejects a verdict field; payload guard rejects conclusion tokens; `GovernedResult` has no verdict field; no false claim can be produced.

## 3. Report format

```json
{
  "suiteVersion": "1.0.0",
  "productId": "patches",
  "integrationVersion": "1.0.0",
  "manifestHash": "<sha256>",
  "areas": [
    { "id": "C1", "name": "no-direct-core-access", "status": "PASS", "evidence": "..." },
    { "id": "C23", "name": "false-compliance-claims", "status": "PASS", "evidence": "..." }
  ],
  "summary": { "total": 23, "passed": 23, "failed": 0 },
  "result": "CONFORMANT"
}
```

`result` is `CONFORMANT` only when all 23 areas pass. A non-conformant report blocks onboarding advancement to `ACTIVE`. The report is not a compliance certification; it is an integration-conformance fact.

## 4. Adversarial discipline

Every area includes at least one *hostile* case, not just a happy path. The kit is designed so a product cannot pass by implementing the easy path and ignoring the boundary. The hostile cases mirror the Task B test suites (isolation, authorization, lifecycle, evidence-boundary, resilience) and the Phase 8 worker suites (governed-dispatch, replay-idempotency-cost, route-envelope-binding, onboarding-hardening, onboarding-hostile-records).

## 5. Determinism

The kit injects a fixed clock, a deterministic nonce generator, and a fake transport with scripted outcomes. No test depends on wall-clock time or network. The same manifest and the same client produce the same report every run.

## 6. What the kit does NOT test

- Product business logic (out of scope by design).
- Live Core behaviour (the kit uses a contract-faithful double).
- Performance/throughput (separate concern).
- Compliance correctness of the product (the kit tests *integration conformance*, never compliance).

## 7. Adoption gate

A product is routable only when: (a) its manifest validates against `manifest.schema.json`, (b) its conformance report is `CONFORMANT` on all 23 areas, and (c) its Hub onboarding is `ACTIVE` with a legal history. The kit is a necessary condition, not a sufficient one; the Hub routing gate and the Core onboarding gate remain authoritative.

## 8. Honest status in this phase

This is a **specification**, not a runnable suite, because the starting gate did not pass and no implementation code was written against old main. The 23 areas, cases, and required outcomes above are the exact acceptance criteria the eventual implementation must satisfy. No test count is claimed for a suite that was not executed. When convergence lands, the suite is implemented and its real pass count is reported.
