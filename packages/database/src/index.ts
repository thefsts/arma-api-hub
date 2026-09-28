// ARMA API Hub — database contracts.
//
// Declares the persistence surface the control plane requires. Phase 0 defines
// the repository interfaces and the tables the runtime will need; it does NOT
// select or provision a production database. See the runtime ADR for the
// database requirements and tradeoffs.

import type { EventEnvelope, ServiceRecord, SignedReceipt } from '@arma/contracts';

/** Logical tables the control plane requires. */
export const REQUIRED_TABLES = [
  'services',
  'products',
  'capabilities',
  'connections',
  'contract_versions',
  'credentials',
  'events',
  'event_streams',
  'webhook_deliveries',
  'receipts',
  'idempotency_keys',
  'nonce_registry',
  'dead_letters',
  'connector_health',
  'kill_switches',
  'audit_events',
] as const;

export type RequiredTable = (typeof REQUIRED_TABLES)[number];

/** A transactional unit of work. Implementations must be all-or-nothing. */
export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface ServiceRepository {
  get(serviceId: string): Promise<ServiceRecord | null>;
  put(record: ServiceRecord): Promise<void>;
}

export interface EventRepository {
  append(envelope: EventEnvelope): Promise<void>;
  lastSequence(stream: string): Promise<number>;
}

export interface ReceiptRepository {
  put(receipt: SignedReceipt): Promise<void>;
  get(receiptId: string): Promise<SignedReceipt | null>;
}

/**
 * Idempotency + nonce registries must be enforced with unique indexes inside
 * the same transaction as the operation outcome so a partial write can never
 * poison the registry.
 */
export interface IdempotencyRepository {
  resolve(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<'FRESH' | 'DUPLICATE' | 'CONFLICT'>;
  record(scope: string, key: string, requestHash: string, outcomeRef: string): Promise<void>;
}

export interface NonceRepository {
  /** Atomically check-and-consume a nonce. Returns false when replayed. */
  consume(scope: string, nonce: string, windowMs: number): Promise<boolean>;
}

/**
 * Deterministic in-memory nonce registry for local development and tests.
 * Production uses a durable store with a unique index on (scope, nonce) so
 * check-and-consume is atomic across workers. The clock is injectable so
 * replay-window behavior is testable without wall-clock dependence.
 */
export class InMemoryNonceRepository implements NonceRepository {
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  async consume(scope: string, nonce: string, windowMs: number): Promise<boolean> {
    const t = this.now();
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= t) this.seen.delete(key);
    }
    const key = `${scope}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, t + windowMs);
    return true;
  }
}

/**
 * Deterministic in-memory idempotency registry for local development and tests.
 * `resolve` distinguishes a fresh key, an idempotent duplicate (same request
 * hash), and a conflict (same key, different request hash).
 */
export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly records = new Map<string, { requestHash: string; outcomeRef: string }>();

  async resolve(
    scope: string,
    key: string,
    requestHash: string,
  ): Promise<'FRESH' | 'DUPLICATE' | 'CONFLICT'> {
    const existing = this.records.get(`${scope}:${key}`);
    if (!existing) return 'FRESH';
    return existing.requestHash === requestHash ? 'DUPLICATE' : 'CONFLICT';
  }

  async record(scope: string, key: string, requestHash: string, outcomeRef: string): Promise<void> {
    this.records.set(`${scope}:${key}`, { requestHash, outcomeRef });
  }
}
