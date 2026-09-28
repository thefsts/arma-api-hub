// ARMA API Hub — retry policy for durable jobs.
//
// Backoff is injectable so tests prove retry behavior deterministically.
// Only CLEAN retryable failures are retried automatically; ambiguous outcomes
// route to reconciliation rather than blind retry (an accepted side effect
// must never be duplicated).

export const RETRY_SCHEDULE_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;
export const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length;
const LAST_DELAY_MS = 600_000;

export type FailureClass = 'CLEAN_RETRYABLE' | 'AMBIGUOUS' | 'TERMINAL';

export interface BackoffResult {
  readonly allowed: boolean;
  readonly delayMs?: number;
  readonly nextAttempt?: number;
  readonly reason?: string;
}

/** Compute the next retry state for a job. */
export function computeBackoff(attempt: number): BackoffResult {
  if (attempt >= MAX_RETRY_ATTEMPTS) {
    return { allowed: false, reason: 'MAX_RETRIES_EXCEEDED' };
  }
  const delayMs = RETRY_SCHEDULE_MS[attempt] ?? LAST_DELAY_MS;
  return { allowed: true, delayMs, nextAttempt: attempt + 1 };
}

/** Decide whether a classified failure may be retried automatically. */
export function canAutoRetry(failureClass: FailureClass): boolean {
  return failureClass === 'CLEAN_RETRYABLE';
}
