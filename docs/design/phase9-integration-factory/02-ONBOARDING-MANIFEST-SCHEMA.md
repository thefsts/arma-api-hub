# 02 — Deterministic Onboarding Manifest Schema

**Artefact:** `manifest.schema.json` (JSON Schema 2020-12, in this folder).
**Purpose:** a deterministic, secret-free declaration by which a product declares how it connects to the Compliance Core through the ARMA API Hub.

---

## 1. Design principles

The manifest is a *declaration*, not a grant. It records what a product intends to do and the constraints under which it may do it. It never confers authority, never asserts a compliance state, and never carries secret material. Three properties make it a *deterministic standard*:

1. **Closed shape.** Every object is `additionalProperties: false`. An unknown field is a validation error, not a silently ignored hint. This prevents drift and prevents an attacker from smuggling a field (e.g. a `compliant: true`) into a reviewed artefact.
2. **Grounded vocabularies.** Enums are taken verbatim from the Core handoff registry (26 operations, 8 hub scopes, 5 data classifications, 3 environments, 3 ownership classes). The manifest cannot invent an operation or a scope that the Core does not know.
3. **Canonical form.** The manifest is serialized canonically (see §4) and hashed. Two manifests that differ only in whitespace or key order produce the same hash; any semantic change produces a different hash. The hash is the reviewed identity of the integration.

## 2. Field-by-field

| Field | Type | Required | Meaning and invariant |
| --- | --- | --- | --- |
| `manifestVersion` | string `const "1.0.0"` | yes | Schema version this document conforms to. |
| `integrationVersion` | semver string | yes | Version of the product's governed integration. Bump on any change to operations, scopes, route, or evidence classification. |
| `productId` | `^[a-z0-9][a-z0-9-]{2,63}$` | yes | Stable product identifier; unique across FSTS. |
| `displayName` | string 1–120 | yes | Human-readable name. Display only, never an authority input. |
| `productType` | enum | yes | Governed category; selects a conformance profile. Values: `SECURITY_OPERATIONS`, `PRIVACY`, `LEGAL_ASSURANCE`, `QUALITY_ASSURANCE`, `CRM`, `EVENTS`, `CLIENT_PORTAL`, `CANNABIS_LOGISTICS`, `OTHER_APPROVED`. |
| `ownership` | enum | yes | `FSTS_OWNED` \| `CLIENT_OWNED` \| `PARTNER_OWNED`. A client/partner product is never treated as FSTS-owned. |
| `owner` | object | yes | `{ team, contactRef, function }`. `contactRef` is a non-secret mailbox/alias, never a credential. `function ∈ {product-compliance, security, legal-assurance, quality, platform, operations}`. |
| `supportedEnvironments` | array of enum, ≥1, unique | yes | Subset of `DEVELOPMENT`, `PREVIEW`, `PRODUCTION`. A request in any other environment fails closed. |
| `hubRoute.routingIdentity` | serviceId pattern | yes | The service identity the product calls the Hub as. Bound 1:1 to `productId` by the Hub registry. |
| `hubRoute.apiHubContractVersion` | semver | yes | Exact-match Hub contract version; no silent downgrade. |
| `hubRoute.apiVersion` | enum `1.0.0` \| `1.1.0` | yes | Governed wire API version. |
| `hubRoute.directCoreAccess` | boolean `const false` | yes | Structural invariant: the client never opens a direct Core connection. |
| `requiredOperations` | array of 26 enum, ≥1, unique | yes | Exact Core operations the product may invoke. Any other operation fails closed at the routing gate. |
| `requiredHubScopes` | array of 8 enum, ≥1, unique | yes | Exact Hub scopes declared. The Hub maps each to Core scopes; unmapped/undeclared fails closed. |
| `credentialReference.required` | boolean `const true` | yes | Credentials are mandatory. |
| `credentialReference.referenceScheme` | `^[a-z][a-z0-9-]*$` | yes | Opaque non-secret scheme (e.g. `hub-keyid`). |
| `credentialReference.rotationExpectation` | enum | yes | `ROTATE_ON_SCHEDULE` \| `ROTATE_ON_COMPROMISE` \| `ROTATE_ON_EXPIRY`. |
| `credentialReference.secretMaterial` | boolean `const false` | yes | Structural invariant: the manifest never carries secret material. |
| `evidenceClassifications.maxClassification` | enum | yes | `PUBLIC` \| `INTERNAL` \| `CONFIDENTIAL` \| `PROTECTED` \| `REGULATED`. |
| `evidenceClassifications.evidenceSensitive` | boolean | yes | Whether the product emits evidence-sensitive records. |
| `evidenceClassifications.rawSensitiveEvidence` | boolean `const false` | yes | Raw sensitive evidence is not stored or submitted by default. |
| `evidenceClassifications.referenceOnly` | boolean `const true` | yes | Evidence is metadata + secure reference only. |
| `healthExpectations.healthOperation` | enum | yes | `health.read` \| `readiness.snapshot.get` \| `readiness.snapshot.record`. |
| `healthExpectations.readinessContractId` | pattern | yes | The readiness contract the health report follows. |
| `healthExpectations.maxStalenessMs` | integer 1000–86400000 | yes | Health older than this is `UNKNOWN`, never `HEALTHY`. |
| `retryExpectations.scheduleMs` | integer array 1–10 | yes | Backoff schedule. |
| `retryExpectations.maxAttempts` | integer 1–10 | yes | Retry budget. |
| `retryExpectations.ambiguousPolicy` | `const "RECONCILE"` | yes | Ambiguous outcomes are reconciled, never blind-retried. |
| `retryExpectations.heldPolicy` | `const "PRESERVE"` | yes | Held work is preserved, never discarded. |
| `killSwitch.required` | boolean `const true` | yes | The product must honour the kill switch. |
| `killSwitch.scope` | enum | yes | `PRODUCT` \| `SERVICE` \| `TENANT` \| `GLOBAL`. |
| `conformance.suiteVersion` | semver | yes | Conformance kit version. |
| `conformance.requiredAreas` | array of 23 enum, ≥23, unique | yes | The full conformance suite (see `04`). |

## 3. What the schema forbids by construction

- **Any secret material.** There is no `secret`, `key`, `privateKey`, `token`, or `password` field, and `additionalProperties: false` rejects one if added. `secretMaterial` and `rawSensitiveEvidence` are pinned to `false`; `referenceOnly` is pinned to `true`.
- **Any compliance assertion.** There is no `compliant`, `certified`, `approved`, or `verdict` field. A manifest cannot claim a compliance state.
- **Any direct Core route.** `directCoreAccess` is pinned to `false`; there is no `coreUrl` or `convexUrl` field.
- **Any invented operation or scope.** The enums are closed to the Core registry.
- **Any silent environment escalation.** `supportedEnvironments` is a closed enum and the client re-checks it at runtime.

## 4. Canonicalization and hashing

To make the manifest deterministic, the canonical form is defined as:

1. **UTF-8**, no BOM, `\n` line endings.
2. **Keys sorted** lexicographically at every level (RFC 8785 JSON Canonicalization Scheme semantics).
3. **Arrays sorted** where order is not semantically meaningful: `supportedEnvironments`, `requiredOperations`, `requiredHubScopes`, `conformance.requiredAreas`, `retryExpectations.scheduleMs`. Arrays whose order *is* meaningful (none currently) are documented explicitly.
4. **No insignificant whitespace** in the hashed form.
5. **Numbers** in shortest round-trippable form.

The **manifest hash** is `SHA-256(canonicalBytes)`, hex-encoded. The hash is recorded in the onboarding record and in the conformance report. Any semantic change to the manifest changes the hash, which forces re-review. This is what makes "the same security integration" auditable: the reviewed artefact has a stable identity.

## 5. Relationship to the Hub onboarding record

The manifest is the *product's* declaration. The Hub's durable onboarding record (`productOnboardings`, Phase 8 PR #3/#5) is the *Hub's* binding. They are related but not identical:

- The manifest declares `productId`, `routingIdentity`, `requiredOperations`, `requiredHubScopes`, `supportedEnvironments`, and `credentialReference.referenceScheme`.
- The onboarding record binds `productId`, `tenantId`, `environment`, `hubRoutingIdentity`, `allowedScopes`, `allowedOperations`, `credentialReference`, `contractVersion`, and `state` + `history`.

The Hub's `decideRouting` gate compares the live request against the onboarding record, not against the manifest. The manifest is the reviewed input that produces the onboarding record; the record is the runtime authority. A product cannot use its manifest to widen its onboarding. This separation is deliberate: the manifest is a declaration, the onboarding record is the binding, and only the routing gate decides.

## 6. Versioning

- `manifestVersion` changes only when the schema changes incompatibly.
- `integrationVersion` changes on any semantic change to the integration.
- A product that needs a new operation or scope must publish a new manifest with a bumped `integrationVersion`; the Hub onboarding must be re-reviewed and re-advanced to `ACTIVE` before the new operation routes. There is no "hot add".

## 7. Reference manifests

Four reference manifests live in `reference-adapters/` and are validated against this schema:

- `arma-system-360.manifest.json` — `SECURITY_OPERATIONS`, PROTECTED evidence, 5 operations.
- `patches.manifest.json` — `PRIVACY`, CONFIDENTIAL evidence, metadata-only, 2 operations.
- `lawshield.manifest.json` — `LEGAL_ASSURANCE`, REGULATED evidence, reference-only, 2 operations.
- `qualivanta.manifest.json` — `QUALITY_ASSURANCE`, CONFIDENTIAL evidence, 3 operations.

All four validate against `manifest.schema.json`. See `03-REFERENCE-ADAPTERS.md`.
