// Durable worker behavior: retry with backoff, dead-lettering, and the rule
// that ambiguous outcomes are never blindly retried.

import { describe, expect, it } from 'vitest';
import {
  canAutoRetry,
  computeBackoff,
  InMemoryQueue,
  MAX_RETRY_ATTEMPTS,
  processJob,
  RETRY_SCHEDULE_MS,
  type Job,
} from '@arma/worker';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: 'job-00000001',
    type: 'webhook.deliver',
    payload: { deliveryId: 'del-00000001' },
    attempt: 0,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    enqueuedAt: 1_700_000_000_000,
    availableAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('durable worker', () => {
  it('acks a successful job', async () => {
    const queue = new InMemoryQueue();
    const job = makeJob();
    await queue.enqueue(job);
    const reserved = await queue.reserve(1_700_000_000_000);
    expect(reserved).not.toBeNull();
    const result = await processJob(queue, job, async () => ({ ok: true }), 1_700_000_000_000);
    expect(result.status).toBe('ACKED');
  });

  it('retries a clean retryable failure with the scheduled backoff', async () => {
    const queue = new InMemoryQueue();
    const job = makeJob({ attempt: 0 });
    const now = 1_700_000_000_000;
    const result = await processJob(
      queue,
      job,
      async () => ({ ok: false, failureClass: 'CLEAN_RETRYABLE', reason: 'TRANSPORT' }),
      now,
    );
    expect(result.status).toBe('RETRIED');
    expect(result.nextAvailableAt).toBe(now + RETRY_SCHEDULE_MS[0]);
    expect(await queue.size()).toBe(1);
  });

  it('dead-letters a terminal failure', async () => {
    const queue = new InMemoryQueue();
    const job = makeJob();
    const result = await processJob(
      queue,
      job,
      async () => ({ ok: false, failureClass: 'TERMINAL', reason: 'INVALID' }),
      1_700_000_000_000,
    );
    expect(result.status).toBe('DEAD_LETTERED');
    expect(queue.deadLetterCount()).toBe(1);
  });

  it('never blindly retries an ambiguous outcome', async () => {
    const queue = new InMemoryQueue();
    const job = makeJob();
    const result = await processJob(
      queue,
      job,
      async () => ({ ok: false, failureClass: 'AMBIGUOUS', reason: 'UNKNOWN_SIDE_EFFECT' }),
      1_700_000_000_000,
    );
    expect(result.status).toBe('DEAD_LETTERED');
    expect(queue.deadLetterCount()).toBe(1);
  });

  it('dead-letters once retries are exhausted', async () => {
    const queue = new InMemoryQueue();
    const job = makeJob({ attempt: MAX_RETRY_ATTEMPTS });
    const result = await processJob(
      queue,
      job,
      async () => ({ ok: false, failureClass: 'CLEAN_RETRYABLE', reason: 'TRANSPORT' }),
      1_700_000_000_000,
    );
    expect(result.status).toBe('DEAD_LETTERED');
  });

  it('computes a deterministic backoff schedule', () => {
    expect(computeBackoff(0)).toEqual({ allowed: true, delayMs: 1_000, nextAttempt: 1 });
    expect(computeBackoff(1)).toEqual({ allowed: true, delayMs: 5_000, nextAttempt: 2 });
    expect(computeBackoff(4)).toEqual({ allowed: true, delayMs: 600_000, nextAttempt: 5 });
    expect(computeBackoff(MAX_RETRY_ATTEMPTS).allowed).toBe(false);
  });

  it('only auto-retries clean retryable failures', () => {
    expect(canAutoRetry('CLEAN_RETRYABLE')).toBe(true);
    expect(canAutoRetry('AMBIGUOUS')).toBe(false);
    expect(canAutoRetry('TERMINAL')).toBe(false);
  });
});
