// FSTS Compliance Core — Phase 6
// API Hub Contract — API version negotiation.
// ---------------------------------------------------------------------------
// The Hub and Core negotiate a mutually supported API version. An unsupported
// requested version fails closed. Negotiation always selects the HIGHEST
// mutually supported version (deterministic, no preference from the caller).
//
// TRANSPORT-ONLY (locked): this module is the API HUB TRANSPORT-side reference
// implementation of API version negotiation. It does NOT replace, duplicate,
// weaken, or bypass the Core's authoritative API-version gate
// (convex/lib/apiVersion.ts). The Hub transports a wire version; the Core
// decides against its own governed version.
// ---------------------------------------------------------------------------

export const TRANSPORT_ONLY = true;
export const TRANSPORT_ROLE = 'API_HUB_TRANSPORT_REFERENCE';

import { SUPPORTED_API_VERSIONS } from './constants.mjs';

/** Parse "MAJOR.MINOR.PATCH" into a comparable tuple; null when malformed. */
export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Negotiate an API version. `supported` defaults to the contract's supported
 * set. Returns { ok, apiVersion, code }.
 */
export function negotiateVersion(requested, supported = SUPPORTED_API_VERSIONS) {
  const req = parseVersion(requested);
  if (!req) {
    return { ok: false, apiVersion: null, code: 'VERSION_UNSUPPORTED' };
  }
  const parsed = supported
    .map((v) => ({ raw: v, tuple: parseVersion(v) }))
    .filter((v) => v.tuple !== null)
    .sort((a, b) => cmp(a.tuple, b.tuple));
  const exact = parsed.find((v) => cmp(v.tuple, req) === 0);
  if (exact) {
    return { ok: true, apiVersion: exact.raw, code: null, negotiated: false };
  }
  // No exact match: choose the highest supported version sharing the requested
  // MAJOR (backward-compatible within a major), else fail closed.
  const sameMajor = parsed.filter((v) => v.tuple[0] === req[0]);
  if (sameMajor.length > 0) {
    const highest = sameMajor[sameMajor.length - 1];
    return { ok: true, apiVersion: highest.raw, code: null, negotiated: true };
  }
  return { ok: false, apiVersion: null, code: 'VERSION_UNSUPPORTED' };
}

/** Fail-closed assertion used by generators/verifiers. */
export function assertVersionNegotiable(requested, supported = SUPPORTED_API_VERSIONS) {
  const result = negotiateVersion(requested, supported);
  if (!result.ok) {
    throw new Error(`VERSION_NEGOTIATION_FAILED: requested "${requested}" has no mutually supported version`);
  }
  return result;
}
