// FSTS Governed Product Client — typed, bounded errors.
//
// Construction failures are thrown as GovernedClientConfigError and no client is
// produced. Runtime failures are NEVER thrown as unbounded errors; they are
// returned as a bounded GovernedResult. This module only defines the shapes.

import type { BoundedFailureCode, RetryDisposition } from './constants.js';

/** Raised at construction time when the client cannot be safely created. */
export class GovernedClientConfigError extends Error {
  readonly code: BoundedFailureCode;
  constructor(code: BoundedFailureCode, message: string) {
    super(message);
    this.name = 'GovernedClientConfigError';
    this.code = code;
  }
}

/** The bounded, non-verdict failure a GovernedResult carries. */
export interface BoundedFailure {
  readonly ok: false;
  readonly code: BoundedFailureCode;
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly disposition: RetryDisposition;
  /** The original governed Core/Hub code, preserved for audit. Never raw text. */
  readonly cause: string;
  readonly correlationId: string;
  readonly requestId: string;
}

/** The bounded success a GovernedResult carries. Never a compliance verdict. */
export interface GovernedSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly correlationId: string;
  readonly requestId: string;
}

/**
 * A GovernedResult is deliberately verdict-free. There is no `compliant`,
 * `certified`, `approved`, or `verdict` field. `ok: true` means "the Core
 * accepted the governed request", not "the subject is compliant".
 */
export type GovernedResult<T> = GovernedSuccess<T> | BoundedFailure;

export function boundedFailure(input: {
  code: BoundedFailureCode;
  disposition: RetryDisposition;
  cause: string;
  correlationId: string;
  requestId: string;
}): BoundedFailure {
  return Object.freeze({
    ok: false,
    code: input.code,
    retryable: input.disposition === 'CLEAN_RETRYABLE',
    ambiguous: input.disposition === 'AMBIGUOUS',
    disposition: input.disposition,
    cause: input.cause,
    correlationId: input.correlationId,
    requestId: input.requestId,
  });
}
