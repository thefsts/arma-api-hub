// FSTS Compliance Core — Phase 6
// API Hub Contract — failure taxonomy + retry semantics.
// ---------------------------------------------------------------------------
// Every non-OK response carries exactly one bounded failure code. The taxonomy
// is closed: an unknown code is a fail-closed violation. Retry semantics are a
// pure function of the failure class, and the retry budget protects Compliance
// Core from retry storms.
// ---------------------------------------------------------------------------

import {
  FAILURE_TAXONOMY,
  FAILURE_CODES,
  FAILURE_CLASSES,
  RETRY_BUDGET,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
} from './constants.mjs';

export class ApiHubError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'ApiHubError';
    this.code = code;
  }
}

/** True when `code` is a bounded member of the failure taxonomy. */
export function isKnownFailureCode(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(FAILURE_TAXONOMY, code);
}

/** Fail-closed lookup: unknown code -> INTERNAL_ERROR. */
export function classifyFailure(code) {
  const entry = isKnownFailureCode(code) ? FAILURE_TAXONOMY[code] : FAILURE_TAXONOMY.INTERNAL_ERROR;
  return {
    code: isKnownFailureCode(code) ? code : 'INTERNAL_ERROR',
    failureClass: entry.failureClass,
    retryable: entry.retryable,
    description: entry.description,
  };
}

/**
 * Deterministic exponential backoff for a retryable failure.
 * attempt is 0-based; result is capped at RETRY_MAX_MS. No randomness — the
 * jitter term is derived from the correlation id so it is reproducible.
 */
export function backoffMs(attempt, correlationId = '') {
  const n = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  const raw = RETRY_BASE_MS * 2 ** n;
  const capped = Math.min(raw, RETRY_MAX_MS);
  // Deterministic jitter in [0, base) derived from the correlation id.
  const jitterSeed = typeof correlationId === 'string' ? correlationId : '';
  const jitter = jitterSeed.length > 0 ? parseInt(jitterSeed.slice(0, 4), 16) % RETRY_BASE_MS : 0;
  return Math.min(capped + jitter, RETRY_MAX_MS);
}

/**
 * Decide whether a retry is permitted. Exhausting the budget yields
 * RETRY_STORM (retryable, but the caller must back off first).
 */
export function evaluateRetry({ code, attempt, correlationId }) {
  const classified = classifyFailure(code);
  if (!classified.retryable) {
    return { allowed: false, code: classified.code, retryAfterMs: null, storm: false };
  }
  if (attempt >= RETRY_BUDGET) {
    return {
      allowed: false,
      code: 'RETRY_STORM',
      retryAfterMs: backoffMs(attempt, correlationId),
      storm: true,
    };
  }
  return {
    allowed: true,
    code: classified.code,
    retryAfterMs: backoffMs(attempt, correlationId),
    storm: false,
  };
}

/** Fail-closed assertion that a code is bounded. */
export function assertKnownFailureCode(code) {
  if (!isKnownFailureCode(code)) {
    throw new ApiHubError('INTERNAL_ERROR', `unknown failure code "${code}" is not in the bounded taxonomy`);
  }
  return code;
}

export const FAILURE_CODE_LIST = FAILURE_CODES;
export const FAILURE_CLASS_LIST = FAILURE_CLASSES;
