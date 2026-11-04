# POST-PHASE-8 CONTRACT RECONCILIATION AMENDMENTS

**Document ID:** `FSTS-GOVERNED-PRODUCT-AMENDMENTS`
**Amendment record version:** `1.0.0`
**Status:** APPROVED BY PM — IMPLEMENTATION AUTHORIZED
**Owner:** FSTS Platform / Chat 3 (AI #3)
**Applies to:** the FSTS Governed Product Integration Factory / SDK

---

## 0. Why this record exists

The Governed Product Integration Factory design was frozen at baseline
`4ac26e0477c55924ccb9203b373a312d73358135` (design PR #7) **before** the
Phase 8 API Hub convergence landed on `main`.

When the design freeze was released for implementation, the first mandatory
step was to fetch the newest API Hub `main`
(`0d4a9405b900f6370b4506b60e165c38324fd55e`, exact-main CI SUCCESS) and
reconcile the frozen design against the **actually merged** Phase 8 contracts
rather than against the contracts the design had assumed.

That reconciliation found four material contract conflicts. Implementation was
**paused at the contract boundary** and a conflict report was filed
(`PHASE9-RECONCILIATION-CONFLICTS.md`). The PM reviewed the report and
**approved all four contract-driven amendments**.

This document records those amendments explicitly and truthfully.

### 0.1 What this document is NOT

- It is **not** a rewrite of history. The original design at `4ac26e0` did not
  contain these four provisions, and this record does not claim that it did.
- It is **not** a silent adaptation. Each amendment names the merged Phase 8
  contract that forced it, and quotes the authoritative vocabulary verbatim.
- It is **not** an expansion of authority. No amendment grants the product, the
  SDK, or the API Hub any authority that the Compliance Core does not already
  own.

### 0.2 Baseline preservation

| Artifact | Ref | Meaning |
| --- | --- | --- |
| Original approved design baseline | `4ac26e0477c55924ccb9203b373a312d73358135` | Frozen design, PR #7. **Preserved unchanged as the historical baseline.** |
| Phase 8 API Hub main at reconciliation | `0d4a9405b900f6370b4506b60e165c38324fd55e` | The merged contracts the design was reconciled *against*. |
| Phase 8 Compliance Core main at reconciliation | `2c8574d` (`c7ac04b2d40624bef1742f819a9f7eee43e3d12c` vendored registry) | Authoritative Core authority modules. |

The amendments below are additive corrections layered **on top of** `4ac26e0`.
`4ac26e0` remains the original approved design; this record is the approved
reconciliation delta.

---

## AMENDMENT 1 — Kill-switch / rollout scopes adopt Core's authoritative vocabulary

### Conflict

The frozen design declared a kill-switch scope vocabulary of
`PRODUCT | SERVICE | TENANT | GLOBAL`. The merged Phase 8 Core contract
`rolloutControls.ts` declares the authoritative rollout scope vocabulary as:

```
ROLLOUT_SCOPES = GLOBAL | PRODUCT | TENANT | ENVIRONMENT
```

`SERVICE` **does not exist** in the Core vocabulary. The design had invented a
scope that the authority does not recognise, and was **missing** `ENVIRONMENT`,
which the authority does recognise. A manifest could therefore declare a scope
that Core cannot evaluate, and could not declare the environment-scoped control
that Core can enforce.

### Amendment

1. The kill-switch / rollout scope vocabulary is adopted **verbatim** from Core:
   `GLOBAL | PRODUCT | TENANT | ENVIRONMENT`.
2. `SERVICE` is **removed**. It is not an authoritative rollout scope and is
   rejected by manifest validation and by the JSON schema enum.
3. Every **non-`GLOBAL`** scope (`PRODUCT`, `TENANT`, `ENVIRONMENT`) **requires**
   an explicit `scopeRef` identifying the product, tenant, or environment the
   control is bound to. A non-`GLOBAL` scope without `scopeRef` fails closed.
4. `GLOBAL` **must not** carry a `scopeRef`. A `GLOBAL` control with a
   `scopeRef` fails closed (it is a malformed control, not a narrower one).
5. **Core is not asked to change its vocabulary.** The SDK conforms to Core.

### Where implemented

- `contracts/governed-product/manifest.schema.json` — `killSwitch.scope` enum
  and the `scopeRef` conditional requirements.
- `packages/governed-product-client/src/constants.ts` —
  `KILL_SWITCH_SCOPES`, `SCOPES_REQUIRING_REF`.
- `packages/governed-product-client/src/manifest.ts` —
  `validateGovernedManifest` kill-switch branch.
- Conformance area **C17** (kill-switch) and the dedicated amendment tests
  (`ENVIRONMENT` rollout enforcement; rejection of `SERVICE`).

---

## AMENDMENT 2 — Version compatibility represents the complete compatibility dimensions

### Conflict

The frozen design carried a single governed version field
(`apiHubContractVersion`) plus the wire `apiVersion`. The merged Phase 8 Core
contract `versionCompatibility.ts` enforces a **version triple**:

```
CORE_API_VERSION              = "1.0.0"
SUPPORTED_API_CONTRACT_VERSIONS = ["1.0.0"]
SUPPORTED_API_HUB_VERSIONS      = ["1.0.0"]
SUPPORTED_CORE_VERSIONS         = ["1.0.0"]
assertVersionTripleCompatible(...)
assertApiHubRouteMatch(...)   -> HUB_ROUTE_INVALID | CONTRACT_VERSION_STALE
```

A manifest that declares only `apiHubContractVersion` cannot express which API
Hub implementation version and which Core version it was built against. Because
all three are currently `1.0.0`, the omission is invisible today — and would
become a silent, mis-routed, cross-version integration the moment any dimension
moves independently.

### Amendment

1. The manifest `hubRoute` represents the **complete** compatibility dimensions.
   It now carries **distinct** `apiHubVersion` and `coreVersion` fields **in
   addition to** the existing governed `apiHubContractVersion` and `apiVersion`.
2. The three dimensions are **never** treated as interchangeable merely because
   all currently equal `1.0.0`. Each is validated against its own supported set.
3. Compatibility **fails closed** on any unsupported, missing, or mismatched
   required version. A missing `apiHubVersion` or `coreVersion` is a hard
   rejection — not a default, not a wildcard, not an inference.
4. The compiler projects all three dimensions into the Core onboarding manifest
   (`integration.apiContractVersion`, `integration.apiHubVersion`,
   `integration.coreVersion`) so the Core's own triple check is exercised.

### Where implemented

- `contracts/governed-product/manifest.schema.json` — `hubRoute.required` gains
  `apiHubVersion` and `coreVersion`, each with a semver pattern.
- All four reference adapter manifests — `apiHubVersion: "1.0.0"`,
  `coreVersion: "1.0.0"`.
- `packages/governed-product-client/src/constants.ts` —
  `SUPPORTED_API_HUB_VERSIONS`, `SUPPORTED_CORE_VERSIONS`.
- `packages/governed-product-client/src/manifest.ts` — per-dimension validation.
- `packages/governed-product-client/src/compiler.ts` — triple projection.
- Conformance area **C13** (version mismatch) and the dedicated amendment tests
  (missing / mismatched Hub and Core versions).

---

## AMENDMENT 3 — Core owns authoritative integration health; the SDK is observational only

### Conflict

The frozen design allowed the product/SDK health surface to accept counters and
to present a health status derived from them. The merged Phase 8 Core contract
`integrationHealth.ts` establishes that **Core is the sole authority** for
integration-health derivation:

```
HEALTH_STATUSES            = HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN
HEALTH_ADMISSIONS          = ALLOW | ALLOW_BOUNDED | BLOCK
HEALTH_WINDOW_SIZE         = 20
MIN_HEALTH_SAMPLES         = 5
DEGRADED_FAILURE_RATE      = 0.25
UNHEALTHY_FAILURE_RATE     = 0.5
CONSECUTIVE_FAILURE_THRESHOLD = 5
```

Callers **submit counters only**. Core derives the state. An SDK that derives
`HEALTHY` from a locally computed success rate is manufacturing an authoritative
signal it does not own — and `HEALTHY` is one step away from being read as
`COMPLIANT`.

### Amendment

1. Core owns authoritative integration-health derivation. The SDK does not.
2. `client.health()` is **observational and read-only**. It reports what Core
   last observed, or `UNKNOWN`.
3. Products/SDK **may submit only permitted telemetry facts/counters**. They may
   **not** submit, assert, or manufacture `HEALTHY | DEGRADED | UNHEALTHY |
   UNKNOWN`.
4. A missing observation is `UNKNOWN`. A stale observation (older than the
   manifest's `maxStalenessMs`) is `UNKNOWN`. Staleness never degrades to
   "probably healthy".
5. `HEALTHY != COMPLIANT` is preserved explicitly: every health report carries
   `complianceClaim: 'NONE'` and `certificationClaim: 'NONE'`.

### Where implemented

- `packages/governed-product-client/src/health.ts` — `observeHealth` is purely
  reflective; `assertCountersNotState` rejects any input carrying a `status`.
- `packages/governed-product-client/src/client.ts` — `health()` delegates to
  `observeHealth`; there is no local derivation path.
- Conformance area **C15/C16** and the dedicated amendment tests (SDK/product
  cannot manufacture Core health).

---

## AMENDMENT 4 — ONE closed deterministic bounded denial mapping

### Conflict

The frozen design described "bounded errors" as a principle and enumerated a
bounded SDK failure vocabulary, but did not define a **total** function from the
authoritative Core denial set to that vocabulary. The merged Phase 8 Core
contract `apiErrors.ts` defines a closed **42-code** `API_ERROR_CODES` set, and
the Hub defines an 18-code failure taxonomy plus 8 routing-denial codes. Without
an explicit total mapping, an unmapped denial could surface as arbitrary
vocabulary, or — worse — be coerced into a success or a misleading generic
failure that flattens a security denial into an availability error.

### Amendment

1. Implement **ONE** closed deterministic Core → Hub/SDK denial mapping table.
2. **Every** known Phase 8 Core denial maps to an **explicitly defined** bounded
   SDK-facing failure and exactly one retry disposition.
3. The original Core denial code is **preserved** as structured `cause`/detail,
   so an auditor can see the true denial without the SDK surfacing unbounded
   vocabulary as the primary failure.
4. Materially different security/governance failures are **not flattened** into
   misleading meanings. Revocation is not "retry later". A tampered request is
   not "not found". A scope denial is not "internal error".
5. **Unknown or unmapped** Core denial **FAILS CLOSED**: it becomes
   `UPSTREAM_UNAVAILABLE` with disposition `TERMINAL`. It never becomes success,
   and never escapes as arbitrary/unbounded error vocabulary.
6. **Conformance tests prove mapping completeness** for the current
   authoritative Core denial set (`isDenialMappingComplete()` must be `true`,
   `unmappedDenialCodes()` must be empty), and prove fail-closed behaviour for an
   unknown code.

### The closed table

The authoritative table is
`packages/governed-product-client/src/denial-map.ts`. It is projected to the
reviewable artifact `contracts/governed-product/denial-mapping.json` by
`scripts/generate-denial-mapping.mjs`; a conformance test asserts the two agree.

Coverage: **42** Core denial codes + **17** Hub denial codes = **59** known
codes, collapsing to **57** unique table entries (the two codes that legitimately
share a name across the Core and Hub vocabularies — `IDEMPOTENCY_CONFLICT` and
`RATE_LIMITED` — are mapped once, identically).

| Core / Hub denial | Bounded SDK failure | Disposition |
| --- | --- | --- |
| `UNAUTHENTICATED` | `AUTHENTICATION_FAILED` | `TERMINAL` |
| `IDENTITY_INVALID` | `AUTHENTICATION_FAILED` | `TERMINAL` |
| `IDENTITY_REVOKED` | `INTEGRATION_INACTIVE` | `TERMINAL` |
| `IDENTITY_SUSPENDED` | `INTEGRATION_INACTIVE` | `HELD` |
| `CREDENTIAL_INVALID` | `AUTHENTICATION_FAILED` | `TERMINAL` |
| `TENANT_UNRESOLVED` | `TENANT_DENIED` | `TERMINAL` |
| `TENANT_ACCESS_DENIED` | `TENANT_DENIED` | `TERMINAL` |
| `FORBIDDEN` | `AUTHORIZATION_DENIED` | `TERMINAL` |
| `SCOPE_VIOLATION` | `SCOPE_DENIED` | `TERMINAL` |
| `PRODUCT_ISOLATION_VIOLATION` | `PRODUCT_DENIED` | `TERMINAL` |
| `ENVIRONMENT_NOT_AUTHORIZED` | `ENVIRONMENT_DENIED` | `TERMINAL` |
| `MALFORMED_PAYLOAD` | `VALIDATION_FAILED` | `TERMINAL` |
| `REQUEST_TAMPERED` | `INTEGRITY_FAILED` | `TERMINAL` |
| `REQUEST_STALE` | `STALE_REQUEST` | `TERMINAL` |
| `REQUEST_FUTURE` | `STALE_REQUEST` | `TERMINAL` |
| `NONCE_INVALID` | `INTEGRITY_FAILED` | `TERMINAL` |
| `NONCE_REPLAY` | `REPLAY_DENIED` | `TERMINAL` |
| `DUPLICATE_REQUEST` | `REPLAY_DENIED` | `TERMINAL` |
| `IDEMPOTENCY_CONFLICT` | `IDEMPOTENCY_CONFLICT` | `TERMINAL` |
| `UNKNOWN_API_VERSION` | `UNSUPPORTED_VERSION` | `TERMINAL` |
| `API_VERSION_UNSUPPORTED` | `UNSUPPORTED_VERSION` | `TERMINAL` |
| `CONTRACT_UNKNOWN` | `UNSUPPORTED_VERSION` | `TERMINAL` |
| `RATE_LIMITED` | `RATE_LIMITED` | `CLEAN_RETRYABLE` |
| `INTERNAL` | `UPSTREAM_UNAVAILABLE` | `AMBIGUOUS` |
| `ONBOARDING_NOT_APPROVED` | `INTEGRATION_INACTIVE` | `HELD` |
| `ONBOARDING_STATE_INVALID` | `INTEGRATION_INACTIVE` | `TERMINAL` |
| `ONBOARDING_FORGED` | `INTEGRATION_INACTIVE` | `TERMINAL` |
| `PRODUCT_NOT_APPROVED` | `PRODUCT_DENIED` | `HELD` |
| `INTEGRATION_INACTIVE` | `INTEGRATION_INACTIVE` | `HELD` |
| `CREDENTIAL_EXPIRED` | `CREDENTIAL_UNRESOLVED` | `TERMINAL` |
| `CREDENTIAL_REVOKED` | `CREDENTIAL_UNRESOLVED` | `TERMINAL` |
| `ROTATION_INVALID` | `CREDENTIAL_UNRESOLVED` | `TERMINAL` |
| `TENANT_BINDING_MISSING` | `TENANT_DENIED` | `TERMINAL` |
| `SCOPE_NOT_BOUND` | `SCOPE_DENIED` | `TERMINAL` |
| `PRODUCT_UNKNOWN` | `PRODUCT_DENIED` | `TERMINAL` |
| `HUB_ROUTE_INVALID` | `ROUTE_ENVELOPE_MISMATCH` | `TERMINAL` |
| `CONTRACT_VERSION_STALE` | `UNSUPPORTED_VERSION` | `TERMINAL` |
| `ROLLOUT_BLOCKED` | `INTEGRATION_INACTIVE` | `HELD` |
| `INTEGRATION_UNHEALTHY` | `UPSTREAM_UNAVAILABLE` | `HELD` |
| `HEALTH_TELEMETRY_INVALID` | `VALIDATION_FAILED` | `TERMINAL` |
| `MANIFEST_INVALID` | `VALIDATION_FAILED` | `TERMINAL` |
| `OFFBOARDING_INVALID` | `INTEGRATION_INACTIVE` | `TERMINAL` |
| `AUTHENTICATION_FAILED` | `AUTHENTICATION_FAILED` | `TERMINAL` |
| `AUTHORIZATION_DENIED` | `AUTHORIZATION_DENIED` | `TERMINAL` |
| `TENANT_DENIED` | `TENANT_DENIED` | `TERMINAL` |
| `PRODUCT_DENIED` | `PRODUCT_DENIED` | `TERMINAL` |
| `ENVIRONMENT_DENIED` | `ENVIRONMENT_DENIED` | `TERMINAL` |
| `SCOPE_DENIED` | `SCOPE_DENIED` | `TERMINAL` |
| `REPLAY_DENIED` | `REPLAY_DENIED` | `TERMINAL` |
| `STALE_REQUEST` | `STALE_REQUEST` | `TERMINAL` |
| `INTEGRITY_FAILED` | `INTEGRITY_FAILED` | `TERMINAL` |
| `UNSUPPORTED_VERSION` | `UNSUPPORTED_VERSION` | `TERMINAL` |
| `UNKNOWN_OPERATION` | `UNKNOWN_OPERATION` | `TERMINAL` |
| `VALIDATION_FAILED` | `VALIDATION_FAILED` | `TERMINAL` |
| `DEPENDENCY_UNAVAILABLE` | `DEPENDENCY_UNAVAILABLE` | `CLEAN_RETRYABLE` |
| `INTERNAL_FAILURE` | `UPSTREAM_UNAVAILABLE` | `AMBIGUOUS` |
| `NOT_FOUND` | `VALIDATION_FAILED` | `TERMINAL` |
| **anything else** | `UPSTREAM_UNAVAILABLE` | `TERMINAL` (fail closed) |

### Where implemented

- `packages/governed-product-client/src/denial-map.ts` — authoritative table,
  `mapCoreDenial`, `isDenialMappingComplete`, `unmappedDenialCodes`.
- `contracts/governed-product/denial-mapping.json` — generated review artifact.
- `packages/governed-product-client/src/errors.ts` — `boundedFailure` factory
  derives `retryable`/`ambiguous` from disposition.
- Conformance areas **C19/C20** and the dedicated amendment tests (completeness,
  unknown-denial fail-closed).

---

## 0.3 Declaration defects discovered during implementation

Reconciliation was not limited to the four amendments. Implementing the
reference adapters exercised the frozen manifests against the generated
operation projection and surfaced two **unprovisionable declarations**:

| Manifest | Declared operation | Required Hub scope | Declared scopes |
| --- | --- | --- | --- |
| `arma-system-360` | `observation.record` | `compliance.write` | missing |
| `patches` | `observation.record` | `compliance.write` | missing |

Both manifests declared an operation whose required Hub scope they did not
declare. Such a manifest could never be provisioned — the Hub routing gate would
deny every `observation.record` call with `SCOPE_DENIED`. This was a declaration
defect in the frozen reference manifests, not a contract change.

**Correction:** `compliance.write` was added to the `requiredHubScopes` of
`arma-system-360` and `patches`. This is the **minimal** correction: it grants
only the scope the already-declared operation requires (`compliance.write` maps
to the single Core scope `runtime:write`), and grants no new operation. No
operation was added, removed, or made routable.

---

## 1. Effect on the frozen design

The frozen design's **authority boundaries, invariants, operation projection,
conformance areas, and vocabulary are unchanged**. Specifically, and explicitly:

- Product → governed SDK → API Hub → governed Core API → Compliance Core.
- No direct product → Core Convex access. No second auth/authz engine.
- No Core credentials in products. No uncontrolled long-lived Core secrets.
- No raw sensitive evidence by default. No manufactured compliance state.
- `PASS != COMPLIANT`. `HEALTHY != COMPLIANT`. Conformance `PASS` means
  conformant to the integration contract — never `COMPLIANT`, never `CERTIFIED`.
- The generated operation projection is **unchanged**: 26 Core operations,
  19 routable, 7 non-routable. The 7 non-routable operations remain
  unavailable; they were **not** made routable to simplify the SDK.

Only the four provisions above changed, and each changed **because a merged
Phase 8 contract required it**.

## 2. Verification

Each amendment is covered by dedicated tests in addition to its conformance
area:

| Amendment | Dedicated test |
| --- | --- |
| 1 | `ENVIRONMENT` rollout enforcement; `SERVICE` rejected as an authoritative rollout scope |
| 2 | missing `apiHubVersion`; missing `coreVersion`; mismatched Hub version; mismatched Core version |
| 3 | SDK/product cannot manufacture Core health; counters are not state; stale → `UNKNOWN` |
| 4 | mapping completeness over the 42-code Core set; unknown denial fails closed |

---

**Record status:** APPROVED — POST-PHASE-8 CONTRACT RECONCILIATION AMENDMENTS
**Original design baseline preserved:** `4ac26e0477c55924ccb9203b373a312d73358135`
