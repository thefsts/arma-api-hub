# Phase 9 — Chat 3 — FSTS Governed Product Integration Factory (SDK)

**Status:** DESIGN ONLY — awaiting Phase 8 convergence.
**Lane:** Phase 9 — Chat 3.
**Owner:** AI #3 (Full Stack Tech & Solutions LLC).
**Repository:** `thefsts/arma-api-hub`.

---

## 1. Why this document set exists

Every FSTS product that wants to reach the FSTS Compliance Core has, until now, hand-built the same security integration: identity binding, tenant binding, environment binding, scope declaration, request signing, freshness, nonce replay defence, idempotency, bounded error handling, retry classification, health reporting, and audit correlation. That duplication is both expensive and dangerous, because each hand-built integration is a fresh opportunity to weaken the boundary. This phase specifies a single reusable integration factory — a governed product client plus a deterministic onboarding manifest plus a conformance test kit — so that the secure path is the default path and cannot be quietly bypassed.

The factory is deliberately narrow. It does **not** contain Compliance Core authority. It does **not** open a direct Core connection. It does **not** decide compliance. It only makes the governed route — PRODUCT → GOVERNED PRODUCT CLIENT → ARMA API HUB → COMPLIANCE CORE — the easiest and only supported way for a product to integrate.

## 2. Starting-gate result (recorded honestly)

The Phase 9 directive required a hard starting gate: fetch the newest `thefsts/arma-api-hub` main, verify that the Phase 8 convergence PR (#5) is merged, and verify main CI is green. That gate was executed on 2026-11-04 and it **did not pass**:

| Check | Result |
| --- | --- |
| `origin/main` HEAD | `356d00bdbc57b43859e6d9f641eb7c124306545f` (2026-09-29, "Phase 7: Final Compliance Core ↔ ARMA API Hub Integration") |
| Phase 8 convergence PR #5 | **OPEN / DRAFT**, `mergedAt: null`, `mergeCommit: null`, head `phase8/chat5-hub-convergence` |
| Main CI | Green (run 36527482634), but on the un-converged `356d00b` |
| Other open Phase 8 PRs | #3 (`phase8/arma-product-onboarding`, DRAFT), #4 (Chat 3 registration isolation, DRAFT), #6 (`phase8/api-hub-integration-review`, DRAFT) |

Because convergence has **not** landed, the directive's conditional applies verbatim: **"If Phase 8 convergence has not landed: DESIGN ONLY. Do not create implementation code against old main."** This document set is therefore a design specification. It contains no runtime TypeScript wired into the build, no schema changes to `convex/`, and no implementation that would race or conflict with the Phase 8 convergence branches. It is additive, non-conflicting, and safe to hold until convergence lands.

## 3. What is in this design package

| File | Purpose |
| --- | --- |
| `README.md` | This overview, gate result, and index. |
| `manifest.schema.json` | The deterministic, secret-free JSON Schema (2020-12) for the onboarding manifest. |
| `01-PACKAGE-API-DESIGN.md` | The governed product client package/API design: layers, primitives, and secure-by-default invariants. |
| `02-ONBOARDING-MANIFEST-SCHEMA.md` | The deterministic manifest standard, field-by-field, with canonicalization and hashing rules. |
| `03-REFERENCE-ADAPTERS.md` | How ARMA System 360, PATCHES, Law Shield, and QUALIVANTA are represented without weakening their boundaries. |
| `04-CONFORMANCE-TEST-KIT.md` | The 23-area conformance suite every future product must pass. |
| `05-MIGRATION-ONBOARDING-GUIDE.md` | The step-by-step onboarding path for a new product. |
| `06-FUTURE-PRODUCTS.md` | Design for later onboarding of Operon CRM, SafePlay Network, PortalServexa, PlayRaise, ARMA Cannabis/ACSL, and Euphoric LS. TAYA is intentionally excluded. |
| `reference-adapters/*.manifest.json` | Four reference manifests, each validated against `manifest.schema.json`. |

## 4. The one architectural rule

> **PRODUCT → GOVERNED PRODUCT CLIENT → ARMA API HUB → COMPLIANCE CORE.**

The SDK is the *governed product client*. It is a thin, opinionated, fail-closed wrapper that produces a signed governed envelope and hands it to the API Hub. The Hub is the only transport. The Core is the only authority. There is no second path, and the package is designed so that adding one is structurally awkward rather than merely discouraged.

## 5. Honesty statement about validation

Because this is a design-only deliverable, the usual implementation metrics (unit-test count, build, typecheck of new runtime code, SBOM of new dependencies, dependency audit of new packages, exact-head CI of implementation) do **not** apply and are **not** claimed. What *is* real and verifiable for this package:

- The four reference manifests are validated against `manifest.schema.json` with a real JSON Schema validator (all four **VALID**).
- The design files are formatted and secret-scanned with the repository's existing tooling.

No test count, build artefact, SBOM, or CI result is fabricated. See `04-CONFORMANCE-TEST-KIT.md` §8 and the final report for the precise, honest status.

## 6. Definition of done for the eventual implementation phase

When Phase 8 convergence lands, this design converts into implementation with no change of intent: a `@fsts/governed-product-client` package (or an extension of the existing `@arma/sdk`), a `governed-product-manifest` contract with the schema in this folder, a `@fsts/governed-product-conformance` kit, and one reference adapter per product. The conformance suite in `04` is the acceptance gate for that implementation.
