// ARMA API Hub — crypto package.
//
// Provides the canonical request-signing primitive and verification used by
// every service-facing surface. The canonical string binds the caller to the
// method, exact path, timestamp, nonce, and byte-exact body hash so any
// in-flight mutation breaks verification.
//
// ALGORITHMS ARE VERSIONED AND REPLACEABLE. This module implements HMAC-SHA256
// using Node's standard `crypto` module. It does NOT implement homegrown
// encryption. Additional algorithms (ED25519, ECDSA-P256-SHA256) are declared
// in the contract layer and can be added here behind the same interface.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SignatureAlgorithm } from '@arma/contracts';

/** Maximum accepted clock skew between signer and verifier (±5 minutes). */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Nonce validity window for replay protection (2x clock skew). */
export const NONCE_VALIDITY_WINDOW_MS = 2 * MAX_CLOCK_SKEW_MS;

export const NONCE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
export const TIMESTAMP_PATTERN = /^\d{1,16}$/;
export const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type SignatureFailureCode =
  | 'SIGNATURE_INPUT_INVALID'
  | 'SIGNATURE_NONCE_INVALID'
  | 'SIGNATURE_TIMESTAMP_INVALID'
  | 'SIGNATURE_BODY_HASH_INVALID'
  | 'SIGNATURE_SIGNATURE_MISMATCH'
  | 'SIGNATURE_CLOCK_SKEW_EXCEEDED'
  | 'SIGNATURE_ALGORITHM_UNSUPPORTED';

export interface CanonicalRequest {
  readonly method: string;
  readonly path: string;
  readonly timestamp: string | number;
  readonly nonce: string;
  readonly bodyHash: string;
}

/** Generate a fresh URL-safe nonce (32 chars). */
export function generateNonce(): string {
  return randomBytes(24).toString('base64url');
}

/** SHA-256 hex digest of a string or buffer. */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Body hash over the EXACT raw bytes; an empty body hashes the empty string. */
export function bodyHashFor(rawBody: Buffer | string): string {
  const raw = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return sha256Hex(raw.length === 0 ? '' : raw);
}

/** The canonical string: exact field order, newline separated. */
export function canonicalRequestString(req: CanonicalRequest): string {
  return `${String(req.method).toUpperCase()}\n${req.path}\n${String(req.timestamp)}\n${req.nonce}\n${req.bodyHash}`;
}

/** Timing-safe comparison of two hex digests. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

/** Compute an HMAC-SHA256 signature over a canonical string. */
export function computeHmacSha256(secret: string, canonical: string): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('SIGNER_SECRET_REQUIRED');
  }
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export interface SignedRequest {
  readonly canonical: string;
  readonly bodyHash: string;
  readonly signature: string;
  readonly algorithm: SignatureAlgorithm;
}

/** Sign a canonical request. Fails closed on malformed inputs. */
export function signCanonicalRequest(
  secret: string,
  req: CanonicalRequest,
  algorithm: SignatureAlgorithm = 'HMAC-SHA256',
): SignedRequest {
  if (algorithm !== 'HMAC-SHA256') {
    throw new Error('SIGNATURE_ALGORITHM_UNSUPPORTED');
  }
  if (typeof req.method !== 'string' || !req.method) throw new Error('SIGNATURE_INPUT_INVALID');
  if (typeof req.path !== 'string' || !req.path) throw new Error('SIGNATURE_INPUT_INVALID');
  if (!NONCE_PATTERN.test(req.nonce)) throw new Error('SIGNATURE_NONCE_INVALID');
  if (!TIMESTAMP_PATTERN.test(String(req.timestamp)))
    throw new Error('SIGNATURE_TIMESTAMP_INVALID');
  if (!HEX_SHA256_PATTERN.test(req.bodyHash)) throw new Error('SIGNATURE_BODY_HASH_INVALID');
  const canonical = canonicalRequestString(req);
  const signature = computeHmacSha256(secret, canonical);
  return { canonical, bodyHash: req.bodyHash, signature, algorithm };
}

export interface VerifySignatureInput {
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodyHash: string;
  readonly providedSignature: string;
  readonly algorithm?: SignatureAlgorithm;
  readonly now?: number;
  readonly maxClockSkewMs?: number;
}

export type SignatureVerification =
  | { ok: true; signature: string }
  | { ok: false; code: SignatureFailureCode; detail?: Record<string, unknown> };

/**
 * Verify a signed canonical request. Timing-safe compare, clock-skew window,
 * and fail-closed structural checks. Never logs or returns the secret.
 */
export function verifyCanonicalRequestSignature(
  input: VerifySignatureInput,
): SignatureVerification {
  const algorithm = input.algorithm ?? 'HMAC-SHA256';
  if (algorithm !== 'HMAC-SHA256') {
    return { ok: false, code: 'SIGNATURE_ALGORITHM_UNSUPPORTED' };
  }
  const now = input.now ?? Date.now();
  const skewLimit = input.maxClockSkewMs ?? MAX_CLOCK_SKEW_MS;

  if (
    typeof input.method !== 'string' ||
    !input.method ||
    typeof input.path !== 'string' ||
    !input.path ||
    typeof input.nonce !== 'string'
  ) {
    return { ok: false, code: 'SIGNATURE_INPUT_INVALID' };
  }
  if (!TIMESTAMP_PATTERN.test(String(input.timestamp))) {
    return { ok: false, code: 'SIGNATURE_TIMESTAMP_INVALID' };
  }
  const ts = Number(input.timestamp);
  if (Math.abs(now - ts) > skewLimit) {
    return {
      ok: false,
      code: 'SIGNATURE_CLOCK_SKEW_EXCEEDED',
      detail: { skewMs: Math.abs(now - ts), limitMs: skewLimit },
    };
  }
  if (!NONCE_PATTERN.test(input.nonce)) {
    return { ok: false, code: 'SIGNATURE_NONCE_INVALID' };
  }
  if (typeof input.bodyHash !== 'string' || !HEX_SHA256_PATTERN.test(input.bodyHash)) {
    return { ok: false, code: 'SIGNATURE_BODY_HASH_INVALID' };
  }
  if (typeof input.secret !== 'string' || input.secret.length === 0) {
    return { ok: false, code: 'SIGNATURE_INPUT_INVALID' };
  }
  const canonical = canonicalRequestString(input);
  const expected = computeHmacSha256(input.secret, canonical);
  if (
    typeof input.providedSignature !== 'string' ||
    !HEX_SHA256_PATTERN.test(input.providedSignature)
  ) {
    return { ok: false, code: 'SIGNATURE_SIGNATURE_MISMATCH' };
  }
  if (!timingSafeEqualHex(expected, input.providedSignature)) {
    return { ok: false, code: 'SIGNATURE_SIGNATURE_MISMATCH' };
  }
  return { ok: true, signature: input.providedSignature };
}
