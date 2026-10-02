// ARMA API Hub — retry policy for durable jobs.
//
// Backoff is injectable so tests prove retry behavior deterministically.
// Only CLEAN retryable failures are retried automatically; ambiguous outcomes
// route to reconciliation rather than blind retry (an accepted side effect
// must never be duplicated).

export const RETRY_SCHEDULE_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;
export const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length;
const LAST_DELAY_MS = 600_000;

/**
 * The failure class of a job outcome. It is deliberately NOT a two-way
 * retryable/terminal split:
 *
 *   * CLEAN_RETRYABLE — the failure happened before any side effect; safe to
 *                       retry automatically (consumes the retry budget).
 *   * AMBIGUOUS       — a remote side may have accepted; NEVER blindly retried.
 *                       Routed to reconciliation/review.
 *   * TERMINAL        — permanently invalid; dead-lettered.
 *   * HELD            — a temporary governance condition (SUSPENDED onboarding,
 *                       vendor shutdown, spend-limit throttle/block, connector
 *                       kill switch, temporary gate/dependency failure). The
 *                       work is HELD, never discarded: it does not consume the
 *                       retry budget, keeps its identity and ordering, and can
 *                       resume once the control is released.
 */
export type FailureClass = 'CLEAN_RETRYABLE' | 'AMBIGUOUS' | 'TERMINAL' | 'HELD';

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

/**
 * Decide whether a classified failure is a governance HOLD: work that must be
 * preserved (never dead-lettered, never auto-retried) and can resume after the
 * control is released. HELD work never consumes the retry budget.
 */
export function isGovernanceHold(failureClass: FailureClass): boolean {
  return failureClass === 'HELD';
}

/**
 * Decide whether a classified failure must go to reconciliation/review: a
 * remote side may have accepted, so the work is neither retried nor discarded.
 */
export function requiresReconciliation(failureClass: FailureClass): boolean {
  return failureClass === 'AMBIGUOUS';
}
