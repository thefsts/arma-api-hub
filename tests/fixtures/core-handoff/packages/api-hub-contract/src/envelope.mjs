// FSTS Compliance Core — Phase 6
// API Hub Contract — wire envelope construction, validation, integrity.
// ---------------------------------------------------------------------------
// The envelope is the ONLY shape that crosses the Compliance Core <-> API Hub
// boundary. It is transport-neutral: the Hub owns how bytes travel; Core owns
// what the bytes mean. Validation is fail-closed and returns a bounded failure
// code rather than throwing for expected rejections.
// ---------------------------------------------------------------------------

import {
  DIRECTIONS,
  RESPONSE_STATUSES,
  ENVELOPE_VERSION,
  SUPPORTED_ENVELOPE_VERSIONS,
  MAX_PAYLOAD_BYTES,
  REQUEST_TTL_MS,
} from './constants.mjs';
import { canonicalByteLength, sha256Of, sealOf, isSha256Hex, isCorrelationId } from './hash.mjs';
import { classifyFailure } from './failure.mjs';

const REQUIRED_REQUEST_FIELDS = [
  'envelopeVersion',
  'direction',
  'correlationId',
  'requestId',
  'tenantId',
  'productId',
  'serviceIdentityId',
  'action',
  'apiVersion',
  'idempotencyKey',
  'nonce',
  'issuedAt',
  'payloadHash',
  'payload',
];

/** Build a canonical inbound request envelope (deterministic). */
export function buildRequestEnvelope(input) {
  const payload = input.payload ?? {};
  const envelope = {
    envelopeVersion: input.envelopeVersion ?? ENVELOPE_VERSION,
    direction: input.direction ?? 'INBOUND',
    correlationId: input.correlationId,
    requestId: input.requestId,
    tenantId: input.tenantId,
    productId: input.productId,
    serviceIdentityId: input.serviceIdentityId,
    action: input.action,
    apiVersion: input.apiVersion,
    idempotencyKey: input.idempotencyKey,
    nonce: input.nonce,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt ?? (typeof input.issuedAt === 'number' ? input.issuedAt + REQUEST_TTL_MS : undefined),
    payloadHash: input.payloadHash ?? sha256Of(payload),
    payload,
    signatureAlgorithm: input.signatureAlgorithm ?? 'HMAC-SHA256',
    signatureReference: input.signatureReference ?? null,
    signatureDigest: input.signatureDigest ?? null,
  };
  return envelope;
}

/**
 * Validate an inbound envelope structurally. Returns { ok, code } — never
 * throws for expected rejections. Checks ordering is deterministic so the first
 * failing code is stable.
 */
export function validateEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, code: 'VALIDATION_MALFORMED' };
  }
  for (const field of REQUIRED_REQUEST_FIELDS) {
    if (envelope[field] === undefined || envelope[field] === null || envelope[field] === '') {
      return { ok: false, code: 'VALIDATION_MISSING_FIELD', field };
    }
  }
  if (!SUPPORTED_ENVELOPE_VERSIONS.includes(envelope.envelopeVersion)) {
    return { ok: false, code: 'VERSION_UNSUPPORTED', field: 'envelopeVersion' };
  }
  if (!DIRECTIONS.includes(envelope.direction)) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'direction' };
  }
  if (!isCorrelationId(envelope.correlationId)) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'correlationId' };
  }
  if (typeof envelope.issuedAt !== 'number' || !Number.isFinite(envelope.issuedAt)) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'issuedAt' };
  }
  if (!isSha256Hex(envelope.payloadHash)) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'payloadHash' };
  }
  // Oversized payloads fail closed before any hashing work.
  if (canonicalByteLength(envelope.payload) > MAX_PAYLOAD_BYTES) {
    return { ok: false, code: 'VALIDATION_OVERSIZED', field: 'payload' };
  }
  return { ok: true, code: null };
}

/** Verify the payload hash matches the payload (tampering defense). */
export function verifyPayloadIntegrity(envelope) {
  const actual = sha256Of(envelope.payload);
  if (actual !== envelope.payloadHash) {
    return { ok: false, code: 'INTEGRITY_MISMATCH' };
  }
  return { ok: true, code: null };
}

/**
 * Staleness check relative to an explicit `now` (never the wall clock).
 * A request is stale when now < issuedAt (not yet valid) or now > expiresAt.
 */
export function verifyFreshness(envelope, now) {
  const issuedAt = envelope.issuedAt;
  const expiresAt = typeof envelope.expiresAt === 'number' ? envelope.expiresAt : issuedAt + REQUEST_TTL_MS;
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return { ok: false, code: 'INTERNAL_ERROR' };
  }
  if (now < issuedAt) return { ok: false, code: 'REQUEST_STALE', reason: 'NOT_YET_VALID' };
  if (now > expiresAt) return { ok: false, code: 'REQUEST_STALE', reason: 'EXPIRED' };
  return { ok: true, code: null };
}

/** Build a response envelope (deterministic, sealed). */
export function buildResponseEnvelope(input) {
  const response = {
    envelopeVersion: ENVELOPE_VERSION,
    direction: 'OUTBOUND',
    correlationId: input.correlationId,
    requestId: input.requestId,
    status: input.status,
    apiVersion: input.apiVersion,
    action: input.action ?? null,
    resultRef: input.resultRef ?? null,
    failureCode: input.failureCode ?? null,
    failureClass: input.failureCode ? classifyFailure(input.failureCode).failureClass : null,
    retryable: input.failureCode ? classifyFailure(input.failureCode).retryable : false,
    retryAfterMs: input.retryAfterMs ?? null,
    degraded: input.degraded ?? false,
    degradationMode: input.degradationMode ?? 'NONE',
    auditEventRef: input.auditEventRef ?? null,
    telemetryRef: input.telemetryRef ?? null,
  };
  response.seal = sealOf(response);
  return response;
}

/** Validate a response envelope (used by verifiers + tests). */
export function validateResponseEnvelope(response) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    return { ok: false, code: 'VALIDATION_MALFORMED' };
  }
  if (!RESPONSE_STATUSES.includes(response.status)) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'status' };
  }
  if (!isCorrelationId(response.correlationId)) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'correlationId' };
  }
  if (response.status !== 'OK' && !response.failureCode) {
    return { ok: false, code: 'VALIDATION_MISSING_FIELD', field: 'failureCode' };
  }
  if (response.status === 'OK' && response.failureCode) {
    return { ok: false, code: 'VALIDATION_MALFORMED', field: 'failureCode' };
  }
  if (response.seal !== sealOf(response)) {
    return { ok: false, code: 'INTEGRITY_MISMATCH', field: 'seal' };
  }
  return { ok: true, code: null };
}
