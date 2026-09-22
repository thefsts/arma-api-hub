// ARMA API Hub — durable job processor.
//
// Processes jobs with retry and dead-letter handling. The processor is a pure
// function of (job, handler) so it can be driven deterministically in tests.

import type { Job, Queue } from './queue.js';
import { canAutoRetry, computeBackoff, type FailureClass } from './retry.js';

export interface JobOutcome {
  readonly ok: boolean;
  readonly failureClass?: FailureClass;
  readonly reason?: string;
}

export type JobHandler<T> = (job: Job<T>) => Promise<JobOutcome>;

export interface ProcessResult {
  readonly status: 'ACKED' | 'RETRIED' | 'DEAD_LETTERED';
  readonly nextAvailableAt?: number;
}

/**
 * Process a single reserved job. On a clean retryable failure the job is
 * re-enqueued with backoff; on terminal/ambiguous failure or exhausted
 * attempts it is dead-lettered.
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
