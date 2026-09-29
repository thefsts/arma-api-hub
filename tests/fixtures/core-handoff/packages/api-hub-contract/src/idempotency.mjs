// FSTS Compliance Core — Phase 6
// API Hub Contract — idempotency, replay protection, duplicate handling, races.
// ---------------------------------------------------------------------------
// Reuses the Chat 1 idempotency semantics (tenant scope participates in
// uniqueness; same key + same request hash replays the stored outcome; same key
// + different hash conflicts and fails closed). Adds the wire-level concerns
// the Hub contract needs: nonce replay ledger, duplicate delivery, and
// idempotency races (an identical request already IN_PROGRESS).
//
// TRANSPORT-ONLY (locked): this module is the API HUB TRANSPORT-side reference
// implementation of wire-level replay/duplicate handling. It REUSES (does not
// redefine) the Chat 1 idempotency semantics and does NOT replace, duplicate,
// weaken, or bypass the Core's authoritative idempotency + nonce ledger
// (convex/lib/apiPipeline.ts). The Hub transports; the Core decides.
// ---------------------------------------------------------------------------

export const TRANSPORT_ONLY = true;
export const TRANSPORT_ROLE = 'API_HUB_TRANSPORT_REFERENCE';

import { sha256OfText } from './hash.mjs';

/** Tenant-scoped idempotency key (matches Chat 1 buildIdempotencyKey shape). */
export function buildIdempotencyKey({ tenantId, scope, key }) {
  return `${tenantId}::${scope}::${key}`;
}

/** Deterministic request hash used to detect same-key/different-payload reuse. */
export function requestHash(envelope) {
  return sha256OfText(
    JSON.stringify({
      tenantId: envelope.tenantId,
      productId: envelope.productId,
      serviceIdentityId: envelope.serviceIdentityId,
      action: envelope.action,
      payloadHash: envelope.payloadHash,
    }),
  );
}

/**
 * Evaluate idempotency for an inbound request against a store of records.
 * `records` is a Map/array of { tenantId, scope, idempotencyKey, requestHash,
 * status, resultRef }. Returns a bounded decision:
 *   { decision: 'EXECUTE' | 'REPLAY' | 'CONFLICT' | 'IN_PROGRESS', resultRef }
 */
export function evaluateIdempotency({ envelope, records }) {
  const list = Array.isArray(records) ? records : [];
  const scope = envelope.action;
  const match = list.find(
    (r) =>
      r &&
      r.tenantId === envelope.tenantId &&
      r.scope === scope &&
      r.idempotencyKey === envelope.idempotencyKey,
  );
  if (!match) return { decision: 'EXECUTE', resultRef: null };

  const hash = requestHash(envelope);
  if (match.requestHash !== hash) {
    // Same key, different payload: fail closed, never overwrite.
    return { decision: 'CONFLICT', resultRef: null };
  }
  if (match.status === 'IN_PROGRESS') {
    // A race: an identical request is in flight. Do NOT execute a duplicate.
    return { decision: 'IN_PROGRESS', resultRef: null };
  }
  // Same key + same payload + completed: replay the stored outcome.
  return { decision: 'REPLAY', resultRef: match.resultRef ?? null };
}

/**
 * Replay protection: a nonce may be consumed exactly once per identity.
 * `seenNonces` is a Map/array of { serviceIdentityId, nonce }.
 */
export function evaluateNonce({ envelope, seenNonces }) {
  const list = Array.isArray(seenNonces) ? seenNonces : [];
  const hit = list.find(
    (n) => n && n.serviceIdentityId === envelope.serviceIdentityId && n.nonce === envelope.nonce,
  );
  if (hit) return { ok: false, code: 'REPLAY_DETECTED' };
  return { ok: true, code: null };
}

/** Record a consumed nonce (append-only ledger). */
export function consumeNonce({ envelope, now }) {
  return {
    serviceIdentityId: envelope.serviceIdentityId,
    nonce: envelope.nonce,
    consumedAt: now,
  };
}

/** Duplicate-delivery detection: identical requestId delivered twice. */
export function evaluateDuplicateDelivery({ envelope, deliveredRequestIds }) {
  const list = Array.isArray(deliveredRequestIds) ? deliveredRequestIds : [];
  if (list.includes(envelope.requestId)) {
    return { duplicate: true, code: 'REPLAY_DETECTED' };
  }
  return { duplicate: false, code: null };
}
