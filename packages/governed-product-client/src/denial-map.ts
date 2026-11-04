// FSTS Governed Product Client — closed Core -> Hub/SDK denial mapping.
//
// AMENDMENT 4 — BOUNDED DENIAL MAPPING.
//
// Every known Phase 8 Compliance Core denial code (the 42-code closed set in
// `apiErrors.API_ERROR_CODES`) plus every ARMA API Hub failure-taxonomy and
// routing-denial code maps to exactly one bounded SDK-facing failure and one
// retry disposition. The original governed Core code is preserved as structured
// `cause` so materially different security/governance failures are never
// flattened into a misleading meaning.
//
// An UNKNOWN or UNMAPPED code FAILS CLOSED: it becomes UPSTREAM_UNAVAILABLE with
// disposition TERMINAL. It never becomes success and never escapes as arbitrary
// or unbounded error vocabulary.
//
// PASS != COMPLIANT. A denial is an operational outcome, never a verdict.

import type { BoundedFailureCode, RetryDisposition } from './constants.js';
import { UPSTREAM_UNAVAILABLE } from './constants.js';

export interface DenialMapping {
  /** The bounded SDK-facing failure the product observes. */
  readonly code: BoundedFailureCode;
  /** How the client should treat the failure. */
  readonly disposition: RetryDisposition;
  /** Human-stable, non-sensitive explanation. Never echoes raw Core text. */
  readonly meaning: string;
}

/**
 * The authoritative closed Core denial set — verbatim from Compliance Core
 * `convex/lib/apiErrors.ts` `API_ERROR_CODES` (Phase 8, Core main 2c8574d).
 */
export const CORE_DENIAL_CODES = Object.freeze([
  // authentication / identity
  'UNAUTHENTICATED',
  'IDENTITY_INVALID',
  'IDENTITY_REVOKED',
  'IDENTITY_SUSPENDED',
  'CREDENTIAL_INVALID',
  // tenancy / authorization
  'TENANT_UNRESOLVED',
  'TENANT_ACCESS_DENIED',
  'FORBIDDEN',
  'SCOPE_VIOLATION',
  'PRODUCT_ISOLATION_VIOLATION',
  'ENVIRONMENT_NOT_AUTHORIZED',
  // request integrity / freshness / replay
  'MALFORMED_PAYLOAD',
  'REQUEST_TAMPERED',
  'REQUEST_STALE',
  'REQUEST_FUTURE',
  'NONCE_INVALID',
  'NONCE_REPLAY',
  'DUPLICATE_REQUEST',
  'IDEMPOTENCY_CONFLICT',
  // versioning
  'UNKNOWN_API_VERSION',
  'API_VERSION_UNSUPPORTED',
  // throttling / platform
  'RATE_LIMITED',
  'CONTRACT_UNKNOWN',
  'INTERNAL',
  // Phase 7 onboarding
  'ONBOARDING_NOT_APPROVED',
  'ONBOARDING_STATE_INVALID',
  'ONBOARDING_FORGED',
  'PRODUCT_NOT_APPROVED',
  'INTEGRATION_INACTIVE',
  'CREDENTIAL_EXPIRED',
  'CREDENTIAL_REVOKED',
  'ROTATION_INVALID',
  'TENANT_BINDING_MISSING',
  'SCOPE_NOT_BOUND',
  // Phase 8 product onboarding control plane
  'PRODUCT_UNKNOWN',
  'HUB_ROUTE_INVALID',
  'CONTRACT_VERSION_STALE',
  'ROLLOUT_BLOCKED',
  'INTEGRATION_UNHEALTHY',
  'HEALTH_TELEMETRY_INVALID',
  'MANIFEST_INVALID',
  'OFFBOARDING_INVALID',
] as const);
export type CoreDenialCode = (typeof CORE_DENIAL_CODES)[number];

/**
 * Hub failure-taxonomy codes (18) plus Hub routing-denial codes. Some overlap
 * with the SDK vocabulary; they are included so a Hub-originated denial is never
 * mistaken for an unknown code.
 */
export const HUB_DENIAL_CODES = Object.freeze([
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_DENIED',
  'TENANT_DENIED',
  'PRODUCT_DENIED',
  'ENVIRONMENT_DENIED',
  'SCOPE_DENIED',
  'REPLAY_DENIED',
  'STALE_REQUEST',
  'INTEGRITY_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'UNSUPPORTED_VERSION',
  'UNKNOWN_OPERATION',
  'VALIDATION_FAILED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_FAILURE',
  'NOT_FOUND',
] as const);

const T = 'TERMINAL' as const;
const H = 'HELD' as const;
const C = 'CLEAN_RETRYABLE' as const;
const A = 'AMBIGUOUS' as const;

/**
 * The closed mapping table. One entry per known denial code. Adding a new Core
 * denial without adding a mapping is a conformance failure (C20 + amendment
 * completeness test).
 */
export const DENIAL_MAPPING: Readonly<Record<string, DenialMapping>> = Object.freeze({
  // --- authentication / identity -------------------------------------------
  UNAUTHENTICATED: {
    code: 'AUTHENTICATION_FAILED',
    disposition: T,
    meaning: 'service authentication failed',
  },
  IDENTITY_INVALID: {
    code: 'AUTHENTICATION_FAILED',
    disposition: T,
    meaning: 'service identity is invalid',
  },
  IDENTITY_REVOKED: {
    code: 'INTEGRATION_INACTIVE',
    disposition: T,
    meaning: 'service identity revoked',
  },
  IDENTITY_SUSPENDED: {
    code: 'INTEGRATION_INACTIVE',
    disposition: H,
    meaning: 'service identity suspended',
  },
  CREDENTIAL_INVALID: {
    code: 'AUTHENTICATION_FAILED',
    disposition: T,
    meaning: 'credential invalid',
  },

  // --- tenancy / authorization ---------------------------------------------
  TENANT_UNRESOLVED: {
    code: 'TENANT_DENIED',
    disposition: T,
    meaning: 'tenant could not be resolved',
  },
  TENANT_ACCESS_DENIED: { code: 'TENANT_DENIED', disposition: T, meaning: 'tenant access denied' },
  FORBIDDEN: { code: 'AUTHORIZATION_DENIED', disposition: T, meaning: 'authorization denied' },
  SCOPE_VIOLATION: { code: 'SCOPE_DENIED', disposition: T, meaning: 'required scope not held' },
  PRODUCT_ISOLATION_VIOLATION: {
    code: 'PRODUCT_DENIED',
    disposition: T,
    meaning: 'product isolation violated',
  },
  ENVIRONMENT_NOT_AUTHORIZED: {
    code: 'ENVIRONMENT_DENIED',
    disposition: T,
    meaning: 'environment not authorized',
  },

  // --- request integrity / freshness / replay ------------------------------
  MALFORMED_PAYLOAD: {
    code: 'VALIDATION_FAILED',
    disposition: T,
    meaning: 'request payload malformed',
  },
  REQUEST_TAMPERED: {
    code: 'INTEGRITY_FAILED',
    disposition: T,
    meaning: 'request integrity verification failed',
  },
  REQUEST_STALE: {
    code: 'STALE_REQUEST',
    disposition: T,
    meaning: 'request outside freshness window',
  },
  REQUEST_FUTURE: {
    code: 'STALE_REQUEST',
    disposition: T,
    meaning: 'request timestamp too far in the future',
  },
  NONCE_INVALID: { code: 'INTEGRITY_FAILED', disposition: T, meaning: 'nonce invalid' },
  NONCE_REPLAY: { code: 'REPLAY_DENIED', disposition: T, meaning: 'request replay denied' },
  DUPLICATE_REQUEST: { code: 'REPLAY_DENIED', disposition: T, meaning: 'duplicate request denied' },
  IDEMPOTENCY_CONFLICT: {
    code: 'IDEMPOTENCY_CONFLICT',
    disposition: T,
    meaning: 'idempotency key reused with a different request',
  },

  // --- versioning ----------------------------------------------------------
  UNKNOWN_API_VERSION: {
    code: 'UNSUPPORTED_VERSION',
    disposition: T,
    meaning: 'unknown api version',
  },
  API_VERSION_UNSUPPORTED: {
    code: 'UNSUPPORTED_VERSION',
    disposition: T,
    meaning: 'api version unsupported',
  },
  CONTRACT_UNKNOWN: {
    code: 'UNSUPPORTED_VERSION',
    disposition: T,
    meaning: 'contract version unknown',
  },

  // --- throttling / platform ----------------------------------------------
  RATE_LIMITED: { code: 'RATE_LIMITED', disposition: C, meaning: 'rate limit exceeded' },
  INTERNAL: { code: UPSTREAM_UNAVAILABLE, disposition: A, meaning: 'internal service failure' },

  // --- Phase 7 onboarding --------------------------------------------------
  ONBOARDING_NOT_APPROVED: {
    code: 'INTEGRATION_INACTIVE',
    disposition: H,
    meaning: 'onboarding not approved',
  },
  ONBOARDING_STATE_INVALID: {
    code: 'INTEGRATION_INACTIVE',
    disposition: T,
    meaning: 'onboarding state invalid',
  },
  ONBOARDING_FORGED: {
    code: 'INTEGRATION_INACTIVE',
    disposition: T,
    meaning: 'onboarding history forged',
  },
  PRODUCT_NOT_APPROVED: { code: 'PRODUCT_DENIED', disposition: H, meaning: 'product not approved' },
  INTEGRATION_INACTIVE: {
    code: 'INTEGRATION_INACTIVE',
    disposition: H,
    meaning: 'integration is not active',
  },
  CREDENTIAL_EXPIRED: {
    code: 'CREDENTIAL_UNRESOLVED',
    disposition: T,
    meaning: 'credential expired',
  },
  CREDENTIAL_REVOKED: {
    code: 'CREDENTIAL_UNRESOLVED',
    disposition: T,
    meaning: 'credential revoked',
  },
  ROTATION_INVALID: {
    code: 'CREDENTIAL_UNRESOLVED',
    disposition: T,
    meaning: 'credential rotation invalid',
  },
  TENANT_BINDING_MISSING: {
    code: 'TENANT_DENIED',
    disposition: T,
    meaning: 'tenant binding missing',
  },
  SCOPE_NOT_BOUND: { code: 'SCOPE_DENIED', disposition: T, meaning: 'scope not bound' },

  // --- Phase 8 product onboarding control plane ----------------------------
  PRODUCT_UNKNOWN: { code: 'PRODUCT_DENIED', disposition: T, meaning: 'product unknown' },
  HUB_ROUTE_INVALID: {
    code: 'ROUTE_ENVELOPE_MISMATCH',
    disposition: T,
    meaning: 'API Hub routing id does not match the registered route',
  },
  CONTRACT_VERSION_STALE: {
    code: 'UNSUPPORTED_VERSION',
    disposition: T,
    meaning: 'contract version stale or unsupported',
  },
  ROLLOUT_BLOCKED: {
    code: 'INTEGRATION_INACTIVE',
    disposition: H,
    meaning: 'rollout or kill switch blocks consumption',
  },
  INTEGRATION_UNHEALTHY: {
    code: UPSTREAM_UNAVAILABLE,
    disposition: H,
    meaning: 'integration unhealthy (Core-derived)',
  },
  HEALTH_TELEMETRY_INVALID: {
    code: 'VALIDATION_FAILED',
    disposition: T,
    meaning: 'health telemetry invalid',
  },
  MANIFEST_INVALID: {
    code: 'VALIDATION_FAILED',
    disposition: T,
    meaning: 'onboarding manifest invalid',
  },
  OFFBOARDING_INVALID: {
    code: 'INTEGRATION_INACTIVE',
    disposition: T,
    meaning: 'offboarding invalid',
  },

  // --- Hub failure taxonomy / routing denials ------------------------------
  AUTHENTICATION_FAILED: {
    code: 'AUTHENTICATION_FAILED',
    disposition: T,
    meaning: 'service authentication failed',
  },
  AUTHORIZATION_DENIED: {
    code: 'AUTHORIZATION_DENIED',
    disposition: T,
    meaning: 'authorization denied',
  },
  TENANT_DENIED: { code: 'TENANT_DENIED', disposition: T, meaning: 'tenant access denied' },
  PRODUCT_DENIED: { code: 'PRODUCT_DENIED', disposition: T, meaning: 'product access denied' },
  ENVIRONMENT_DENIED: {
    code: 'ENVIRONMENT_DENIED',
    disposition: T,
    meaning: 'environment access denied',
  },
  SCOPE_DENIED: { code: 'SCOPE_DENIED', disposition: T, meaning: 'required scope not held' },
  REPLAY_DENIED: { code: 'REPLAY_DENIED', disposition: T, meaning: 'request replay denied' },
  STALE_REQUEST: {
    code: 'STALE_REQUEST',
    disposition: T,
    meaning: 'request outside freshness window',
  },
  INTEGRITY_FAILED: {
    code: 'INTEGRITY_FAILED',
    disposition: T,
    meaning: 'request integrity verification failed',
  },
  UNSUPPORTED_VERSION: {
    code: 'UNSUPPORTED_VERSION',
    disposition: T,
    meaning: 'unsupported version',
  },
  UNKNOWN_OPERATION: { code: 'UNKNOWN_OPERATION', disposition: T, meaning: 'unknown operation' },
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    disposition: T,
    meaning: 'request validation failed',
  },
  DEPENDENCY_UNAVAILABLE: {
    code: 'DEPENDENCY_UNAVAILABLE',
    disposition: C,
    meaning: 'required dependency unavailable',
  },
  INTERNAL_FAILURE: {
    code: UPSTREAM_UNAVAILABLE,
    disposition: A,
    meaning: 'internal service failure',
  },
  NOT_FOUND: { code: 'VALIDATION_FAILED', disposition: T, meaning: 'record not found' },
});

/** The fail-closed result for any code outside the closed table. */
export const UNKNOWN_DENIAL: DenialMapping = Object.freeze({
  code: UPSTREAM_UNAVAILABLE,
  disposition: T,
  meaning: 'unrecognised upstream denial (failed closed)',
});

/**
 * Map a Core/Hub denial code to a bounded SDK failure. UNKNOWN FAILS CLOSED.
 * The original code is returned as `cause` so the caller can audit it without
 * the SDK ever surfacing unbounded vocabulary as the primary failure.
 */
export function mapCoreDenial(code: string): DenialMapping & { readonly cause: string } {
  const found = DENIAL_MAPPING[code];
  if (found) return { ...found, cause: code };
  return { ...UNKNOWN_DENIAL, cause: code };
}

/** True only when every known Core/Hub denial has an explicit mapping. */
export function isDenialMappingComplete(): boolean {
  for (const code of CORE_DENIAL_CODES) if (!DENIAL_MAPPING[code]) return false;
  for (const code of HUB_DENIAL_CODES) if (!DENIAL_MAPPING[code]) return false;
  return true;
}

/** Every known denial code that lacks a mapping (empty when complete). */
export function unmappedDenialCodes(): readonly string[] {
  const missing: string[] = [];
  for (const code of [...CORE_DENIAL_CODES, ...HUB_DENIAL_CODES]) {
    if (!DENIAL_MAPPING[code]) missing.push(code);
  }
  return Object.freeze(missing);
}
