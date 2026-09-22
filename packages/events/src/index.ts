// ARMA API Hub — event helpers.
//
// Builds event envelopes and provides deterministic ordering and idempotency
// primitives. Events are append-only facts; consumers must be idempotent.

import { randomUUID } from 'node:crypto';
import { sha256Hex } from '@arma/crypto';
import type { EventEnvelope } from '@arma/contracts';

export interface BuildEventInput {
  readonly eventType: string;
  readonly stream: string;
  readonly sequence: number;
  readonly producer: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly classification: EventEnvelope['classification'];
  readonly payload: unknown;
  readonly occurredAt?: number;
  readonly schemaVersion?: string;
  readonly tenant?: EventEnvelope['tenant'];
}

/** Canonical JSON: stable key ordering for deterministic hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Build an event envelope with a payload hash over canonical JSON. */
export function buildEventEnvelope(input: BuildEventInput): EventEnvelope {
  const occurredAt = input.occurredAt ?? Date.now();
  const payloadHash = sha256Hex(canonicalJson(input.payload));
  const envelope: EventEnvelope = {
    schemaVersion: input.schemaVersion ?? '1.0.0',
    eventId: `evt-${randomUUID()}`,
    eventType: input.eventType,
    sequence: input.sequence,
    stream: input.stream,
    occurredAt: String(occurredAt),
    producer: input.producer,
    correlation: input.causationId
      ? { correlationId: input.correlationId, causationId: input.causationId }
      : { correlationId: input.correlationId },
    classification: input.classification,
    payloadHash,
    ...(input.tenant ? { tenant: input.tenant } : {}),
  };
  return envelope;
}

export interface OrderingCheck {
  readonly ok: boolean;
  readonly expectedSequence: number;
  readonly receivedSequence: number;
}

/** Detect an ordering gap for a stream given the last seen sequence. */
export function checkOrdering(lastSeenSequence: number, incomingSequence: number): OrderingCheck {
  const expected = lastSeenSequence + 1;
  return {
    ok: incomingSequence === expected,
    expectedSequence: expected,
    receivedSequence: incomingSequence,
  };
}
