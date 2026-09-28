// ARMA API Hub — durable job queue abstraction.
//
// Webhook delivery and durable jobs MUST NOT depend on short-lived frontend
// functions. This module defines the queue contract the worker consumes. The
// in-memory implementation is for local development and tests only; production
// uses a durable broker (see the runtime ADR).

export interface Job<T = unknown> {
  readonly jobId: string;
  readonly type: string;
  readonly payload: T;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly enqueuedAt: number;
  readonly availableAt: number;
}

export interface Queue<T = unknown> {
  enqueue(job: Job<T>): Promise<void>;
  /** Reserve the next available job, or null when none is ready. */
  reserve(now: number): Promise<Job<T> | null>;
  ack(jobId: string): Promise<void>;
  /** Move a job to the dead-letter queue after exhausting attempts. */
  deadLetter(job: Job<T>, reason: string): Promise<void>;
  size(): Promise<number>;
}

/** Deterministic in-memory queue for local development and tests. */
export class InMemoryQueue<T = unknown> implements Queue<T> {
  private readonly ready: Job<T>[] = [];
  private readonly inFlight = new Map<string, Job<T>>();
  private readonly dead: { job: Job<T>; reason: string }[] = [];

  async enqueue(job: Job<T>): Promise<void> {
    this.ready.push(job);
    this.ready.sort((a, b) => a.availableAt - b.availableAt);
  }

  async reserve(now: number): Promise<Job<T> | null> {
    const index = this.ready.findIndex((job) => job.availableAt <= now);
    if (index === -1) return null;
    const [job] = this.ready.splice(index, 1);
    if (!job) return null;
    this.inFlight.set(job.jobId, job);
    return job;
  }

  async ack(jobId: string): Promise<void> {
    this.inFlight.delete(jobId);
  }

  async deadLetter(job: Job<T>, reason: string): Promise<void> {
    this.inFlight.delete(job.jobId);
    this.dead.push({ job, reason });
  }

  async size(): Promise<number> {
    return this.ready.length;
  }

  deadLetterCount(): number {
    return this.dead.length;
  }
}
