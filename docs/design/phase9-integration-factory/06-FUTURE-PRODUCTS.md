# 06 — Future Products Design

**Scope:** how the factory will represent later products **without onboarding them now**. This document is a design projection only. It creates no manifests for these products, touches no product repository, and grants no authority. It exists to prove the factory generalizes and to pre-empt the integration questions each product will raise.

**Explicit exclusion:** TAYA is **intentionally excluded** from this design. TAYA must not be introduced unless the PM changes scope.

---

## 1. Design rule for future products

Every future product follows the same four-step projection:

1. **Classify** — `productType`, `ownership` (FSTS_OWNED / CLIENT_OWNED / PARTNER_OWNED).
2. **Bound** — the minimal `requiredOperations` and `requiredHubScopes` the product genuinely needs.
3. **Preserve** — the product's own business boundary (what the factory must NOT absorb) and its evidence classification.
4. **Defer** — the manifest is written only when the product is actually onboarded; until then it is a projection.

A CLIENT_OWNED or PARTNER_OWNED product is never treated as FSTS-owned, is bound to its own tenants and routing identity, and cannot inherit an FSTS product's authority.

## 2. Projection table

| Product | productType | Ownership | Likely operations | Likely hub scopes | Boundary the factory must NOT absorb |
| --- | --- | --- | --- | --- | --- |
| Operon CRM | CRM | FSTS_OWNED | `evidence.record`, `observation.record`, `audit` via `telemetry.write` | `evidence.metadata.write`, `telemetry.write` | CRM business records, customer data model, sales pipeline logic |
| SafePlay Network | EVENTS (safety) | FSTS_OWNED | `evidence.record`, `observation.record`, `verification.execution.submit` | `evidence.metadata.write`, `verification.submit`, `telemetry.write` | Incident/safety operations, venue logic, member data |
| PortalServexa | CLIENT_PORTAL | CLIENT_OWNED | `evidence.record`, `compliance.read` (client-scoped) | `evidence.metadata.write`, `compliance.read` | Client portal content, per-client tenancy, client-owned data |
| PlayRaise | EVENTS (fundraising) | CLIENT_OWNED | `evidence.record`, `telemetry.write` | `evidence.metadata.write`, `telemetry.write` | Fundraising/event logic, donor data; PlayRaise is client-owned and never FSTS-owned |
| ARMA Cannabis/ACSL | CANNABIS_LOGISTICS | FSTS_OWNED | `evidence.record`, `observation.record`, `readiness.snapshot.get`, `verification.execution.submit` | `evidence.metadata.write`, `verification.submit`, `compliance.read`, `telemetry.write` | Custody/traceability workflow, retail/delivery/transport operations |
| Euphoric LS | EVENTS | FSTS_OWNED | `evidence.record`, `telemetry.write` | `evidence.metadata.write`, `telemetry.write` | Social-events/membership logic, community data |

These are projections, not commitments. The actual operation/scope sets are decided at onboarding review and must be minimal.

## 3. Per-product notes

### Operon CRM
CRM is the most likely to want broad read access. The factory's answer: CRM gets `evidence.metadata.write` and `telemetry.write` only. CRM business records stay in CRM. If Operon needs a compliance state, it uses a governed read operation (`compliance.read`) and treats the returned state as the Core's authority — never as its own conclusion. Operon's ownership is FSTS_OWNED, but its `productId` and routing identity are distinct from every other product.

### SafePlay Network
Safety/incident operations are evidence-sensitive. SafePlay projects `evidence.metadata.write` + `verification.submit` + `telemetry.write`, with `maxClassification: CONFIDENTIAL` or higher and `referenceOnly: true`. Raw incident media is not submitted; only metadata + secure reference. SafePlay's venue/member logic stays in SafePlay.

### PortalServexa
Client portal, **CLIENT_OWNED**. PortalServexa is bound to client tenants and cannot act for FSTS tenants. It projects `evidence.metadata.write` + a client-scoped `compliance.read`. The factory enforces tenant binding so a client portal cannot read another client's compliance state. PortalServexa never inherits FSTS product authority.

### PlayRaise
Fundraising/events, **CLIENT_OWNED**. PlayRaise is explicitly client-owned (the Hub registry's `NON_FSTS_OWNED_PRODUCTS` already includes `PlayRaise`). It projects a minimal `evidence.metadata.write` + `telemetry.write`. It must never be represented as FSTS-owned, and it must never receive an FSTS product's scopes. Donor/fundraising data stays in PlayRaise.

### ARMA Cannabis / ACSL
Cannabis logistics is the most compliance-heavy projection: custody, traceability, and regulated evidence. It projects `evidence.metadata.write`, `verification.submit`, `compliance.read`, `telemetry.write`, with `maxClassification: REGULATED` and `referenceOnly: true`. The factory carries the governed integration surface only; the custody/traceability workflow, retail/delivery/transport operations, and the operational system itself stay in ARMA Cannabis/ACSL. The factory must not become a second custody system, and it must not absorb the cannabis operational system's logic.

### Euphoric LS
Social events, FSTS_OWNED. Minimal projection: `evidence.metadata.write` + `telemetry.write`. Membership/community logic stays in Euphoric LS.

## 4. What is explicitly NOT done in this phase

- No manifest is created for any of these products.
- No product repository is touched.
- No Hub onboarding is created or advanced.
- No operation or scope is granted.
- TAYA is not introduced.

## 5. Generalization argument

The four reference adapters (`03`) already span security operations, privacy, legal assurance, and quality assurance. The six projections above add CRM, events/safety, client portal, fundraising, and regulated cannabis logistics. Across all ten, the same schema carries the integration because the factory models the *governed integration surface* — identity, tenant, environment, route, versions, scopes, operations, credential reference, evidence classification, health, retry, kill switch, conformance — and never the product's domain. That is the whole point of a factory: the security integration is written once, reviewed once, and reused, while each product keeps its own business logic and its own boundary.

## 6. When a future product is actually onboarded

Follow `05-MIGRATION-ONBOARDING-GUIDE.md`. The projection above becomes a real manifest, is validated, hashed, reviewed, bound to a Hub onboarding, and must pass all 23 conformance areas before the Hub routes its traffic. Until then, the projection is design only.
