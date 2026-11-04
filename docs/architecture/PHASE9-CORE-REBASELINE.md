# PHASE 9 — CORE RE-BASELINE (Hub ↔ Core authority boundary)

**Status:** RE-BASELINE PASSED — NO MATERIAL CONTRACT CONFLICT
**Hub repo:** `thefsts/arma-api-hub`, branch `phase9/api-hub-production-operations`
**Core authority:** `thefsts/FSTS-COMPLIANCE-CORE` `main` = `2c8574d00cb235547fa5ae0b5b50e5ab6ac80c40`
**Hub's previously consumed pin:** Core `main` = `c7ac04b2d40624bef1742f819a9f7eee43e3d12c` (Phase 7 convergence, PR #30)
**Reference date:** 2026-09-16

This is a **read-only verification**. No Core implementation was vendored or copied into
the API Hub. Core remains the compliance authority; the Hub remains transport and
governance.

---

## 1. Method

1. `git fetch origin --prune` in the Core clone; `origin/main` advanced `4bf0c4b..2c8574d`.
2. Enumerated the Hub's consumed boundary from `contracts/compliance-core/intake-manifest.json`
   (12 required contracts) and `contracts/compliance-core/core-handoff/handoff-manifest.json`.
3. Diffed Core `c7ac04b..2c8574d` across the entire tree (20 files, +6,496 / −50).
4. Byte-compared (`sha256`) every vendored governed registry artifact in the Hub against
   Core `2c8574d`.
5. Inspected each new Phase 8 Core surface for Hub-side obligations.

## 2. Core change surface `c7ac04b..2c8574d`

```
.github/workflows/quality.yml                      |    1 +
convex/lib/apiErrors.ts                            |   29 +
convex/lib/assuranceBridge.ts                      |  957 ++++
convex/lib/authorization.ts                        |    5 +
convex/lib/integrationHealth.ts                    |  268 ++++
convex/lib/onboardingControlPlane.ts               |  383 ++++
convex/lib/onboardingManifest.ts                   |  357 ++++
convex/lib/rolloutControls.ts                      |  157 +++
convex/lib/versionCompatibility.ts                 |  160 +++
convex/onboardingControlPlane.ts                   |  829 ++++
convex/schema.ts                                   |  278 ++++
docs/PHASE8-ASSURANCE-BRIDGE.md                    |  217 ++++
docs/PHASE8-PRODUCT-ONBOARDING-CONTROL-PLANE.md    |  257 ++++
packages/api-hub-contract/src/assurance-transport.mjs | 293 ++++
packages/api-hub-contract/src/transport-boundary.mjs  |    2 +
scripts/typecheck.mjs                              |  176 +++
scripts/validate.mjs                               |  278 +++
tests/assurance-bridge.test.mjs                    |  614 ++++
tests/phase8-control-plane.test.mjs                | 1146 ++++
todo.md                                            |  139 ++-
```

**No file under `registry/` or `schemas/` changed.** The only `packages/api-hub-contract`
change is the additive registration of the new assurance transport module.

## 3. Byte-identical verification of the vendored governed registry

| Vendored artifact | Hub sha256 (16) | Core `2c8574d` sha256 (16) | Result |
|---|---|---|---|
| `registry/service/contract.json` | `dde95360c3c1626a` | `dde95360c3c1626a` | IDENTICAL |
| `registry/service/failure-taxonomy.json` | `ae5e4caaaeb58645` | `ae5e4caaaeb58645` | IDENTICAL |
| `registry/service/health-readiness-contract.json` | `8f3f97c5b6c866aa` | `8f3f97c5b6c866aa` | IDENTICAL |
| `registry/service/idempotency-semantics.json` | `fcd6e376b58b1de3` | `fcd6e376b58b1de3` | IDENTICAL |
| `registry/service/operation-registry.json` | `21124549f8eddae9` | `21124549f8eddae9` | IDENTICAL |
| `registry/service/scope-registry.json` | `9aa930f7de4b6fe2` | `9aa930f7de4b6fe2` | IDENTICAL |
| `registry/service/version-negotiation.json` | `ff52f935c2667754` | `ff52f935c2667754` | IDENTICAL |
| `registry/policy-lifecycle/handoffs.json` | `025946b392894c02` | `025946b392894c02` | IDENTICAL |

Registry counts at `2c8574d`: **26 operations / 11 governed actions**, **22 Core scopes / 8 Hub scopes** — unchanged from the consumed pin.

## 4. Verification matrix

| # | Boundary concern | Core evidence @ `2c8574d` | Verdict |
|---|---|---|---|
| 1 | Governed service contract / version | `registry/service/contract.json` + `version-negotiation.json` byte-identical; `convex/lib/serviceContract.ts`, `serviceDispatch.ts`, `service.ts` untouched | **MATCH** |
| 2 | Product onboarding / control-plane contract | New Core-owned `convex/onboardingControlPlane.ts`, `lib/onboardingControlPlane.ts`, `lib/onboardingManifest.ts`, `docs/PHASE8-PRODUCT-ONBOARDING-CONTROL-PLANE.md`. No governed registry change. Hub's `productOnboardings`/`productRouting` is a Hub **routing** registry, not a copy of Core's authority | **COMPATIBLE ADDITIVE CHANGE** |
| 3 | Service identity model | `lib/onboardingRegistry.ts`, `lib/apiService.ts` untouched. `lib/authorization.ts` +5 lines: Core-internal role permissions (`onboarding:manifest`, `:control`, `:health`, `:offboard`) | **COMPATIBLE ADDITIVE CHANGE** (Core-internal RBAC only) |
| 4 | Tenant / product / environment authority | Unchanged; Core remains authoritative. Hub continues to transport server-derived identity only | **MATCH** |
| 5 | Credential-reference / signing boundary | `lib/onboardingRegistry.ts`, `lib/apiService.ts` untouched. Hub stores key **references** only; no Core secret in products | **MATCH** |
| 6 | Correlation / trace requirements | `lib/apiCorrelation.ts`, `lib/audit.ts` untouched. Core `correlationId` unchanged. Hub-minted `traceId` is a Hub-governed transport identity layered **above** Core correlation — no collision | **MATCH** (additive Hub layer) |
| 7 | Failure taxonomy | Governed `failure-taxonomy.json` byte-identical: **18 codes / 17 mandated**. Core `lib/apiErrors.ts` internal enum gained 8 **implementation** codes (`PRODUCT_UNKNOWN`, `HUB_ROUTE_INVALID`, `CONTRACT_VERSION_STALE`, `ROLLOUT_BLOCKED`, `INTEGRATION_UNHEALTHY`, `HEALTH_TELEMETRY_INVALID`, `MANIFEST_INVALID`, `OFFBOARDING_INVALID`) that are **not** part of the governed taxonomy | **COMPATIBLE ADDITIVE CHANGE** — Hub must map unknown Core codes fail-closed to `INTERNAL_FAILURE`, never pass through |
| 8 | Health / readiness semantics | `health-readiness-contract.json` byte-identical (`HEALTHY\|DEGRADED\|UNHEALTHY`, `READY\|NOT_READY`, `complianceClaim=NONE`). Core Phase 8 adds `INTEGRATION_HEALTH_STATES = HEALTHY\|DEGRADED\|UNHEALTHY\|UNKNOWN`, admissions `ALLOW\|ALLOW_BOUNDED\|BLOCK`, and requires callers to submit **raw counters only — never a health state** | **COMPATIBLE ADDITIVE CHANGE** — requires an explicit Hub↔Core state mapping and forbids the Hub sending a derived state to Core |
| 9 | Policy transport | `registry/policy-lifecycle/handoffs.json` byte-identical; `lib/delivery*.ts` untouched | **MATCH** |
| 10 | Legal transport | `packages/api-hub-contract/src/legal-change-transport.mjs` untouched | **MATCH** |
| 11 | Assurance bridge | New `packages/api-hub-contract/src/assurance-transport.mjs` (+293), registered in `transport-boundary.mjs`; `TRANSPORT_ONLY = true`, `FORBIDDEN_ASSURANCE_AUTHORITY_FIELDS`, `assertNoTransportLoop` | **COMPATIBLE ADDITIVE CHANGE** — no Phase 9 obligation; Hub does not consume it yet |
| 12 | Usage / cost telemetry handoff | `registry/api-hub/usage-telemetry.json` + `schemas/api-hub-usage-telemetry.schema.json` unchanged. Not vendored in the Hub | **COMPATIBLE ADDITIVE CHANGE** — Hub `transportCostRecords` must align **only** at the governed handoff boundary |
| 13 | Rollout / kill-switch semantics | New Core `lib/rolloutControls.ts` (`PAUSED\|KILLED` → `ROLLOUT_BLOCKED`), kill-switch evaluated **before** health so `HEALTHY` can never override `KILLED`. Hub `convex/killSwitches.ts` is a transport-level control, not the rollout authority | **COMPATIBLE ADDITIVE CHANGE** — Core owns rollout; Hub must not assert rollout state |

**DRIFT-BLOCKERS: 0.**

## 5. Consequences folded into the Phase 9 implementation

1. **Failure-code mapping.** Hub keeps its closed 18-code taxonomy for transport
   observations. A Core response carrying a code outside that set is projected to
   `INTERNAL_FAILURE` (fail-closed), never passed through as a new Hub code.
2. **Health-state mapping (no conflation).** Hub operational states
   (`AVAILABLE / DEGRADED / UNAVAILABLE / UNKNOWN`) describe **Hub transport
   dependencies**. Core integration health (`HEALTHY / DEGRADED / UNHEALTHY /
   UNKNOWN`) describes a **Core-governed integration**. The mapping is documented and
   one-directional; the Hub never submits a derived state to Core — only raw counters.
3. **`UNKNOWN` is terminal-negative.** Hub `UNKNOWN` and Core `UNKNOWN` both fail
   closed. Neither may silently become healthy.
4. **Cost telemetry boundary.** `transportCostRecords` stays Hub-owned
   (`costOwner = API_HUB`) for external API / connector / webhook / messaging /
   transport / storage cost. Model/token/agent cost belongs to the AI Hub;
   profitability/margin belongs to REGIVANTA Cost Guard. A projection to the Core
   `api-hub-usage-telemetry` handoff shape is a boundary adapter, not a second
   authority.
5. **Rollout is Core-owned.** Hub observations may *record* `killSwitchEngaged` as an
   observed transport fact; the Hub never asserts `ROLLOUT_BLOCKED` as its own
   decision.

## 6. Verdict

`RE-BASELINE PASSED — NO MATERIAL CONTRACT CONFLICT — CONTINUE PHASE 9 IMPLEMENTATION`
