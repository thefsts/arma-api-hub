// FSTS Compliance Core — Phase 6
// API Hub Contract — safe degradation, partial failure, dependency outage.
// ---------------------------------------------------------------------------
// When a dependency is unavailable, Compliance Core degrades safely rather than
// failing hard or fabricating state. Degradation NEVER upgrades a response to
// OK and NEVER emits a compliance verdict. A degraded response is observable
// (status DEGRADED + degradationMode) so the Hub can surface it honestly.
// ---------------------------------------------------------------------------

import { DEGRADATION_MODES } from './constants.mjs';

/**
 * Choose a safe degradation for a request given dependency statuses.
 *   - read actions degrade to READ_ONLY when a non-authoritative dependency is down;
 *   - write actions degrade to QUEUED_WRITES when the write path is degraded;
 *   - telemetry-only actions degrade to TELEMETRY_ONLY;
 *   - a DOWN authoritative dependency (convex-compliance-core) yields a hard
 *     DEPENDENCY_UNAVAILABLE (never a fabricated success).
 * Returns { mode, code, retryable, hardFail }.
 */
export function planDegradation({ action, statuses }) {
  const map = statuses && typeof statuses === 'object' ? statuses : {};
  const authoritativeDown = map['convex-compliance-core'] === 'DOWN';
  if (authoritativeDown) {
    return { mode: 'NONE', code: 'DEPENDENCY_UNAVAILABLE', retryable: true, hardFail: true };
  }
  const isWrite = /\.(submit|write|distribute|request)$/.test(action);
  const isTelemetry = action === 'telemetry.write';
  const anyDegraded = Object.values(map).some((s) => s === 'DEGRADED');
  const anyDown = Object.values(map).some((s) => s === 'DOWN');

  if (isTelemetry && (anyDegraded || anyDown)) {
    return { mode: 'TELEMETRY_ONLY', code: 'DEGRADED_QUEUED', retryable: true, hardFail: false };
  }
  if (isWrite && (anyDegraded || anyDown)) {
    return { mode: 'QUEUED_WRITES', code: 'DEGRADED_QUEUED', retryable: true, hardFail: false };
  }
  if (!isWrite && (anyDegraded || anyDown)) {
    return { mode: 'READ_ONLY', code: 'DEGRADED_READ_ONLY', retryable: true, hardFail: false };
  }
  return { mode: 'NONE', code: null, retryable: false, hardFail: false };
}

/** Validate a degradation mode is a bounded member. */
export function isDegradationMode(mode) {
  return DEGRADATION_MODES.includes(mode);
}

/**
 * Partial failure: some sub-operations succeeded, others are deferred. The
 * response is DEGRADED with PARTIAL_FAILURE — never OK, never a verdict.
 */
export function planPartialFailure({ succeeded, deferred }) {
  const s = Array.isArray(succeeded) ? succeeded.length : 0;
  const d = Array.isArray(deferred) ? deferred.length : 0;
  if (d === 0) return { partial: false, code: null, degraded: false };
  return {
    partial: true,
    code: 'PARTIAL_FAILURE',
    degraded: true,
    succeeded: s,
    deferred: d,
  };
}
