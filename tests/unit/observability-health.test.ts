// Phase 9 — operational health state machine.
//
// The honesty rules: UNKNOWN never becomes AVAILABLE; a stale mandatory check
// cannot support health; HEALTHY is never COMPLIANT.

import { describe, expect, it } from 'vitest';
import {
  aggregateDependencyStates,
  assertOperationalStateVocabulary,
  deriveOperationalState,
  type HealthCheck,
} from '@arma/observability';

const NOW = 1_700_000_000_000;
const FRESH = 60_000;

function check(overrides: Partial<HealthCheck> = {}): HealthCheck {
  return { name: 'core', mandatory: true, ok: true, observedAt: NOW, ...overrides };
}

function derive(checks: readonly HealthCheck[], killSwitchEngaged?: boolean) {
  return deriveOperationalState({
    checks,
    now: NOW,
    freshnessWindowMs: FRESH,
    ...(killSwitchEngaged !== undefined ? { killSwitchEngaged } : {}),
  });
}

describe('health derivation', () => {
  it('returns UNKNOWN when there are no checks at all', () => {
    expect(derive([]).state).toBe('UNKNOWN');
  });

  it('returns AVAILABLE only when every check is fresh and ok', () => {
    const result = derive([check(), check({ name: 'product', mandatory: false })]);
    expect(result.state).toBe('AVAILABLE');
    expect(result.complianceClaim).toBe('NONE');
    expect(result.certificationClaim).toBe('NONE');
  });

  it('returns UNKNOWN when a mandatory check is stale', () => {
    const result = derive([check({ observedAt: NOW - FRESH - 1 })]);
    expect(result.state).toBe('UNKNOWN');
    expect(result.staleChecks).toContain('core');
  });

  it('returns UNKNOWN when every check is stale', () => {
    const result = derive([
      check({ observedAt: NOW - FRESH - 1 }),
      check({ name: 'optional', mandatory: false, observedAt: NOW - FRESH - 1 }),
    ]);
    expect(result.state).toBe('UNKNOWN');
  });

  it('returns UNAVAILABLE when a fresh mandatory check fails', () => {
    const result = derive([check({ ok: false })]);
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.failingChecks).toContain('core');
  });

  it('returns DEGRADED when only an optional check fails', () => {
    const result = derive([check(), check({ name: 'connector', mandatory: false, ok: false })]);
    expect(result.state).toBe('DEGRADED');
  });

  it('lets a stale mandatory check beat a failing optional check (UNKNOWN, not DEGRADED)', () => {
    const result = derive([
      check({ observedAt: NOW - FRESH - 1 }),
      check({ name: 'connector', mandatory: false, ok: false }),
    ]);
    expect(result.state).toBe('UNKNOWN');
  });

  it('returns UNAVAILABLE when the kill switch is engaged, regardless of checks', () => {
    const result = derive([check()], true);
    expect(result.state).toBe('UNAVAILABLE');
  });

  it('never emits a compliance word as a state', () => {
    expect(() => assertOperationalStateVocabulary()).not.toThrow();
    for (const state of ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']) {
      expect(['COMPLIANT', 'CERTIFIED', 'SECURE']).not.toContain(state);
    }
  });
});

describe('dependency aggregation', () => {
  it('treats UNKNOWN as not healthy', () => {
    expect(aggregateDependencyStates(['AVAILABLE', 'UNKNOWN'])).toBe('UNKNOWN');
  });

  it('escalates UNAVAILABLE over DEGRADED', () => {
    expect(aggregateDependencyStates(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'])).toBe('UNAVAILABLE');
  });

  it('returns UNKNOWN for an empty dependency set', () => {
    expect(aggregateDependencyStates([])).toBe('UNKNOWN');
  });
});
