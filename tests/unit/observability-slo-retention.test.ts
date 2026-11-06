// Phase 9 — internal SLO targets and governed retention.
//
// PM corrections C3 (internal targets, never SLA) and C4 (per-policy retention,
// never a hardcoded universal window).

import { describe, expect, it } from 'vitest';
import {
  CONSERVATIVE_FALLBACK_DAYS,
  INITIAL_INTERNAL_TARGETS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  SLO_COMPLIANCE_CLAIM,
  SLO_TARGET_CLASS,
  assertInternalTargetSemantics,
  computeSloWindow,
  percentile,
  resolveRetention,
  retentionCutoff,
} from '@arma/observability';

describe('percentile', () => {
  it('returns 0 for an empty set', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('uses nearest-rank on a sorted copy without mutating input', () => {
    const values = [5, 1, 4, 2, 3];
    expect(percentile(values, 50)).toBe(3);
    expect(percentile(values, 95)).toBe(5);
    expect(values).toEqual([5, 1, 4, 2, 3]);
  });
});

describe('internal SLO windows', () => {
  const base = {
    windowId: 'win-1',
    windowStart: 1_700_000_000_000,
    windowEnd: 1_700_000_060_000,
    totalRequests: 100,
    successes: 100,
    failures: 0,
    latenciesMs: [10, 20, 30, 40, 50],
    retries: 0,
    rateLimited: 0,
    deadLettered: 0,
    dependencyUnavailableMinutes: 0,
    observedMinutes: 60,
  };

  it('labels every window as an internal operational target with no compliance claim', () => {
    const window = computeSloWindow(base);
    expect(window.targetClass).toBe(SLO_TARGET_CLASS);
    expect(window.complianceClaim).toBe(SLO_COMPLIANCE_CLAIM);
    expect(window.evaluatedAgainst).toBe(INITIAL_INTERNAL_TARGETS);
    expect(() =>
      assertInternalTargetSemantics(window as unknown as Record<string, unknown>),
    ).not.toThrow();
  });

  it('reports no breaches for a clean window', () => {
    expect(computeSloWindow(base).breaches).toEqual([]);
  });

  it('reports breaches with internal-target wording, never SLA wording', () => {
    const window = computeSloWindow({
      ...base,
      successes: 50,
      failures: 50,
      latenciesMs: [500, 2000],
      retries: 10,
      rateLimited: 5,
      deadLettered: 5,
      dependencyUnavailableMinutes: 30,
    });
    expect(window.breaches.length).toBeGreaterThan(0);
    for (const breach of window.breaches) {
      expect(breach).toMatch(/INTERNAL_TARGET/);
      expect(breach.toUpperCase()).not.toContain('SLA');
    }
  });

  it('rejects a record that claims SLA semantics', () => {
    expect(() =>
      assertInternalTargetSemantics({ targetClass: 'SLA', complianceClaim: 'NONE' }),
    ).toThrow(/SLO_TARGET_CLASS/);
    expect(() =>
      assertInternalTargetSemantics({
        targetClass: SLO_TARGET_CLASS,
        complianceClaim: 'COMPLIANT',
      }),
    ).toThrow(/SLO_COMPLIANCE_CLAIM/);
  });
});

describe('retention resolution', () => {
  it('falls back conservatively when no policy is supplied', () => {
    const resolution = resolveRetention({
      environment: 'PRODUCTION',
      dataClassification: 'INTERNAL',
    });
    expect(resolution.source).toBe('CONSERVATIVE_FALLBACK');
    expect(resolution.retentionDays).toBe(CONSERVATIVE_FALLBACK_DAYS);
    expect(resolution.policyRef).toBe('fallback:conservative');
  });

  it('prefers a classification override over an environment override', () => {
    const resolution = resolveRetention({
      environment: 'PRODUCTION',
      dataClassification: 'REGULATED',
      policy: {
        policyRef: 'policy.phase9',
        byEnvironment: { PRODUCTION: 90 },
        byClassification: { REGULATED: 180 },
      },
    });
    expect(resolution.source).toBe('POLICY_CLASSIFICATION');
    expect(resolution.retentionDays).toBe(180);
  });

  it('uses the environment override when no classification override applies', () => {
    const resolution = resolveRetention({
      environment: 'PRODUCTION',
      dataClassification: 'INTERNAL',
      policy: { policyRef: 'policy.phase9', byEnvironment: { PRODUCTION: 90 } },
    });
    expect(resolution.source).toBe('POLICY_ENVIRONMENT');
    expect(resolution.retentionDays).toBe(90);
  });

  it('clamps below the audit floor and above the absolute maximum', () => {
    expect(
      resolveRetention({
        environment: 'PRODUCTION',
        dataClassification: 'INTERNAL',
        policy: { policyRef: 'p', byClassification: { INTERNAL: 1 } },
      }).retentionDays,
    ).toBe(MIN_RETENTION_DAYS);
    expect(
      resolveRetention({
        environment: 'PRODUCTION',
        dataClassification: 'INTERNAL',
        policy: { policyRef: 'p', byClassification: { INTERNAL: 10_000 } },
      }).retentionDays,
    ).toBe(MAX_RETENTION_DAYS);
  });

  it('honours a policy maxDays cap below the absolute maximum', () => {
    const resolution = resolveRetention({
      environment: 'PRODUCTION',
      dataClassification: 'INTERNAL',
      policy: { policyRef: 'p', byClassification: { INTERNAL: 300 }, maxDays: 60 },
    });
    expect(resolution.retentionDays).toBe(60);
    expect(resolution.clamped).toBe(true);
  });

  it('computes a cutoff in the past', () => {
    const now = 1_700_000_000_000;
    const resolution = resolveRetention({
      environment: 'PRODUCTION',
      dataClassification: 'INTERNAL',
      policy: { policyRef: 'p', byClassification: { INTERNAL: 30 } },
    });
    expect(retentionCutoff(now, resolution)).toBe(now - 30 * 86_400_000);
  });
});
