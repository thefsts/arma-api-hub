// Phase 9 — runtime-validated observability contracts.
//
// These are the wire/database shapes. They are strict: an unknown key rejects,
// and every observation carries explicit non-claims.

import { describe, expect, it } from 'vitest';
import {
  OBSERVABILITY_HONESTY,
  dependencyHealthSnapshotSchema,
  failureCodeSchema,
  operationalStateSchema,
  sloWindowSchema,
  transportCostRecordSchema,
  transportObservationSchema,
} from '@arma/contracts';

const TRACE = `trc_${'a'.repeat(32)}`;
const OBS = `obs_${'b'.repeat(32)}`;

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: OBS,
    observedAt: 1_700_000_000_000,
    kind: 'REQUEST',
    traceId: TRACE,
    complianceClaim: 'NONE',
    certificationClaim: 'NONE',
    ...overrides,
  };
}

describe('transport observation contract', () => {
  it('accepts a valid observation', () => {
    expect(transportObservationSchema.safeParse(observation()).success).toBe(true);
  });

  it('rejects an unknown key (strict object)', () => {
    expect(transportObservationSchema.safeParse(observation({ extra: 1 })).success).toBe(false);
  });

  it('rejects a raw body, signature, or secret key', () => {
    for (const key of ['body', 'signature', 'secret', 'evidence']) {
      expect(transportObservationSchema.safeParse(observation({ [key]: 'x' })).success).toBe(false);
    }
  });

  it('requires the non-claim literals', () => {
    const { complianceClaim: _c, ...withoutClaim } = observation();
    expect(transportObservationSchema.safeParse(withoutClaim).success).toBe(false);
    expect(
      transportObservationSchema.safeParse(observation({ certificationClaim: 'CERTIFIED' }))
        .success,
    ).toBe(false);
  });

  it('rejects a non-Hub-minted trace id', () => {
    expect(
      transportObservationSchema.safeParse(observation({ traceId: 'req-12345678' })).success,
    ).toBe(false);
  });

  it('rejects an out-of-range status or latency', () => {
    expect(transportObservationSchema.safeParse(observation({ httpStatus: 99 })).success).toBe(
      false,
    );
    expect(transportObservationSchema.safeParse(observation({ latencyMs: -1 })).success).toBe(
      false,
    );
  });
});

describe('failure and state vocabularies', () => {
  it('accepts exactly the 18 governed failure codes', () => {
    for (const code of failureCodeSchema.options) {
      expect(failureCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(failureCodeSchema.options).toHaveLength(18);
    expect(failureCodeSchema.safeParse('PRODUCT_UNKNOWN').success).toBe(false);
  });

  it('accepts exactly the four operational states', () => {
    expect(operationalStateSchema.options).toEqual([
      'AVAILABLE',
      'DEGRADED',
      'UNAVAILABLE',
      'UNKNOWN',
    ]);
    expect(operationalStateSchema.safeParse('COMPLIANT').success).toBe(false);
    expect(operationalStateSchema.safeParse('CERTIFIED').success).toBe(false);
  });
});

describe('dependency health contract', () => {
  const snapshot = {
    snapshotId: 'snap-1',
    dependencyId: 'core',
    dependencyType: 'CORE',
    environment: 'PRODUCTION',
    state: 'AVAILABLE',
    observedAt: 1_700_000_000_000,
    complianceClaim: 'NONE',
    certificationClaim: 'NONE',
  };

  it('accepts a valid snapshot and rejects a compliance state', () => {
    expect(dependencyHealthSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      dependencyHealthSnapshotSchema.safeParse({ ...snapshot, state: 'COMPLIANT' }).success,
    ).toBe(false);
  });
});

describe('internal SLO contract', () => {
  const window = {
    windowId: 'win-1',
    windowStart: 1_700_000_000_000,
    windowEnd: 1_700_000_060_000,
    totalRequests: 100,
    successRatio: 0.99,
    latencyP50Ms: 10,
    latencyP95Ms: 100,
    latencyP99Ms: 200,
    availabilityRatio: 0.999,
    retryRate: 0.01,
    rateLimitEventRate: 0.001,
    deadLetterRate: 0,
    targetClass: 'INTERNAL_OPERATIONAL_TARGET',
    complianceClaim: 'NONE',
    breaches: [],
  };

  it('accepts a valid window and rejects SLA semantics', () => {
    expect(sloWindowSchema.safeParse(window).success).toBe(true);
    expect(sloWindowSchema.safeParse({ ...window, targetClass: 'SLA' }).success).toBe(false);
  });

  it('bounds ratios to [0, 1]', () => {
    expect(sloWindowSchema.safeParse({ ...window, successRatio: 1.5 }).success).toBe(false);
  });
});

describe('transport cost contract', () => {
  const record = {
    costEventId: 'cost-1',
    traceId: TRACE,
    costOwner: 'API_HUB',
    costCategory: 'EXTERNAL_API',
    amountMinor: 1250,
    currency: 'USD',
    billingPeriod: '2026-11',
    recordedAt: 1_700_000_000_000,
  };

  it('accepts a Hub-owned transport cost record', () => {
    expect(transportCostRecordSchema.safeParse(record).success).toBe(true);
  });

  it('rejects a foreign owner, category, or non-integer amount', () => {
    expect(transportCostRecordSchema.safeParse({ ...record, costOwner: 'AI_HUB' }).success).toBe(
      false,
    );
    expect(
      transportCostRecordSchema.safeParse({ ...record, costCategory: 'MODEL_INFERENCE' }).success,
    ).toBe(false);
    expect(transportCostRecordSchema.safeParse({ ...record, amountMinor: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('honesty constants', () => {
  it('publishes the non-claim and internal-target constants', () => {
    expect(OBSERVABILITY_HONESTY).toEqual({
      complianceClaim: 'NONE',
      certificationClaim: 'NONE',
      targetClass: 'INTERNAL_OPERATIONAL_TARGET',
    });
  });
});
