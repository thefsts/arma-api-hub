# Reuse Assessment — ARMA API Hub Phase 0

## Method

This assessment inspects the FSTS GitHub organization (`thefsts`) for existing
source that the ARMA API Hub can reuse. Each repository was checked for
availability, then the available repositories were cloned and read. For every
reusable pattern the assessment records the source repository, the reusable
pattern, the required changes before it can live in the API Hub, the security
concerns it carries, and the API Hub destination (the package or app that will
own it).

Repositories that could not be reached are reported as unavailable. No pattern
is attributed to a repository that could not be read, and no source is invented.

## Repository availability

| Repository | Visibility | Status | Notes |
| --- | --- | --- | --- |
| `arma-api-hub` | Public | Available | This repository. Baseline `main` at `3a8dd30a9c7cf0f531d4ff9793c654cdae2afacd`. |
| `arma-partner-api-sandbox` | Public | Available | Rich reference implementation: signing, envelopes, receipts, redaction, retry, durable processor, registry, telemetry. |
| `fsts-ai-hub` | Public | Available | README only; no reusable source. |
| `operon-marketing` | Public | Available | Marketing site; no control-plane source. |
| `TAYA` | Public | Available | Product repository; not inspected for control-plane reuse in Phase 0. |
| `TAYA-Website` | Public | Available | Marketing site; no control-plane source. |
| `thefsts.github.io` | Public | Available | Organization site; no control-plane source. |
| `arma-system-360` | — | Unavailable | Not reachable (404). |
| `arma-lawshield` | — | Unavailable | Not reachable (404). |
| `operon-crm` | — | Unavailable | Not reachable (404). |
| `fsts-compliance-core` | — | Unavailable | Not reachable (404). |
| `qualivanta` | — | Unavailable | Not reachable (404). |
| `regivanta` | — | Unavailable | Not reachable (404). |

Six of the requested source repositories are unavailable. Their internal
patterns cannot be assessed and are not assumed. If they become available, a
follow-up reuse pass should be scheduled before Phase 1 implementation lanes
that depend on them.

## Reusable patterns

The following patterns were observed in `arma-partner-api-sandbox` and are
relevant to the API Hub. Each row records the source, the pattern, the required
changes, the security concerns, and the destination.

| Source repo | Reusable pattern | Required changes | Security concerns | API Hub destination |
| --- | --- | --- | --- | --- |
| `arma-partner-api-sandbox` (`shared/sdk/canonical.ts`) | Canonical request string and HMAC signing over method, path, timestamp, nonce, and body hash. | Re-implement in TypeScript strict mode; make the algorithm versioned and replaceable; add timing-safe comparison and a bounded clock-skew window. | Must never log the secret or the raw signature; must reject malformed inputs fail-closed. | `packages/crypto` |
| `arma-partner-api-sandbox` (`shared/sdk/correlation.ts`) | Correlation and causation identifier propagation. | Formalize as a strict contract object carried by every envelope. | Correlation IDs must be opaque and must not encode tenant or customer identifiers. | `packages/contracts` (`correlationContextSchema`) |
| `arma-partner-api-sandbox` (`shared/sdk/idempotency.ts`) | Idempotency key handling with request-hash binding. | Model as a repository contract with FRESH/DUPLICATE/CONFLICT resolution and a durable unique index. | A partial write must never poison the registry; resolution must be transactional with the outcome. | `packages/database`, `packages/contracts` |
| `arma-partner-api-sandbox` (`shared/sdk/errors.ts`) | Standard error shape with machine codes and retryability. | Adopt as the only error shape returned to callers; restrict context to allow-listed scalars. | Error context must never carry payload content, secrets, or customer data. | `packages/contracts` (`apiErrorSchema`) |
| `arma-partner-api-sandbox` (`shared/sdk/health.ts`) | Connector health reporting with per-dependency status. | Extend to a fail-closed aggregation with kill-switch state and criticality. | Health reports must not leak internal topology or credentials. | `packages/contracts` (`connectorHealthReportSchema`) |
| `arma-partner-api-sandbox` (`shared/sdk/audit.ts`) | Audit event emission for control-plane actions. | Model as an append-only audit table and a signed receipt. | Audit records must be tamper-evident and must not store protected payloads. | `packages/database`, `packages/contracts` |
| `arma-partner-api-sandbox` (`shared/registry/partnerRegistry.ts`) | Partner/service registry with lifecycle and capability scoping. | Generalize to FSTS products, client systems, partners, services, capabilities, connections, and contract versions; add explicit ownership classification. | Unknown entities must fail closed; PlayRaise must never be classified as FSTS-owned. | `packages/contracts` (`registry.ts`) |
| `arma-partner-api-sandbox` (`shared/observability/telemetry.ts`) | Structured telemetry with redaction. | Re-implement as an allow-list plus deny-list plus secret-value detection. | Raw secrets, signatures, credentials, and protected payloads must never reach a log line. | `packages/observability` |
| `arma-partner-api-sandbox` (`law-shield/arma/envelope.js`) | Signed envelope construction. | Re-implement as strict, versioned TypeScript contracts with unknown-field rejection. | Envelopes must carry references, never key material. | `packages/contracts`, `packages/sdk` |
| `arma-partner-api-sandbox` (`law-shield/arma/signer.js`) | Request signing helper. | Fold into the crypto package behind a single interface; never store the secret. | Browser and mobile clients must not use privileged signing. | `packages/crypto`, `packages/sdk` |
| `arma-partner-api-sandbox` (`law-shield/arma/receiptVerifier.js`) | Signed receipt verification. | Model as a strict receipt contract with subject type, status, and hashes. | Receipts must bind a delivery to its outcome without exposing payloads. | `packages/contracts` (`signedReceiptSchema`) |
| `arma-partner-api-sandbox` (`law-shield/arma/redaction.js`) | Redaction of sensitive fields before logging. | Re-implement with an allow-list, a deny-list, and registered secret-value detection. | Redaction must be structural, not best-effort. | `packages/observability` |
| `arma-partner-api-sandbox` (`law-shield/arma/retryPolicy.js`) | Retry policy with backoff. | Re-implement with an explicit schedule and a failure classification that distinguishes clean retryable, ambiguous, and terminal failures. | Ambiguous outcomes must never be blindly retried; an accepted side effect must never be duplicated. | `apps/worker` (`retry.ts`) |
| `arma-partner-api-sandbox` (`law-shield/lawshield/durable/processor.js`) | Durable job processor with retry and dead-letter handling. | Re-implement as a pure function of (job, handler) so it is deterministically testable. | Dead-lettering must be durable and observable; retries must be bounded. | `apps/worker` (`processor.ts`) |
| `arma-partner-api-sandbox` (`law-shield/lawshield/durable/store.js`) | Durable store abstraction for jobs. | Model as a queue contract with an in-memory implementation for local development and tests. | The in-memory implementation must never be used in production. | `apps/worker` (`queue.ts`) |
| `arma-partner-api-sandbox` (`package.json`, `.env.example`, `.github/workflows/ci.yml`) | Workspace tooling, sanitized environment template, and CI workflow. | Re-implement for Node 24, pnpm workspaces, Turborepo, and strict TypeScript; keep the environment template sanitized and fail-closed. | The environment template must contain placeholders only; CI must run secret scanning. | Repository root, `.github/workflows` |

## Patterns deliberately not reused

Some patterns observed in the sandbox are intentionally not carried forward.
The sandbox is a partner-facing demonstration environment; several of its
conveniences are inappropriate for a control plane. Specifically, any pattern
that would allow a browser or mobile client to hold a privileged credential,
any pattern that would let the control plane make a compliance, legal, payment,
dispatch, or AI decision, and any pattern that would let one product read
another product's database are excluded by the locked platform boundary.

## Security concerns carried forward

Every reused pattern carries at least one of the following concerns, all of
which are addressed in the API Hub implementation and in the threat model:

- Secret material must never be persisted, logged, or returned. The API Hub
  stores key references only; key material is provisioned out of band.
- Signatures must be compared in constant time and bounded by a clock-skew
  window, with nonce replay protection.
- Envelopes must be strict: unknown fields are rejected so contract drift and
  accidental field leakage are impossible.
- Redaction must be structural: an allow-list of safe keys, a deny-list of
  forbidden keys, and detection of registered secret values.
- Retries must distinguish clean retryable failures from ambiguous and terminal
  failures so that side effects are never duplicated.
- Unknown entities, inactive lifecycles, missing capabilities, tenant
  mismatches, and engaged kill switches must all fail closed.

## Conclusion

The `arma-partner-api-sandbox` provides a strong reference for signing,
envelopes, receipts, redaction, retry, durable processing, registry, and
telemetry. Those patterns are re-implemented in the API Hub as strict,
versioned, secret-free TypeScript. The six unavailable repositories cannot be
assessed and are reported as unavailable. No pattern was invented.
