# 01 — Package / API Design

**Package (proposed):** `@fsts/governed-product-client`
**Relationship to existing code:** additive. It reuses the transport-only primitives already proven in `@arma/compliance-core-client` (`buildGovernedEnvelope`, `validateGovernedEnvelope`, `computeRequestSignature`, `canonicalize`, `hashPayload`, `classifyCoreFailure`, `createGovernedDispatcher`) and the Hub-side routing gate proven in `convex/lib/productRouting.ts` (`decideRouting`). It does not fork them. When convergence lands, the shared primitives move to a single source of truth and this package consumes them.

---

## 1. Layering

The factory is five thin layers. Each layer has one job, and each layer fails closed.

```
┌──────────────────────────────────────────────────────────────┐
│  L5  Product application code (business logic — NOT in SDK)   │
├──────────────────────────────────────────────────────────────┤
│  L4  GovernedProductClient  (this package)                    │
│      configure → validate manifest → authenticate → envelope  │
│      → send → bounded response → retry → health → audit       │
├──────────────────────────────────────────────────────────────┤
│  L3  Governed envelope + integrity primitives                 │
│      canonicalize · hashPayload · sign · validate · nonce     │
├──────────────────────────────────────────────────────────────┤
│  L2  Manifest validator + identity/tenant/env/scope binder    │
├──────────────────────────────────────────────────────────────┤
│  L1  Transport seam (injected) — the API Hub HTTP boundary    │
└──────────────────────────────────────────────────────────────┘
```

The product never imports L1 or L3 directly. It constructs an L4 client from a manifest and a small set of non-secret configuration values, and calls high-level methods such as `client.recordEvidence(...)`. The client owns envelope construction, signing, freshness, nonce, idempotency, retry classification, and health.

## 2. Public API surface

```ts
// The only constructor a product is allowed to use.
export function createGovernedProductClient(config: {
  manifest: GovernedProductManifest;          // validated, secret-free
  environment: Environment;                    // must be in manifest.supportedEnvironments
  tenantId: string;                            // bound to the onboarding, not chosen freely
  credentialReference: string;                 // a REFERENCE; never the secret
  transport: HubTransport;                     // injected; the only egress seam
  clock?: () => number;                        // server-authoritative; never caller-supplied per request
  resolveCredential?: (ref: string) => Promise<ResolvedCredential>; // Hub-side resolution
}): GovernedProductClient;
```

The client exposes one governed method per declared operation, generated from the manifest, plus operational methods:

```ts
interface GovernedProductClient {
  // Generated, one per manifest.requiredOperations. Calling an undeclared
  // operation is a compile-time error AND a runtime fail-closed.
  readonly operations: Readonly<Record<OperationId, GovernedOperation>>;

  health(): Promise<HealthReport>;
  readonly identity: GovernedIdentity;         // read-only, frozen descriptor
}
```

Each `GovernedOperation` accepts a bounded, typed payload and returns a `GovernedResult`:

```ts
type GovernedResult<T> =
  | { ok: true; data: T; correlationId: string; requestId: string }
  | { ok: false; code: BoundedFailureCode; retryable: boolean;
      ambiguous: boolean; correlationId: string; requestId: string };
```

A `GovernedResult` is **never** a compliance verdict. `ok: true` means "the Core accepted the governed request", not "the subject is compliant". The result type deliberately has no `compliant`, `certified`, `approved`, or `verdict` field.

## 3. The governed primitives

The directive enumerates the primitives the client must own. Each is a first-class, non-optional part of the envelope and is validated before any byte leaves the process.

| Primitive | Owned by | Binding / invariant |
| --- | --- | --- |
| Product identity | manifest + onboarding | `productId` must equal the onboarding's `productId`; a mismatch fails closed. |
| Service identity reference | manifest `hubRoute.routingIdentity` | Bound 1:1 to `productId` by the Hub registry; the client may not invent one. |
| Tenant binding | onboarding | The client is constructed with a tenant that must be in the onboarding's allowed tenants. |
| Environment | manifest + config | Must be in `supportedEnvironments`; no escalation to a higher environment. |
| API Hub route | manifest `hubRoute` | There is exactly one route; there is no direct-Core route. |
| Contract version | manifest | Exact match; a mismatch fails closed (no silent downgrade). |
| API version | manifest | Negotiated from the supported set; downgrade requires a new manifest. |
| Scope declaration | manifest `requiredHubScopes` | Every operation's scope must be declared; undeclared scope fails closed. |
| Operation declaration | manifest `requiredOperations` | Only declared operations are callable. |
| Credential reference | config + onboarding | A reference only; secret material is structurally rejected. |
| Correlation ID | client | Server-derived per request; propagated to Core for audit. |
| Request ID | client | Unique per attempt; used for idempotent replay detection. |
| Idempotency key | client | Derived from operation + tenant + stable business key; stable across retries. |
| Nonce | client | Fresh, URL-safe, 20–128 chars; single-use; replay rejected. |
| Freshness / timestamp | client (trusted clock) | Server-authoritative; stale requests rejected. |
| Request signing / integrity | client | HMAC-SHA256 over the 14 SIGNED_FIELDS; body hash bound. |
| Bounded response handling | client | Only the 16 CONSUMED_FAILURE_CODES are surfaced; everything else is `UPSTREAM_UNAVAILABLE`. |
| Retry handling | client | CLEAN_RETRYABLE auto-retries; AMBIGUOUS reconciles; HELD preserves; TERMINAL dead-letters. |
| Health reporting | client | Health is operational, never a verdict; stale health is UNKNOWN. |
| Evidence references | client | Metadata + secure reference only; raw sensitive evidence rejected. |

## 4. Secure-by-default invariants

The package is designed so that the following are **impossible or structurally awkward**, not merely discouraged. Each invariant is enforced at construction or at the envelope boundary.

1. **No Core authority.** The package has no type, field, or method that accepts a Core authority token, a Core verdict, or a Core signing key. The only credential it can hold is a *reference*; resolution happens Hub-side.
2. **No self-declared ACTIVE.** The client cannot set its own onboarding state. State is read from the Hub's durable onboarding record via the routing gate; the client only observes the bounded result.
3. **No forged tenant/product.** `productId` comes from the manifest; `tenantId` must be in the onboarding's allowed set; both are re-checked against the routing gate's resolved route before forwarding (defence in depth).
4. **No API Hub bypass.** The only egress is the injected `HubTransport`. There is no `fetchCore`, no Convex client, no database handle in the package. The package's `package.json` has no dependency that can reach the Core database.
5. **No integrity bypass.** Signing is not optional. There is no `sign: false` flag. A manifest cannot disable integrity; the envelope validator rejects an unsigned or mis-signed request before transport.
6. **No stale nonce reuse.** The client generates a fresh nonce per attempt and never caches one. Replay is detected Hub-side and surfaced as `REPLAY_DETECTED`.
7. **No silent version downgrade.** Contract and API versions are exact-match. A downgrade requires editing the manifest, which is a reviewed artefact.
8. **No credential material.** The manifest schema sets `credentialReference.secretMaterial` to `const false`; the client rejects any config value that looks like a secret (high-entropy, `PRIVATE KEY`, `BEGIN`, bearer tokens).
9. **No manufactured COMPLIANT/CERTIFIED.** The result type has no verdict field, and the client rejects any outbound payload containing conclusion tokens (`COMPLIANT`, `CERTIFIED`, `AUTHORIZED`, `ATTESTED`) in an evidence context, mirroring the Law Shield and PATCHES guards.

## 5. Construction-time validation sequence

`createGovernedProductClient` runs a fixed, fail-closed sequence before returning a usable client. Any failure throws a typed `GovernedClientConfigError` and no client is produced.

1. Validate the manifest against `manifest.schema.json` (structural, secret-free).
2. Assert `environment ∈ manifest.supportedEnvironments`.
3. Assert `manifest.hubRoute.directCoreAccess === false`.
4. Assert `credentialReference` is a reference, not secret material.
5. Assert every `requiredOperations` entry has a scope in `requiredHubScopes`.
6. Assert `tenantId` is non-empty and matches the tenant-binding pattern.
7. Freeze the client identity descriptor (read-only).
8. Return the client.

## 6. Runtime request sequence (per operation call)

1. Look up the operation in `manifest.requiredOperations`; if absent, fail closed (`UNKNOWN_OPERATION`).
2. Resolve the operation's scope; if not in `requiredHubScopes`, fail closed (`SCOPE_DENIED`).
3. Read the trusted clock; build `timestamp`, fresh `nonce`, `requestId`, `correlationId`.
4. Derive the idempotency key from operation + tenant + stable business key.
5. Canonicalize the payload; compute `payloadHash`.
6. Build the governed envelope over the 14 SIGNED_FIELDS; sign with HMAC-SHA256.
7. Validate the envelope locally (self-check) before transport.
8. Hand the envelope to the injected `HubTransport`, which routes through the Hub's `decideRouting` gate.
9. Classify the bounded response into `GovernedResult`; never into a verdict.
10. On failure, apply the retry classifier (see §7) and preserve correlation IDs.

## 7. Retry classification (shared vocabulary)

The client uses the exact four-way classification proven in the Phase 8 worker (`apps/worker/src/retry.ts`), so behaviour is consistent across Hub and product:

| Class | Meaning | Client behaviour |
| --- | --- | --- |
| `CLEAN_RETRYABLE` | Failed before any side effect. | Auto-retry on the manifest schedule. |
| `AMBIGUOUS` | Remote may have accepted. | **Never** blind-retry; surface for reconciliation. |
| `TERMINAL` | Permanently invalid (revoked, forged, unsupported version). | Dead-letter; do not retry. |
| `HELD` | Temporary governance condition (suspended, kill switch, dependency down). | Preserve work; do not consume retry budget; resume when released. |

## 8. Health reporting

`client.health()` returns a `HealthReport` with `status ∈ {HEALTHY, DEGRADED, UNHEALTHY, UNKNOWN}`, `observedAt`, `stalenessMs`, and `correlationId`. A report older than `manifest.healthExpectations.maxStalenessMs` is reported as `UNKNOWN`, never `HEALTHY`. Health is an operational signal and is explicitly typed so it cannot be confused with a compliance state.

## 9. What the package will NOT do

- It will not contain any product business logic (no PATCHES signal semantics, no Law Shield legal reasoning, no QUALIVANTA QA logic).
- It will not contain Compliance Core authority, scope tables beyond the consumed registry, or verdict logic.
- It will not open a direct Core connection, and it will not depend on a Convex client.
- It will not store or log secrets, raw sensitive evidence, or signing keys.
- It will not manufacture or forward COMPLIANT / CERTIFIED claims.

## 10. Implementation note (deferred)

This is a design. No runtime code is written in this phase because the starting gate did not pass. When convergence lands, the package is implemented against the converged main, and the conformance kit in `04-CONFORMANCE-TEST-KIT.md` is the acceptance gate. The design intentionally reuses existing, already-reviewed primitives so the implementation is assembly rather than invention.
