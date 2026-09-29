// FSTS Compliance Core — Phase 6
// API Hub Contract — health / readiness.
// ---------------------------------------------------------------------------
// Health is liveness (the governed service is up). Readiness is dependency
// availability (Convex, audit ledger, idempotency store, telemetry sink). A
// service can be healthy but NOT ready — and readiness is never a compliance
// verdict (READY != CERTIFIED).
// ---------------------------------------------------------------------------

import { CONTRACT_ID, CONTRACT_VERSION, DEFAULT_API_VERSION } from './constants.mjs';

export const DEPENDENCIES = Object.freeze([
  'convex-compliance-core',
  'audit-ledger',
  'idempotency-store',
  'telemetry-sink',
]);

/** Build the health (liveness) payload. */
export function health() {
  return {
    status: 'OK',
    service: 'fsts-compliance-core',
    contract: CONTRACT_ID,
    contractVersion: CONTRACT_VERSION,
    apiVersion: DEFAULT_API_VERSION,
    phase: 6,
    authority: 'compliance-authority-state',
  };
}

/**
 * Build the readiness payload from explicit dependency statuses. `statuses` is
 * a map dependency -> 'UP' | 'DEGRADED' | 'DOWN'. Readiness is READY only when
 * every dependency is UP; otherwise NOT_READY (fail closed).
 */
export function readiness(statuses) {
  const map = statuses && typeof statuses === 'object' ? statuses : {};
  const dependencies = DEPENDENCIES.map((name) => ({
    name,
    status: ['UP', 'DEGRADED', 'DOWN'].includes(map[name]) ? map[name] : 'DOWN',
  }));
  const allUp = dependencies.every((d) => d.status === 'UP');
  const anyDown = dependencies.some((d) => d.status === 'DOWN');
  return {
    ready: allUp,
    status: allUp ? 'READY' : 'NOT_READY',
    degraded: !allUp && !anyDown,
    dependencies,
    // READY != CERTIFIED: readiness is an operational signal, never a verdict.
    complianceVerdict: 'NONE',
  };
}
