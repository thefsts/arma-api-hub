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
  /**
   * Hold a job under a governance control (suspension, vendor shutdown,
   * spend-limit throttle/block, connector kill switch, temporary gate failure).
   * The job is preserved — never dead-lettered, never auto-retried — and does
   * NOT consume its retry budget. It can resume via `release` once the control
   * is lifted.
   */
  hold(job: Job<T>, reason: string): Promise<void>;
  /**
   * Quarantine a job whose delivery is AMBIGUOUS (a remote side may have
   * accepted). It is never auto-resumed; it waits for reconciliation/review.
   */
  holdForReconciliation(job: Job<T>, reason: string): Promise<void>;
  /** Resume every governance-held job (available immediately), preserving order. */
  release(now: number): Promise<number>;
  size(): Promise<number>;
}

/** Deterministic in-memory queue for local development and tests. */
export class InMemoryQueue<T = unknown> implements Queue<T> {
  private readonly ready: Job<T>[] = [];
  private readonly inFlight = new Map<string, Job<T>>();
  private readonly dead: { job: Job<T>; reason: string }[] = [];
  private readonly held: { job: Job<T>; reason: string }[] = [];
  private readonly quarantined: { job: Job<T>; reason: string }[] = [];

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

  async hold(job: Job<T>, reason: string): Promise<void> {
    this.inFlight.delete(job.jobId);
    this.held.push({ job, reason });
    // Preserve ordering information: held work resumes in original enqueue order.
    this.held.sort((a, b) => a.job.enqueuedAt - b.job.enqueuedAt);
  }

  async holdForReconciliation(job: Job<T>, reason: string): Promise<void> {
    this.inFlight.delete(job.jobId);
    this.quarantined.push({ job, reason });
  }

  async release(now: number): Promise<number> {
    const released = this.held.splice(0, this.held.length);
    for (const { job } of released) {
      this.ready.push({ ...job, availableAt: now });
    }
    // Stable sort keeps the held (enqueue) order for jobs released together.
    this.ready.sort((a, b) => a.availableAt - b.availableAt);
    return released.length;
  }

  async size(): Promise<number> {
    return this.ready.length;
  }

  deadLetterCount(): number {
    return this.dead.length;
  }

  heldCount(): number {
    return this.held.length;
  }

  reconciliationCount(): number {
    return this.quarantined.length;
  }
}
