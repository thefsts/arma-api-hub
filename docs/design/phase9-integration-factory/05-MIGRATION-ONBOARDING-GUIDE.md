# 05 — Migration / Onboarding Guide

**Audience:** an engineering team onboarding a new FSTS product to the governed integration factory.
**Outcome:** a product that routes through PRODUCT → GOVERNED PRODUCT CLIENT → ARMA API HUB → COMPLIANCE CORE, passes all 23 conformance areas, and reaches an `ACTIVE` Hub onboarding with a legal state history.

---

## 0. Prerequisites

- The product has a distinct `productId` and will be assigned a distinct `routingIdentity` (service identity).
- The product owner/team and a non-secret `contactRef` are known.
- The product knows which Core operations and Hub scopes it genuinely needs (start minimal; widen only by re-review).
- Phase 8 convergence has landed (this guide assumes the converged main; it is the migration target, not old main).

## 1. Configure

Write the manifest (see `02-ONBOARDING-MANIFEST-SCHEMA.md`). Start from the closest reference adapter in `reference-adapters/` and change only what the product genuinely needs. Do not add operations or scopes "just in case" — every addition is a reviewed widening.

```jsonc
{
  "manifestVersion": "1.0.0",
  "integrationVersion": "1.0.0",
  "productId": "my-product",
  "displayName": "My Product",
  "productType": "OTHER_APPROVED",
  "ownership": "FSTS_OWNED",
  "owner": { "team": "My Team", "contactRef": "team@fsts.invalid", "function": "platform" },
  "supportedEnvironments": ["PRODUCTION"],
  "hubRoute": {
    "routingIdentity": "svc-my-product",
    "apiHubContractVersion": "1.0.0",
    "apiVersion": "1.0.0",
    "directCoreAccess": false
  },
  "requiredOperations": ["evidence.record"],
  "requiredHubScopes": ["evidence.metadata.write"],
  "credentialReference": {
    "required": true, "referenceScheme": "hub-keyid",
    "rotationExpectation": "ROTATE_ON_SCHEDULE", "secretMaterial": false
  },
  "evidenceClassifications": {
    "maxClassification": "CONFIDENTIAL", "evidenceSensitive": true,
    "rawSensitiveEvidence": false, "referenceOnly": true
  },
  "healthExpectations": {
    "healthOperation": "health.read",
    "readinessContractId": "compliance-core.health.readiness.v1",
    "maxStalenessMs": 300000
  },
  "retryExpectations": {
    "scheduleMs": [1000, 5000, 30000, 120000, 600000], "maxAttempts": 5,
    "ambiguousPolicy": "RECONCILE", "heldPolicy": "PRESERVE"
  },
  "killSwitch": { "required": true, "scope": "PRODUCT" },
  "conformance": { "suiteVersion": "1.0.0", "requiredAreas": [ /* all 23 */ ] }
}
```

## 2. Validate the manifest

Run the manifest through `manifest.schema.json` and compute its canonical hash (§4 of `02`). A manifest that does not validate is not reviewable. Record the hash; it is the reviewed identity of the integration.

## 3. Authenticate (reference, not secret)

Provision a credential **reference** (`hub-keyid` scheme). The product stores only the reference. The Hub resolves it to signing material Hub-side. The product must never hold, log, or transmit the secret. Confirm the reference is not high-entropy and does not contain `PRIVATE KEY`/`BEGIN`/bearer-token shapes.

## 4. Build the governed envelope

Construct the client from the manifest and the non-secret config:

```ts
const client = createGovernedProductClient({
  manifest,
  environment: 'PRODUCTION',
  tenantId: 'my-tenant',
  credentialReference: 'keyref-...',
  transport: hubTransport,          // injected; the only egress
  clock: () => Date.now(),          // server-authoritative
});
```

For each call, the client builds the envelope over the 14 SIGNED_FIELDS, computes the payload hash, signs with HMAC-SHA256, and self-validates before transport. The product does not construct envelopes by hand.

## 5. Send to the API Hub

The client hands the signed envelope to the injected `HubTransport`, which routes through the Hub's `decideRouting` gate. The gate checks onboarding presence, product/tenant/environment binding, `ACTIVE` state, legal history, credential reference, contract/API version, operation, scope, and routing identity — in that fail-closed order. Only an explicit ALLOW forwards to the Core.

## 6. Process the bounded response

The client returns a `GovernedResult`:

```ts
if (result.ok) {
  // The Core accepted the governed request. This is NOT a compliance verdict.
} else {
  // result.code is one of the 16 consumed failure codes (or UPSTREAM_UNAVAILABLE).
  // result.retryable / result.ambiguous drive the retry classifier.
}
```

Never read a verdict from the result. There is no verdict field. A product that needs to know a compliance state must query the Core through a governed read operation and treat the returned state as the Core's authority, not as its own conclusion.

## 7. Retry safely

Apply the four-way classifier:

- `CLEAN_RETRYABLE` → retry on `manifest.retryExpectations.scheduleMs`.
- `AMBIGUOUS` → do **not** blind-retry; route to reconciliation.
- `TERMINAL` → dead-letter; do not retry.
- `HELD` → preserve the work; do not consume the retry budget; resume when the control is released.

The idempotency key is stable across retries, so a retried `CLEAN_RETRYABLE` produces exactly one side effect.

## 8. Report health

Call `client.health()` on a schedule. A report older than `maxStalenessMs` is `UNKNOWN`, never `HEALTHY`. Health is operational; it is never a compliance state.

## 9. Audit and correlate

Every request and result carries `correlationId` and `requestId`. Propagate them into the product's own logs and into any downstream audit record. The Core audit record correlates to the same ids, so an end-to-end trace is possible without exposing secrets or raw evidence.

## 10. Onboard to the Hub (state machine)

The Hub onboarding follows the closed state machine:

```
PROPOSED → REVIEWED → APPROVED → PROVISIONED → VERIFIED → ACTIVE
```

with `SUSPENDED`/`REVOKED`/`REJECTED` as lifecycle exits. `APPROVED != ACTIVE`, `PROVISIONED != VERIFIED`, `VERIFIED != CERTIFIED`, and there is no `CERTIFIED` state. Only `ACTIVE` is consumable. The recorded history must be a legal walk from `PROPOSED`; a forged `ACTIVE` with no legal history is rejected by `decideRouting`.

## 11. Pass conformance

Run the conformance kit (`04`). The product is routable only when all 23 areas pass and the report is `CONFORMANT`. Attach the report to the onboarding review.

## 12. Go live

Advance the onboarding to `ACTIVE` only after: manifest validated, hash recorded, credential reference provisioned, conformance `CONFORMANT`, and the review approved. Then the Hub will route the product's traffic.

## 13. Migration from a hand-built integration

If a product already has a hand-built integration:

1. Inventory its operations, scopes, evidence handling, retry behaviour, and health reporting.
2. Express them as a manifest; anything it does that the schema cannot express is a design gap to raise, not a reason to bypass the factory.
3. Replace the hand-built envelope/signing/retry code with the client. Delete the direct Core connection if one exists (there should be none).
4. Run the conformance kit against the migrated client; it must pass all 23 areas.
5. Re-review and re-advance the Hub onboarding.

## 14. Common mistakes the factory prevents

- Adding a scope "just in case" → caught by review and by C6.
- Holding a secret instead of a reference → caught at construction and by C8.
- Blind-retrying an ambiguous outcome → caught by C12/C18.
- Reading a verdict from a transport result → impossible; no verdict field (C23).
- Declaring `ACTIVE` locally → impossible; state is read from the Hub onboarding (C15/C16).
- Reaching the Core directly → impossible; no Core dependency (C1).
