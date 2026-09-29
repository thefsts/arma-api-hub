// FSTS Compliance Core — Phase 6
// API Hub Contract — deterministic hashing + integrity utilities.
// ---------------------------------------------------------------------------
// Ownership: Phase 6 (packages/api-hub-contract). No sibling lane reads this.
// Rules enforced here:
//   * SHA-256 only, deterministic canonicalization (sorted object keys).
//   * Integrity/signature metadata covers stable envelope fields only — never
//     artifact contents, secrets, private keys, or signing key material.
//   * Correlation ids are DERIVED (32 lowercase hex) from envelope inputs —
//     never from wall-clock randomness — so identical inputs correlate
//     identically (determinism contract).
//   * HMAC-SHA256 is implemented purely so it runs identically in Node and in
//     the Convex V8 runtime. The KEY is always injected at call time; no key
//     material is ever stored in this repository.
// ---------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';

const CORRELATION_ID_HEX = 32;

/** Canonical JSON serialization: object keys sorted, no whitespace, UTF-8. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** SHA-256 hex digest of the canonical serialization of `value`. */
export function sha256Of(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** SHA-256 hex digest of a raw string (byte-exact, no canonicalization). */
export function sha256OfText(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** Byte length of the canonical serialization (used for size limits). */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), 'utf8');
}

/**
 * Deterministic record seal for an envelope/response. The `seal` field (when
 * present) is excluded from its own computation so seals are self-verifiable.
 */
export function sealOf(record) {
  if (record === null || typeof record !== 'object') {
    throw new Error('sealOf requires an object record');
  }
  const clone = {};
  for (const key of Object.keys(record)) {
    if (key === 'seal') continue;
    clone[key] = record[key];
  }
  return sha256Of(clone);
}

/**
 * Derived correlation id: 32 lowercase hex chars derived from the exact
 * envelope inputs. Deterministic — same inputs, same correlation id.
 */
export function deriveCorrelationId({ tenantId, productId, serviceIdentityId, action, requestId, referenceDate }) {
  const material = {
    tenantId: tenantId ?? null,
    productId: productId ?? null,
    serviceIdentityId: serviceIdentityId ?? null,
    action: action ?? null,
    requestId: requestId ?? null,
    referenceDate: referenceDate ?? null,
  };
  const hex = sha256OfText(`fsts-api-hub-contract-v1:${canonicalJson(material)}`);
  return hex.slice(0, CORRELATION_ID_HEX);
}

/**
 * HMAC-SHA256 over the canonical serialization of `value`, keyed by `key`.
 * The key is injected at call time and never persisted. Returns lowercase hex.
 */
export function hmacSha256(key, value) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('hmacSha256 requires a non-empty key (injected at call time)');
  }
  return createHmac('sha256', key).update(canonicalJson(value), 'utf8').digest('hex');
}

/** Constant-time-ish comparison of two hex digests (length + content). */
export function digestEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validate a sha256 hex digest (64 lowercase hex characters). */
export function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/** Validate a derived correlation id (32 lowercase hex characters). */
export function isCorrelationId(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}
