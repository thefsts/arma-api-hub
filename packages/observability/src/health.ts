// ARMA API Hub — operational health state machine.
//
// PM-locked vocabulary: exactly AVAILABLE / DEGRADED / UNAVAILABLE / UNKNOWN.
// There is no COMPLIANT, CERTIFIED, or SECURE operational state. A healthy
// transport says nothing about whether a tenant, product, or control is
// compliant.
//
// The critical honesty rule: UNKNOWN must never silently become healthy. A
// missing, stale, or unverifiable mandatory check yields UNKNOWN — never
// AVAILABLE.

import { FORBIDDEN_STATE_WORDS, OPERATIONAL_STATES, type OperationalState } from './telemetry.js';

export interface HealthCheck {
  readonly name: string;
  /** A mandatory check failing makes the boundary UNAVAILABLE. */
  readonly mandatory: boolean;
  readonly ok: boolean;
  /** Server-authoritative time the check was observed. */
  readonly observedAt: number;
}

export interface HealthEvaluationInput {
  readonly checks: readonly HealthCheck[];
  readonly now: number;
  /** A check older than this is stale and cannot support AVAILABLE. */
  readonly freshnessWindowMs: number;
  readonly killSwitchEngaged?: boolean;
}

export interface HealthEvaluation {
  readonly state: OperationalState;
  readonly reasons: readonly string[];
  readonly staleChecks: readonly string[];
  readonly failingChecks: readonly string[];
  readonly complianceClaim: 'NONE';
  readonly certificationClaim: 'NONE';
}

/** Assert the operational-state vocabulary is exactly the approved four. */
export function assertOperationalStateVocabulary(): void {
  for (const state of OPERATIONAL_STATES) {
    if ((FORBIDDEN_STATE_WORDS as readonly string[]).includes(state.toUpperCase())) {
      throw new Error(`FORBIDDEN_OPERATIONAL_STATE: ${state}`);
    }
  }
  if (OPERATIONAL_STATES.length !== 4) {
    throw new Error('OPERATIONAL_STATE_SET_MUST_HAVE_FOUR_MEMBERS');
  }
}

/**
 * Derive the operational state. Fail-closed ordering:
 *
 *   1. kill switch engaged        -> UNAVAILABLE
 *   2. no checks at all           -> UNKNOWN
 *   3. any mandatory check stale  -> UNKNOWN (cannot verify, do not claim health)
 *   4. all checks stale           -> UNKNOWN
 *   5. any mandatory check fails  -> UNAVAILABLE
 *   6. any optional check fails   -> DEGRADED
 *   7. otherwise                  -> AVAILABLE
 */
export function deriveOperationalState(input: HealthEvaluationInput): HealthEvaluation {
  assertOperationalStateVocabulary();

  const staleChecks = input.checks
    .filter((check) => input.now - check.observedAt > input.freshnessWindowMs)
    .map((check) => check.name);
  const failingChecks = input.checks.filter((check) => !check.ok).map((check) => check.name);

  const base = {
    staleChecks,
    failingChecks,
    complianceClaim: 'NONE' as const,
    certificationClaim: 'NONE' as const,
  };

  if (input.killSwitchEngaged === true) {
    return { ...base, state: 'UNAVAILABLE', reasons: ['KILL_SWITCH_ENGAGED'] };
  }
  if (input.checks.length === 0) {
    return { ...base, state: 'UNKNOWN', reasons: ['NO_HEALTH_CHECKS'] };
  }
  const staleMandatory = input.checks.filter(
    (check) => check.mandatory && input.now - check.observedAt > input.freshnessWindowMs,
  );
  if (staleMandatory.length > 0) {
    return { ...base, state: 'UNKNOWN', reasons: ['MANDATORY_CHECK_STALE'] };
  }
  if (staleChecks.length === input.checks.length) {
    return { ...base, state: 'UNKNOWN', reasons: ['ALL_CHECKS_STALE'] };
  }
  const failingMandatory = input.checks.filter((check) => check.mandatory && !check.ok);
  if (failingMandatory.length > 0) {
    return { ...base, state: 'UNAVAILABLE', reasons: ['MANDATORY_CHECK_FAILED'] };
  }
  const failingOptional = input.checks.filter((check) => !check.mandatory && !check.ok);
  if (failingOptional.length > 0) {
    return { ...base, state: 'DEGRADED', reasons: ['OPTIONAL_CHECK_FAILED'] };
  }
  return { ...base, state: 'AVAILABLE', reasons: [] };
}

/**
 * Aggregate dependency states into a single boundary state.
 * Any UNAVAILABLE dependency makes the boundary UNAVAILABLE; any UNKNOWN
 * dependency prevents a claim of AVAILABLE.
 */
export function aggregateDependencyStates(states: readonly OperationalState[]): OperationalState {
  if (states.length === 0) return 'UNKNOWN';
  if (states.includes('UNAVAILABLE')) return 'UNAVAILABLE';
  if (states.includes('UNKNOWN')) return 'UNKNOWN';
  if (states.includes('DEGRADED')) return 'DEGRADED';
  return 'AVAILABLE';
}
