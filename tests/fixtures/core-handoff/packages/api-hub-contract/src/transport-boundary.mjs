// FSTS Compliance Core — Phase 6 (Chat 5) — API HUB TRANSPORT CONTRACT.
//
// TRANSPORT BOUNDARY ASSERTIONS.
//
// The API Hub owns EXTERNAL API TRANSPORT only. This module asserts the locked
// boundary between the Hub's transport-side reference primitives and the
// AUTHORITATIVE Compliance Core governed pipeline (Chat 1,
// convex/lib/apiPipeline.ts -> runGovernedPipeline).
//
// It exists so a future edit cannot silently promote a transport-side primitive
// into a competing/parallel Core engine (auth, authorization, idempotency,
// rate limiting, version gating, audit). The Hub transports; the Core decides.
// ---------------------------------------------------------------------------

import * as gateway from './gateway.mjs';
import * as auth from './auth.mjs';
import * as idempotency from './idempotency.mjs';
import * as ratelimit from './ratelimit.mjs';
import * as version from './version.mjs';
import * as legalChangeTransport from './legal-change-transport.mjs';
import { assertCoreBoundaryConsumed } from './core-boundary.mjs';

// The transport-side reference modules. Each MUST carry the transport-only
// marker and MUST NOT be presented as a Core authority.
export const TRANSPORT_MODULES = Object.freeze({
  gateway,
  auth,
  idempotency,
  ratelimit,
  version,
  legalChangeTransport,
});

// Concerns the Core owns and the Hub MUST NOT re-implement authoritatively.
export const CORE_OWNED_CONCERNS = Object.freeze([
  'compliance-authority-state',
  'applicability',
  'controls',
  'verification',
  'evidence-metadata',
  'policy-governance',
  'legal-regulatory-governance',
  'release-adoption-state',
  'drift',
  'rollback',
  'core-authorization',
  'core-idempotency',
  'core-audit-linkage',
  'tenancy-authority',
]);

// Concerns the Hub owns (transport only).
export const TRANSPORT_OWNED_CONCERNS = Object.freeze([
  'external-api-transport',
  'connectors',
  'webhooks',
  'delivery',
  'retry-execution',
  'external-vendor-rate-limits',
  'quotas',
  'vendor-api-usage-transport',
  'api-cost-telemetry-transport',
]);

/**
 * Assert every transport-side module is marked transport-only and that the
 * authoritative Core boundary is consumable. Throws (fail-closed) otherwise.
 */
export function assertTransportBoundary() {
  for (const [name, mod] of Object.entries(TRANSPORT_MODULES)) {
    if (mod.TRANSPORT_ONLY !== true) {
      throw new Error(`transport module "${name}" is missing the TRANSPORT_ONLY marker`);
    }
    if (mod.TRANSPORT_ROLE !== 'API_HUB_TRANSPORT_REFERENCE') {
      throw new Error(`transport module "${name}" has an unexpected TRANSPORT_ROLE`);
    }
  }
  // The authoritative Core boundary must be consumable (no parallel engine).
  assertCoreBoundaryConsumed();
  return true;
}
