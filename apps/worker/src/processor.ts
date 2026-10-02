// ARMA API Hub — durable job processor.
//
// Processes jobs with retry and dead-letter handling. The processor is a pure
// function of (job, handler) so it can be driven deterministically in tests.

import type { Job, Queue } from './queue.js';
import {
  canAutoRetry,
  computeBackoff,
  isGovernanceHold,
  requiresReconciliation,
  type FailureClass,
} from './retry.js';

export interface JobOutcome {
  readonly ok: boolean;
  readonly failureClass?: FailureClass;
  readonly reason?: string;
}

export type JobHandler<T> = (job: Job<T>) => Promise<JobOutcome>;

export interface ProcessResult {
  readonly status: 'ACKED' | 'RETRIED' | 'DEAD_LETTERED' | 'HELD' | 'HELD_FOR_REVIEW';
  readonly nextAvailableAt?: number;
}

/**
 * Process a single reserved job. The outcome is classified, never collapsed
 * into retry/terminal:
 *
 *   * ok                     → ACKED.
 *   * CLEAN_RETRYABLE        → RETRIED with backoff (consumes the retry budget);
 *                              DEAD_LETTERED once the budget is exhausted.
 *   * HELD                   → HELD: preserved, no retry budget consumed, no
 *                              ordering information lost, resumable via release.
 *   * AMBIGUOUS              → HELD_FOR_REVIEW: quarantined for reconciliation;
 *                              never blindly retried, never silently discarded.
 *   * TERMINAL               → DEAD_LETTERED.
 */
export async function processJob<T>(
  queue: Queue<T>,
  job: Job<T>,
  handler: JobHandler<T>,
  now: number,
): Promise<ProcessResult> {
  const outcome = await handler(job);

  if (outcome.ok) {
    await queue.ack(job.jobId);
    return { status: 'ACKED' };
  }

  const failureClass = outcome.failureClass ?? 'TERMINAL';

  // Governance hold: preserve the work. It does NOT consume the retry budget,
  // keeps its job identity and ordering, and can resume after release.
  if (isGovernanceHold(failureClass)) {
    await queue.hold(job, outcome.reason ?? 'HELD');
    return { status: 'HELD' };
  }

  // Ambiguous delivery: a remote side may have accepted. Never retried blindly
  // and never silently dead-lettered — quarantine for reconciliation/review.
  if (requiresReconciliation(failureClass)) {
    await queue.holdForReconciliation(job, outcome.reason ?? 'AMBIGUOUS');
    return { status: 'HELD_FOR_REVIEW' };
  }

  const backoff = computeBackoff(job.attempt);

  if (canAutoRetry(failureClass) && backoff.allowed) {
    const nextAvailableAt = now + (backoff.delayMs ?? 0);
    await queue.enqueue({
      ...job,
      attempt: backoff.nextAttempt ?? job.attempt + 1,
      availableAt: nextAvailableAt,
    });
    return { status: 'RETRIED', nextAvailableAt };
  }

  await queue.deadLetter(job, outcome.reason ?? 'TERMINAL_FAILURE');
  return { status: 'DEAD_LETTERED' };
}
