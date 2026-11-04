# 03 — Reference Adapters

**Purpose:** prove that the factory can represent the integration contracts of the four Phase 8 consumers — ARMA System 360, PATCHES, Law Shield, QUALIVANTA — without redesigning their business logic and without weakening any boundary. Each adapter is a manifest (data), not code. No product business logic is copied into the SDK.

---

## 1. What a "reference adapter" is and is not

A reference adapter is the **manifest + a thin mapping table** that says: "this product, under this identity, declares these operations and scopes, with this evidence classification and these retry/health expectations." It is a *representation of the integration contract*, not a re-implementation of the product.

It is **not**:

- a copy of the product's domain logic (PATCHES signal semantics, Law Shield legal reasoning, QUALIVANTA QA logic, ARMA 360 security operations);
- a change to the product's repository;
- a grant of authority;
- a claim that the product is compliant.

The adapter only proves the factory is expressive enough to carry the product's governed integration without flattening its distinct boundaries.

## 2. Identity and isolation table

| Product | productId | routingIdentity | productType | Environments | Ownership |
| --- | --- | --- | --- | --- | --- |
| ARMA System 360 | `arma-system-360` | `svc-arma-system-360` | SECURITY_OPERATIONS | PREVIEW, PRODUCTION | FSTS_OWNED |
| PATCHES | `patches` | `svc-patches-compliance-signals` | PRIVACY | PRODUCTION | FSTS_OWNED |
| Law Shield | `arma-law-shield` | `svc-lawshield-compliance-assurance` | LEGAL_ASSURANCE | PRODUCTION | FSTS_OWNED |
| QUALIVANTA | `qualivanta` | `svc-qualivanta-verification` | QUALITY_ASSURANCE | PREVIEW, PRODUCTION | FSTS_OWNED |

Each `productId` is distinct, each `routingIdentity` is distinct, and the 1:1 binding between them is enforced by the Hub registry (Phase 8 PR #4/#5 isolation tests). Sharing a *scope name* (e.g. `evidence.metadata.write`) is shared vocabulary, not shared authority: the Hub binds each scope to a specific product/tenant/service identity, and the routing gate compares the live request against that product's own onboarding record.

## 3. ARMA System 360

**Role:** the first and broadest Phase 8 consumer — a security-operations platform that records observations, submits verification executions, records verification results, reads readiness, and records evidence metadata.

**Manifest:** `reference-adapters/arma-system-360.manifest.json`.

- Operations: `evidence.record`, `observation.record`, `verification.execution.submit`, `verification.result.record`, `readiness.snapshot.get`.
- Hub scopes: `evidence.metadata.write`, `verification.submit`, `compliance.read`, `telemetry.write`.
- Evidence: `maxClassification: PROTECTED`, `evidenceSensitive: true`, `rawSensitiveEvidence: false`, `referenceOnly: true`.
- Health: `readiness.snapshot.get` against `compliance-core.health.readiness.v1`.

**Boundary preserved:** ARMA 360's own security operations, alerting, and evidence vault remain its own. The adapter carries only the *governed integration surface* — the operations it sends to the Core through the Hub. The factory does not absorb ARMA 360's operational logic.

**Status:** ARMA System 360 does not yet have a governed integration package in its repository (verified read-only: `thefsts-arma-system-360-platform` has evidence/onboarding domain code but no Core governed client). Its adapter is therefore a **design-level representation** of the intended contract, not a wiring of existing code. This is honest: the factory can represent it; the implementation will follow when ARMA 360 adopts the SDK.

## 4. PATCHES

**Role:** privacy-first platform. Integration is **compliance-relevant signals and evidence references only**; privacy and anti-surveillance are preserved; the Core never absorbs PATCHES application logic.

**Manifest:** `reference-adapters/patches.manifest.json`.

- Operations: `evidence.record`, `observation.record`.
- Hub scopes: `evidence.metadata.write`, `telemetry.write`.
- Evidence: `maxClassification: CONFIDENTIAL`, `evidenceSensitive: true`, `rawSensitiveEvidence: false`, `referenceOnly: true`.
- Rotation: `ROTATE_ON_COMPROMISE` (privacy posture).

**Boundary preserved:** the PATCHES controlled-onboarding package (Task B, `packages/compliance-onboarding`) already enforces: 8 signal descriptors (PT-01..PT-08 → FSTS-PRIV-* controls), `FORBIDDEN_SIGNAL_FIELDS`, and `FORBIDDEN_CONCLUSION_TOKENS`. The manifest's metadata-only, reference-only evidence classification matches that package exactly. The factory does not move PATCHES signal semantics into the SDK; it carries the already-governed signal as an `evidence.record` envelope.

**Status:** implemented in PATCHES (Task B), represented here as a manifest.

## 5. Law Shield

**Role:** independent legal-assurance product. Integration is **compliance/legal-assurance references only**. Law Shield is **not** the canonical regulatory authority; its custody/evidence responsibility is distinct from Core legal authority; and **no event is an automatic legal approval**.

**Manifest:** `reference-adapters/lawshield.manifest.json`.

- Operations: `evidence.record`, `evidence.get`.
- Hub scopes: `evidence.metadata.write`, `compliance.read`, `telemetry.write`.
- Evidence: `maxClassification: REGULATED`, `evidenceSensitive: true`, `rawSensitiveEvidence: false`, `referenceOnly: true`.

**Boundary preserved:** the Law Shield controlled-onboarding package (Task B) already enforces: `CANONICAL_REGULATORY_AUTHORITY = 'COMPLIANCE_CORE'`, `CUSTODY_RESPONSIBILITY = 'LAW_SHIELD'`, `ASSURANCE_REVIEW_STATES = ['NEEDS_REVIEW','IN_REVIEW','REFERRED']` (no approved state), `FORBIDDEN_LEGAL_AUTHORITY_FIELDS`, `FORBIDDEN_CONCLUSION_TOKENS` (incl. `LEGAL_APPROVAL`, `LEGALLY_APPROVED`, `LEGAL_CLEARANCE`, `LEGAL_SIGNOFF`, `REGULATORY_APPROVAL`), and `assertNotAutomaticLegalApproval`. The manifest's REGULATED, reference-only classification preserves that boundary. The factory never turns a Law Shield assurance reference into a legal conclusion, and the `GovernedResult` type has no verdict field.

**Status:** implemented in Law Shield (Task B), represented here as a manifest.

## 6. QUALIVANTA

**Role:** AI-powered software quality, QA automation, release intelligence, and production verification. It submits verification executions, records verification results, and records evidence metadata.

**Manifest:** `reference-adapters/qualivanta.manifest.json`.

- Operations: `verification.execution.submit`, `verification.result.record`, `evidence.record`.
- Hub scopes: `verification.submit`, `evidence.metadata.write`, `telemetry.write`.
- Evidence: `maxClassification: CONFIDENTIAL`, `evidenceSensitive: true`, `rawSensitiveEvidence: false`, `referenceOnly: true`.

**Boundary preserved:** QUALIVANTA's QA automation, release intelligence, and production verification remain its own. The adapter carries only the governed verification/evidence surface. A QUALIVANTA "PASS" is a QA result, not a compliance verdict; the factory's `GovernedResult` cannot express a compliance verdict, so the two cannot be conflated.

**Status:** QUALIVANTA does not yet have a governed integration package (verified read-only: `thefsts/qualivanta` has an evidence page but no Core governed client). Its adapter is a **design-level representation**.

## 7. What the four adapters collectively prove

1. **Expressiveness.** One schema carries four genuinely different products with different operation sets, scope sets, evidence classifications, environments, and rotation postures.
2. **Isolation.** Four distinct productIds and four distinct routing identities; shared scope *names* are vocabulary, not authority.
3. **Boundary preservation.** PATCHES stays privacy/metadata-only; Law Shield stays reference-only with no legal authority and no automatic approval; ARMA 360 and QUALIVANTA keep their domain logic out of the SDK.
4. **No business-logic absorption.** Not one line of product domain logic appears in any adapter. The adapters are declarations, not ports.

## 8. Future adapters

The same pattern extends to Operon CRM, SafePlay Network, PortalServexa, PlayRaise, ARMA Cannabis/ACSL, and Euphoric LS (see `06-FUTURE-PRODUCTS.md`). TAYA is intentionally excluded and must not be added unless the PM changes scope.
