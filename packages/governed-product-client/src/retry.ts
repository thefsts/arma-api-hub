// FSTS Governed Product Client — retry classification.
//
// The exact four-way classification proven in the Phase 8 worker. Behaviour is
// consistent across Hub and product:
//   CLEAN_RETRYABLE -> auto-retry on the manifest schedule
//   AMBIGUOUS       -> NEVER blind-retry; surface for reconciliation
//   TERMINAL        -> dead-letter; do not retry
//   HELD            -> preserve work; do not consume retry budget
//
// The retry schedule ORDER IS PRESERVED. It is never canonical-sorted.

import type { RetryDisposition } from './constants.js';

export interface RetryPlan {
  readonly disposition: RetryDisposition;
  readonly maxAttempts: number;
  /** The manifest schedule, in declared order. Empty for non-retryable classes. */
  readonly scheduleMs: readonly number[];
}

export function planRetry(
  disposition: RetryDisposition,
  scheduleMs: readonly number[],
  maxAttempts: number,
): RetryPlan {
  if (disposition !== 'CLEAN_RETRYABLE') {
    return { disposition, maxAttempts: 0, scheduleMs: [] };
  }
  // Preserve declared order; never sort. Clamp attempts to the schedule length.
  const usable = scheduleMs.slice(0, Math.max(0, Math.min(maxAttempts, scheduleMs.length)));
  return { disposition, maxAttempts: usable.length, scheduleMs: usable };
}

/** True when the client should automatically retry this disposition. */
export function isAutoRetryable(disposition: RetryDisposition): boolean {
  return disposition === 'CLEAN_RETRYABLE';
}
