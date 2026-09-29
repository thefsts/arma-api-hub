// FSTS Compliance Core — governed API request envelope (Phase 6, Chat 1)
//
// The governed request envelope is the single shape every Compliance
// Service/API call must satisfy. Validation is fail-closed: any missing or
// malformed security-relevant field aborts the request before authorization.
//
// Integrity model: the caller signs a canonical hash of the security-relevant
// request fields with a shared secret (HMAC-SHA256). The secret is resolved
// server-side from a secure reference at request time and is NEVER persisted in
// Convex. The stored credential is a reference/hash only.

import { apiError } from "./apiErrors.ts";
import { requireNonEmptyString, isPlainObject } from "./validation.ts";
import { canonicalize, hmacSha256Hex, sha256Hex } from "./integrity.ts";
import { isValidCorrelationId } from "./apiCorrelation.ts";

export const DEFAULT_FRESHNESS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_FUTURE_SKEW_MS = 30 * 1000; // 30 seconds

const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;

export function isValidNonce(value: unknown): boolean {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

// The security-relevant fields that are covered by the request signature.
// Ordering is irrelevant because the hash is canonicalized (sorted keys).
export const SIGNED_FIELDS = [
  "apiVersion",
  "tenantId",
  "serviceIdentityId",
  "productId",
  "environment",
  "action",
  "resourceType",
  "resourceId",
  "timestamp",
  "nonce",
  "requestId",
  "correlationId",
  "idempotencyKey",
  "payloadHash",
] as const;

export type GovernedRequest = {
  apiVersion: string;
  tenantId: string;
  serviceIdentityId: string;
  productId: string;
  environment: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: number;
  nonce: string;
  requestId: string;
  correlationId: string;
  idempotencyKey: string;
  payloadHash: string;
  signature: string;
};

// Validate the envelope shape. Fail closed with MALFORMED_PAYLOAD.
export function validateRequestEnvelope(envelope: unknown): GovernedRequest {
  if (!isPlainObject(envelope)) {
    throw apiError("MALFORMED_PAYLOAD", "request envelope must be an object");
  }
  const e = envelope as Record<string, unknown>;

  const apiVersion = requireNonEmptyString(e.apiVersion, "apiVersion");
  const tenantId = requireNonEmptyString(e.tenantId, "tenantId");
  const serviceIdentityId = requireNonEmptyString(e.serviceIdentityId, "serviceIdentityId");
  const productId = requireNonEmptyString(e.productId, "productId");
  const environment = requireNonEmptyString(e.environment, "environment");
  const action = requireNonEmptyString(e.action, "action");
  const resourceType = requireNonEmptyString(e.resourceType, "resourceType");
  const resourceId = requireNonEmptyString(e.resourceId, "resourceId");
  const requestId = requireNonEmptyString(e.requestId, "requestId");
  const correlationId = requireNonEmptyString(e.correlationId, "correlationId");
  const idempotencyKey = requireNonEmptyString(e.idempotencyKey, "idempotencyKey");
  const payloadHash = requireNonEmptyString(e.payloadHash, "payloadHash");
  const signature = requireNonEmptyString(e.signature, "signature");

  if (typeof e.timestamp !== "number" || !Number.isFinite(e.timestamp)) {
    throw apiError("MALFORMED_PAYLOAD", "timestamp must be a finite number");
  }
  if (!isValidNonce(e.nonce)) {
    throw apiError("NONCE_INVALID", "nonce is missing or malformed");
  }
  if (!isValidCorrelationId(correlationId)) {
    throw apiError("MALFORMED_PAYLOAD", "correlationId is malformed");
  }
  if (!isValidCorrelationId(requestId)) {
    throw apiError("MALFORMED_PAYLOAD", "requestId is malformed");
  }

  return {
    apiVersion,
    tenantId,
    serviceIdentityId,
    productId,
    environment,
    action,
    resourceType,
    resourceId,
    timestamp: e.timestamp,
    nonce: e.nonce as string,
    requestId,
    correlationId,
    idempotencyKey,
    payloadHash,
    signature,
  };
}

// Canonical hash of the signed fields (excludes signature itself).
export function computeRequestHash(envelope: GovernedRequest): string {
  const signed: Record<string, unknown> = {};
  for (const field of SIGNED_FIELDS) {
    signed[field] = (envelope as Record<string, unknown>)[field];
  }
  return sha256Hex(canonicalize(signed));
}

// The LOGICAL identity of a governed operation, used for tenant-aware
// idempotency. Per-request fields (timestamp, nonce, requestId, correlationId)
// are deliberately EXCLUDED so that a legitimate idempotent retry \u2014 which
// carries a fresh nonce/timestamp but the same logical operation \u2014 resolves to
// the stored outcome instead of being rejected. A different logical operation
// under the same idempotency key fails closed (IDEMPOTENCY_CONFLICT).
export const IDEMPOTENCY_FIELDS = [
  "apiVersion",
  "tenantId",
  "serviceIdentityId",
  "productId",
  "environment",
  "action",
  "resourceType",
  "resourceId",
  "payloadHash",
] as const;

export function computeIdempotencyHash(envelope: GovernedRequest): string {
  const logical: Record<string, unknown> = {};
  for (const field of IDEMPOTENCY_FIELDS) {
    logical[field] = (envelope as Record<string, unknown>)[field];
  }
  return sha256Hex(canonicalize(logical));
}

// Compute the expected signature for a request given the resolved secret.
export function computeRequestSignature(envelope: GovernedRequest, secret: string): string {
  return hmacSha256Hex(secret, computeRequestHash(envelope));
}

// Verify request integrity. A mismatch is REQUEST_TAMPERED (never retryable).
export function verifyRequestIntegrity(envelope: GovernedRequest, secret: string): void {
  const expected = computeRequestSignature(envelope, secret);
  if (expected !== envelope.signature) {
    throw apiError("REQUEST_TAMPERED", "request signature does not match");
  }
}

// Freshness: reject stale and far-future requests. Both are non-retryable.
export function validateFreshness(input: {
  timestamp: number;
  now: number;
  windowMs?: number;
  futureSkewMs?: number;
}): void {
  const windowMs = input.windowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;
  const futureSkewMs = input.futureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  const age = input.now - input.timestamp;
  if (age > windowMs) {
    throw apiError("REQUEST_STALE", "request timestamp is outside the freshness window");
  }
  if (age < -futureSkewMs) {
    throw apiError("REQUEST_FUTURE", "request timestamp is too far in the future");
  }
}

// Hash a request payload (the body the caller commits to). The envelope carries
// only this hash, so payloads are never required to be stored verbatim.
export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalize(payload ?? null));
}
