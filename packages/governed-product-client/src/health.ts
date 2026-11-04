// FSTS Governed Product Client — health observation.
//
// AMENDMENT 3 — HEALTH AUTHORITY.
//
// The Compliance Core owns authoritative integration-health derivation
// (`integrationHealth.ts`). Callers submit raw telemetry COUNTERS only and may
// never assert a state. The SDK therefore does NOT compute, infer, or manufacture
// HEALTHY | DEGRADED | UNHEALTHY | UNKNOWN. It only OBSERVES a state the Core
// already derived, and reports UNKNOWN when no fresh Core observation exists.
//
// HEALTHY != COMPLIANT. Health is operational status only.

import type { HealthStatus } from './constants.js';
import { HEALTH_STATUSES } from './constants.js';

/**
 * A health observation. `status` is echoed from a Core-derived report; the SDK
 * never produces it from counters. `source` makes the provenance explicit.
 */
export interface HealthReport {
  readonly status: HealthStatus;
  readonly source: 'CORE_OBSERVED' | 'NO_CORE_OBSERVATION';
  readonly observedAt: number;
  readonly stalenessMs: number;
  readonly correlationId: string;
  /** Structural: health is never a compliance or certification claim. */
  readonly complianceClaim: 'NONE';
  readonly certificationClaim: 'NONE';
}

/** A Core-derived health observation the Hub relays. */
export interface CoreHealthObservation {
  readonly status: HealthStatus;
  readonly observedAt: number;
}

/**
 * Observe health. If there is no Core observation, or it is older than
 * `maxStalenessMs`, the report is UNKNOWN — never HEALTHY. The SDK does not
 * derive a state; it only reflects what the Core already decided.
 */
export function observeHealth(input: {
  observation: CoreHealthObservation | null;
  now: number;
  maxStalenessMs: number;
  correlationId: string;
}): HealthReport {
  const base = { complianceClaim: 'NONE' as const, certificationClaim: 'NONE' as const };
  if (!input.observation) {
    return {
      ...base,
      status: 'UNKNOWN',
      source: 'NO_CORE_OBSERVATION',
      observedAt: input.now,
      stalenessMs: 0,
      correlationId: input.correlationId,
    };
  }
  const stalenessMs = Math.max(0, input.now - input.observation.observedAt);
  const stale = stalenessMs > input.maxStalenessMs;
  const status: HealthStatus = stale ? 'UNKNOWN' : input.observation.status;
  return {
    ...base,
    status,
    source: 'CORE_OBSERVED',
    observedAt: input.observation.observedAt,
    stalenessMs,
    correlationId: input.correlationId,
  };
}

/**
 * Guard: a caller may submit telemetry COUNTERS but never a health STATE. This
 * rejects any attempt to assert a state directly.
 */
export function assertCountersNotState(input: unknown): void {
  if (input === null || typeof input !== 'object') return;
  const obj = input as Record<string, unknown>;
  if (
    typeof obj['status'] === 'string' &&
    (HEALTH_STATUSES as readonly string[]).includes(obj['status'])
  ) {
    throw new Error('callers may submit telemetry counters only; a health state is Core-derived');
  }
}
