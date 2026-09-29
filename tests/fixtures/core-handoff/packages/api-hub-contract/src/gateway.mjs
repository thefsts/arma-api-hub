// FSTS Compliance Core — Phase 6
// API Hub Contract — governed request gateway (the contract in motion).
// ---------------------------------------------------------------------------
// processRequest is the single deterministic entry point that exercises the
// whole Compliance Core <-> API Hub contract for one inbound envelope:
//   structural validation -> integrity -> freshness -> version negotiation ->
//   authentication/authorization -> replay -> duplicate -> rate limit -> quota ->
//   idempotency -> safe degradation -> execution -> audit linkage -> telemetry.
//
// It is pure: given the same world + envelope + now, it returns the same
// response, audit linkage, telemetry record, and next world state. No clock, no
// network, no randomness. Every rejection is a bounded failure code.
//
// TRANSPORT-ONLY (locked): this gateway is the API HUB TRANSPORT-side reference
// implementation of the wire contract. It does NOT replace, duplicate, weaken,
// or bypass the authoritative Chat 1 governed pipeline
// (convex/lib/apiPipeline.ts -> runGovernedPipeline). The Hub transports; the
// Core decides. The authoritative boundary is consumed via src/core-boundary.mjs.
// ---------------------------------------------------------------------------

export const TRANSPORT_ONLY = true;
export const TRANSPORT_ROLE = 'API_HUB_TRANSPORT_REFERENCE';

import { validateEnvelope, verifyPayloadIntegrity, verifyFreshness, buildResponseEnvelope } from './envelope.mjs';
import { authenticate } from './auth.mjs';
import { evaluateNonce, evaluateDuplicateDelivery, evaluateIdempotency, requestHash, consumeNonce } from './idempotency.mjs';
import { evaluateRateLimit, evaluateQuota } from './ratelimit.mjs';
import { negotiateVersion } from './version.mjs';
import { planDegradation } from './degradation.mjs';
import { deriveAuditEventId } from './audit.mjs';
import { buildTelemetryRecord } from './telemetry.mjs';
import { sha256Of } from './hash.mjs';

function reject(code, extra = {}) {
  return { ok: false, code, ...extra };
}

/**
 * Process one inbound envelope.
 * `world` = {
 *   identities, idempotencyRecords, seenNonces, deliveredRequestIds,
 *   rateBuckets, quotaLedgers, dependencyStatuses, signingKey, period
 * }
 * Returns { response, audit, telemetry, nextState, executed }.
 */
export function processRequest({ world, envelope, now }) {
  const w = world ?? {};
  const correlationId = envelope && envelope.correlationId;
  const requestId = envelope && envelope.requestId;
  const action = envelope && envelope.action;

  const finish = (decision) => {
    const status = decision.ok ? (decision.degraded ? 'DEGRADED' : 'OK') : 'FAIL';
    const response = buildResponseEnvelope({
      correlationId,
      requestId,
      action,
      status,
      apiVersion: decision.apiVersion ?? null,
      resultRef: decision.resultRef ?? null,
      failureCode: decision.ok ? null : decision.code,
      retryAfterMs: decision.retryAfterMs ?? null,
      degraded: Boolean(decision.degraded),
      degradationMode: decision.degradationMode ?? 'NONE',
      auditEventRef: decision.auditEventRef ?? null,
      telemetryRef: decision.telemetryRef ?? null,
    });
    const audit = {
      auditEventId: deriveAuditEventId({ correlationId, requestId, action }),
      tenantId: envelope && envelope.tenantId,
      serviceIdentityId: envelope && envelope.serviceIdentityId,
      action,
      resourceType: 'apiHubExchange',
      resourceId: requestId,
      correlationId,
      requestId,
      status,
      failureCode: decision.ok ? null : decision.code,
      timestamp: now,
      source: 'packages/api-hub-contract',
    };
    return { response, audit, executed: Boolean(decision.ok) };
  };

  // 0. Structural validation.
  const structural = validateEnvelope(envelope);
  if (!structural.ok) return finish(reject(structural.code, { field: structural.field }));

  // 1. Payload integrity (tampering defense).
  const integrity = verifyPayloadIntegrity(envelope);
  if (!integrity.ok) return finish(reject(integrity.code));

  // 2. Freshness / staleness.
  const fresh = verifyFreshness(envelope, now);
  if (!fresh.ok) return finish(reject(fresh.code));

  // 3. Version negotiation.
  const version = negotiateVersion(envelope.apiVersion);
  if (!version.ok) return finish(reject(version.code));

  // 4. Authentication + authorization.
  const auth = authenticate({
    envelope,
    identities: w.identities,
    presentedCredential: w.presentedCredential,
    signingKey: w.signingKey,
    now,
  });
  if (!auth.ok) return finish(reject(auth.code, { apiVersion: version.apiVersion }));

  // 5. Replay (nonce) protection.
  const nonce = evaluateNonce({ envelope, seenNonces: w.seenNonces });
  if (!nonce.ok) return finish(reject(nonce.code, { apiVersion: version.apiVersion }));

  // 6. Duplicate delivery.
  const dup = evaluateDuplicateDelivery({ envelope, deliveredRequestIds: w.deliveredRequestIds });
  if (dup.duplicate) return finish(reject(dup.code, { apiVersion: version.apiVersion }));

  // 7. Rate limit.
  const rate = evaluateRateLimit({ envelope, buckets: w.rateBuckets, now });
  if (!rate.allowed) {
    return finish(reject(rate.code, { retryAfterMs: rate.retryAfterMs, apiVersion: version.apiVersion }));
  }

  // 8. Quota.
  const quota = evaluateQuota({ envelope, ledgers: w.quotaLedgers, period: w.period ?? 'MONTHLY' });
  if (!quota.allowed) return finish(reject(quota.code, { apiVersion: version.apiVersion }));

  // 9. Idempotency (replay of stored outcome / conflict / in-flight race).
  const idem = evaluateIdempotency({ envelope, records: w.idempotencyRecords });
  if (idem.decision === 'CONFLICT') return finish(reject('IDEMPOTENCY_CONFLICT', { apiVersion: version.apiVersion }));
  if (idem.decision === 'IN_PROGRESS') return finish(reject('IDEMPOTENCY_IN_PROGRESS', { retryAfterMs: 1000, apiVersion: version.apiVersion }));
  if (idem.decision === 'REPLAY') {
    return finish({
      ok: true,
      resultRef: idem.resultRef,
      apiVersion: version.apiVersion,
      replayed: true,
      auditEventRef: deriveAuditEventId({ correlationId, requestId, action }),
    });
  }

  // 10. Safe degradation planning.
  const degradation = planDegradation({ action, statuses: w.dependencyStatuses });
  if (degradation.hardFail) {
    return finish(reject(degradation.code, { retryAfterMs: 5000, apiVersion: version.apiVersion }));
  }

  // 11. Execute (deterministic result reference — metadata only).
  const resultRef = `RES-${sha256Of({ correlationId, action }).slice(0, 24)}`;
  const telemetryId = `TEL-${sha256Of({ correlationId, requestId }).slice(0, 24)}`;

  const nextState = {
    idempotencyRecords: [
      ...(Array.isArray(w.idempotencyRecords) ? w.idempotencyRecords : []),
      {
        tenantId: envelope.tenantId,
        scope: action,
        idempotencyKey: envelope.idempotencyKey,
        requestHash: requestHash(envelope),
        status: 'COMPLETED',
        resultRef,
      },
    ],
    seenNonces: [
      ...(Array.isArray(w.seenNonces) ? w.seenNonces : []),
      consumeNonce({ envelope, now }),
    ],
    deliveredRequestIds: [
      ...(Array.isArray(w.deliveredRequestIds) ? w.deliveredRequestIds : []),
      envelope.requestId,
    ],
    rateBuckets: [
      ...(Array.isArray(w.rateBuckets) ? w.rateBuckets.filter((b) => b.key !== rate.next.key) : []),
      rate.next,
    ],
    quotaLedgers: [
      ...(Array.isArray(w.quotaLedgers) ? w.quotaLedgers.filter((l) => l.key !== quota.next.key) : []),
      quota.next,
    ],
  };

  const telemetry = buildTelemetryRecord({
    telemetryId,
    correlationId,
    requestId,
    tenantId: envelope.tenantId,
    productId: envelope.productId,
    serviceIdentityId: envelope.serviceIdentityId,
    action,
    apiVersion: version.apiVersion,
    direction: 'INBOUND',
    units: [
      { unit: 'REQUEST', quantity: 1 },
      { unit: 'RESPONSE', quantity: 1 },
    ],
    costUnits: 1,
    currency: 'USD',
    vendorRef: null,
    occurredAt: now,
    recordStatus: 'EXAMPLE',
  });

  const degraded = degradation.mode !== 'NONE';
  const result = finish({
    ok: true,
    resultRef,
    apiVersion: version.apiVersion,
    degraded,
    degradationMode: degradation.mode,
    auditEventRef: deriveAuditEventId({ correlationId, requestId, action }),
    telemetryRef: telemetryId,
  });

  return { ...result, telemetry, nextState };
}

// ---------------------------------------------------------------------------
// Core delegation (authoritative boundary).
// ---------------------------------------------------------------------------
// The transport-side `processRequest` above is a deterministic REFERENCE of the
// wire contract. When a real governed decision is required, the Hub MUST
// delegate to the AUTHORITATIVE Chat 1 governed pipeline rather than deciding
// for itself. This thin re-export makes that delegation explicit and testable:
// the Hub transports; the Core decides.
import { runCoreBoundary as _runCoreBoundary } from './core-boundary.mjs';

/**
 * Delegate a governed envelope to the authoritative Compliance Core boundary.
 * Returns the bounded Core outcome ({ ok, code?, outcome? }) — never a
 * compliance verdict. See src/core-boundary.mjs.
 */
export async function delegateToCore(envelope, over = {}) {
  return _runCoreBoundary(envelope, over);
}
