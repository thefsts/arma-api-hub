// Convex observability control-plane tests (Phase 9).
//
// These tests exercise every one of the eleven internal operations in
// `convex/observability.ts`. They prove the operational properties that matter
// for a production transport plane:
//
//   * writes are privileged and idempotent-by-identity (duplicate ids CONFLICT)
//   * reads enforce the caller's server-derived service / tenant / environment
//     scope and fail closed on any cross-boundary attempt
//   * derived health never silently upgrades UNKNOWN to AVAILABLE
//   * every stored and returned row carries `complianceClaim: 'NONE'` and
//     `certificationClaim: 'NONE'`
//   * purge is bounded and deletes only rows whose retention window elapsed
//
// The Hub transports; the Core decides. No test here asserts a compliance or
// certification outcome, because the Hub is not permitted to produce one.

import { describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';

const SVC_A = 'svc-a';
const SVC_B = 'svc-b';
const TEN_A = 'ten_a';
const TEN_B = 'ten_b';
const PRODUCT = 'arma-sentinel';

/** A scoped operator: service svc-a, tenant ten_a, DEVELOPMENT + PRODUCTION. */
async function seedOperator(t: TestConvex, overrides: Record<string, unknown> = {}) {
  await seedAuthorization(t, {
    principalId: 'obs-op',
    principalType: 'HUMAN',
    roles: ['operator'],
    serviceIds: [SVC_A],
    tenantIds: [TEN_A],
    environments: ['DEVELOPMENT', 'PRODUCTION'],
    ...overrides,
  });
  return t.withIdentity(identity('obs-op'));
}

/** A read-only viewer bound to the same scope. */
async function seedViewer(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: 'obs-viewer',
    principalType: 'HUMAN',
    roles: ['viewer'],
    serviceIds: [SVC_A],
    tenantIds: [TEN_A],
    environments: ['DEVELOPMENT'],
  });
  return t.withIdentity(identity('obs-viewer'));
}

let counter = 0;

/** Build a minimal valid observation input. */
function observation(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    observationId: `obs_${String(counter).padStart(8, '0')}`,
    observedAt: 1_700_000_000_000 + counter,
    kind: 'REQUEST' as const,
    traceId: 'trc_0123456789abcdef0123456789abcdef',
    callerCorrelationRef: 'corr-1',
    productId: PRODUCT,
    tenantId: TEN_A,
    environment: 'DEVELOPMENT' as const,
    serviceId: SVC_A,
    outcome: 'ALLOWED' as const,
    complianceClaim: 'NONE' as const,
    certificationClaim: 'NONE' as const,
    ...overrides,
  };
}

/** Build a minimal valid dependency health snapshot. */
function snapshot(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    snapshotId: `snap_${String(counter).padStart(8, '0')}`,
    dependencyId: 'dep-core',
    dependencyType: 'CORE' as const,
    environment: 'DEVELOPMENT' as const,
    state: 'AVAILABLE' as const,
    observedAt: 1_700_000_000_000 + counter,
    complianceClaim: 'NONE' as const,
    certificationClaim: 'NONE' as const,
    ...overrides,
  };
}

/** Build a minimal valid internal SLO window. */
function sloWindow(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    windowId: `slo_${String(counter).padStart(8, '0')}`,
    windowStart: 1_700_000_000_000,
    windowEnd: 1_700_000_600_000,
    totalRequests: 100,
    successRatio: 0.99,
    latencyP50Ms: 10,
    latencyP95Ms: 40,
    latencyP99Ms: 90,
    availabilityRatio: 0.999,
    retryRate: 0.01,
    rateLimitEventRate: 0.0,
    deadLetterRate: 0.0,
    targetClass: 'INTERNAL_OPERATIONAL_TARGET' as const,
    complianceClaim: 'NONE' as const,
    breaches: [],
    ...overrides,
  };
}

/** Build a minimal valid transport cost record. */
function costRecord(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    costRecordId: `cost_${String(counter).padStart(8, '0')}`,
    traceId: 'trc_0123456789abcdef0123456789abcdef',
    serviceId: SVC_A,
    productId: PRODUCT,
    tenantId: TEN_A,
    environment: 'DEVELOPMENT' as const,
    category: 'EXTERNAL_API' as const,
    amountMinor: 25,
    currency: 'USD',
    observedAt: 1_700_000_000_000 + counter,
    costOwner: 'API_HUB' as const,
    complianceClaim: 'NONE' as const,
    ...overrides,
  };
}

// --- recordObservation -------------------------------------------------------

describe('recordObservation', () => {
  it('persists a transport observation and returns its id', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = observation();

    const id = await op.mutation(internal.observability.recordObservation, {
      observation: input,
      retentionPolicyRef: 'policy:standard',
      expiresAt: 1_800_000_000_000,
    });

    expect(id).toBe(input.observationId);
    const rows = await t.run((ctx) => ctx.db.query('transportObservations').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.complianceClaim).toBe('NONE');
    expect(rows[0]?.certificationClaim).toBe('NONE');
    expect(rows[0]?.retentionPolicyRef).toBe('policy:standard');
    expect(rows[0]?.expiresAt).toBe(1_800_000_000_000);
  });

  it('rejects a duplicate observationId with CONFLICT', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = observation();

    await op.mutation(internal.observability.recordObservation, { observation: input });
    await expect(
      op.mutation(internal.observability.recordObservation, { observation: input }),
    ).rejects.toThrow(/CONFLICT|already exists/i);
  });

  it('fails closed for an environment outside the caller grant', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.recordObservation, {
        observation: observation({ environment: 'PREVIEW' }),
      }),
    ).rejects.toThrow(/FORBIDDEN|environment/i);
  });

  it('denies a read-only viewer the writer role', async () => {
    const t = setup();
    const viewer = await seedViewer(t);
    await expect(
      viewer.mutation(internal.observability.recordObservation, { observation: observation() }),
    ).rejects.toThrow(/FORBIDDEN|role/i);
  });
});

// --- recordHop ---------------------------------------------------------------

describe('recordHop', () => {
  it('records a governed hop observation', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = observation({ kind: 'HOP', hop: 'HUB_TO_CORE', direction: 'OUTBOUND' });

    const id = await op.mutation(internal.observability.recordHop, { observation: input });
    expect(id).toBe(input.observationId);
  });

  it('rejects an observation that is not of kind HOP', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.recordHop, {
        observation: observation({ kind: 'REQUEST' }),
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|kind HOP/i);
  });

  it('rejects a HOP observation with no hop value', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.recordHop, {
        observation: observation({ kind: 'HOP' }),
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|hop value/i);
  });

  it('rejects a duplicate hop id with CONFLICT', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = observation({ kind: 'HOP', hop: 'PRODUCT_TO_HUB' });
    await op.mutation(internal.observability.recordHop, { observation: input });
    await expect(
      op.mutation(internal.observability.recordHop, { observation: input }),
    ).rejects.toThrow(/CONFLICT/i);
  });
});

// --- getTraceByCorrelation ---------------------------------------------------

describe('getTraceByCorrelation', () => {
  it('returns the full trace ordered by observation time', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const trace = 'trc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await op.mutation(internal.observability.recordObservation, {
      observation: observation({ traceId: trace, observedAt: 1_700_000_000_300, kind: 'RESPONSE' }),
    });
    await op.mutation(internal.observability.recordObservation, {
      observation: observation({ traceId: trace, observedAt: 1_700_000_000_100, kind: 'REQUEST' }),
    });

    const rows = await op.query(internal.observability.getTraceByCorrelation, {
      serviceId: SVC_A,
      tenantId: TEN_A,
      productId: PRODUCT,
      callerCorrelationRef: 'corr-1',
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(['REQUEST', 'RESPONSE']);
  });

  it('returns an empty array for an unknown caller correlation reference', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordObservation, { observation: observation() });

    const rows = await op.query(internal.observability.getTraceByCorrelation, {
      serviceId: SVC_A,
      tenantId: TEN_A,
      productId: PRODUCT,
      callerCorrelationRef: 'never-seen',
    });
    expect(rows).toEqual([]);
  });

  it('never returns rows for a different product', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordObservation, {
      observation: observation({ productId: 'other-product' }),
    });

    const rows = await op.query(internal.observability.getTraceByCorrelation, {
      serviceId: SVC_A,
      tenantId: TEN_A,
      productId: PRODUCT,
      callerCorrelationRef: 'corr-1',
    });
    expect(rows).toEqual([]);
  });

  it('denies a cross-tenant read', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.query(internal.observability.getTraceByCorrelation, {
        serviceId: SVC_A,
        tenantId: TEN_B,
        productId: PRODUCT,
        callerCorrelationRef: 'corr-1',
      }),
    ).rejects.toThrow(/FORBIDDEN|tenant/i);
  });

  it('denies a cross-service read', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.query(internal.observability.getTraceByCorrelation, {
        serviceId: SVC_B,
        tenantId: TEN_A,
        productId: PRODUCT,
        callerCorrelationRef: 'corr-1',
      }),
    ).rejects.toThrow(/FORBIDDEN|service/i);
  });

  it('is readable by a viewer', async () => {
    const t = setup();
    const viewer = await seedViewer(t);
    const rows = await viewer.query(internal.observability.getTraceByCorrelation, {
      serviceId: SVC_A,
      tenantId: TEN_A,
      productId: PRODUCT,
      callerCorrelationRef: 'corr-1',
    });
    expect(rows).toEqual([]);
  });
});

// --- listFailuresByWindow ----------------------------------------------------

describe('listFailuresByWindow', () => {
  it('returns only rows carrying a bounded failure code inside the window', async () => {
    const t = setup();
    const op = await seedOperator(t);

    await op.mutation(internal.observability.recordObservation, {
      observation: observation({ observedAt: 1_700_000_000_100 }),
    });
    await op.mutation(internal.observability.recordObservation, {
      observation: observation({
        observedAt: 1_700_000_000_200,
        kind: 'FAILURE',
        outcome: 'DENIED',
        errorCode: 'RATE_LIMITED',
        failureClass: 'CLEAN_RETRYABLE',
      }),
    });
    await op.mutation(internal.observability.recordObservation, {
      observation: observation({
        observedAt: 1_700_000_000_300,
        kind: 'FAILURE',
        outcome: 'DENIED',
        errorCode: 'VALIDATION_FAILED',
        failureClass: 'TERMINAL',
      }),
    });

    const rows = await op.query(internal.observability.listFailuresByWindow, {
      serviceId: SVC_A,
      tenantId: TEN_A,
      from: 1_700_000_000_000,
      to: 1_700_000_000_250,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorCode).toBe('RATE_LIMITED');
  });

  it('rejects an inverted window', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.query(internal.observability.listFailuresByWindow, {
        serviceId: SVC_A,
        tenantId: TEN_A,
        from: 2_000,
        to: 1_000,
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|Window end/i);
  });

  it('denies a cross-tenant window', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.query(internal.observability.listFailuresByWindow, {
        serviceId: SVC_A,
        tenantId: TEN_B,
        from: 0,
        to: 9_999_999_999_999,
      }),
    ).rejects.toThrow(/FORBIDDEN|tenant/i);
  });
});

// --- getDependencyHealth -----------------------------------------------------

describe('getDependencyHealth', () => {
  it('returns the newest snapshots first, filtered to the environment', async () => {
    const t = setup();
    const op = await seedOperator(t);

    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ observedAt: 1_700_000_000_100, state: 'AVAILABLE' }),
    });
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ observedAt: 1_700_000_000_300, state: 'DEGRADED' }),
    });
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ observedAt: 1_700_000_000_200, environment: 'PRODUCTION' }),
    });

    const rows = await op.query(internal.observability.getDependencyHealth, {
      serviceId: SVC_A,
      environment: 'DEVELOPMENT',
      dependencyId: 'dep-core',
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.observedAt)).toEqual([1_700_000_000_300, 1_700_000_000_100]);
    expect(rows.every((r) => r.environment === 'DEVELOPMENT')).toBe(true);
  });
});

// --- getServiceHealth --------------------------------------------------------

describe('getServiceHealth', () => {
  async function healthOf(t: TestConvex, op: Awaited<ReturnType<typeof seedOperator>>) {
    return await op.query(internal.observability.getServiceHealth, {
      serviceId: SVC_A,
      environment: 'DEVELOPMENT',
    });
  }

  it('reports UNKNOWN when there are no dependency observations', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const result = await healthOf(t, op);

    expect(result.state).toBe('UNKNOWN');
    expect(result.reasons).toContain('NO_DEPENDENCY_OBSERVATIONS');
    expect(result.complianceClaim).toBe('NONE');
    expect(result.certificationClaim).toBe('NONE');
  });

  it('reports UNAVAILABLE when a mandatory CORE dependency is UNAVAILABLE', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ state: 'UNAVAILABLE' }),
    });
    const result = await healthOf(t, op);

    expect(result.state).toBe('UNAVAILABLE');
    expect(result.reasons).toContain('MANDATORY_DEPENDENCY_UNAVAILABLE');
  });

  it('never upgrades a mandatory UNKNOWN dependency to AVAILABLE', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ state: 'UNKNOWN' }),
    });
    const result = await healthOf(t, op);

    expect(result.state).toBe('UNKNOWN');
    expect(result.state).not.toBe('AVAILABLE');
    expect(result.reasons).toContain('MANDATORY_DEPENDENCY_UNKNOWN');
  });

  it('reports DEGRADED when a non-mandatory dependency is DEGRADED', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ dependencyId: 'dep-core', state: 'AVAILABLE' }),
    });
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({
        dependencyId: 'dep-connector',
        dependencyType: 'CONNECTOR',
        state: 'DEGRADED',
      }),
    });
    const result = await healthOf(t, op);

    expect(result.state).toBe('DEGRADED');
    expect(result.reasons).toContain('DEPENDENCY_DEGRADED');
  });

  it('reports AVAILABLE only when every latest dependency is AVAILABLE', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ dependencyId: 'dep-core', state: 'AVAILABLE' }),
    });
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({
        dependencyId: 'dep-webhook',
        dependencyType: 'WEBHOOK',
        state: 'AVAILABLE',
      }),
    });
    const result = await healthOf(t, op);

    expect(result.state).toBe('AVAILABLE');
    expect(result.reasons).toContain('ALL_DEPENDENCIES_AVAILABLE');
    expect(result.dependencies).toHaveLength(2);
    expect(result.complianceClaim).toBe('NONE');
  });

  it('uses only the latest snapshot per dependency', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ observedAt: 1_700_000_000_100, state: 'UNAVAILABLE' }),
    });
    await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: snapshot({ observedAt: 1_700_000_000_900, state: 'AVAILABLE' }),
    });
    const result = await healthOf(t, op);

    expect(result.state).toBe('AVAILABLE');
    expect(result.dependencies).toHaveLength(1);
  });

  it('denies an environment outside the caller grant', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.query(internal.observability.getServiceHealth, {
        serviceId: SVC_A,
        environment: 'PREVIEW',
      }),
    ).rejects.toThrow(/FORBIDDEN|environment/i);
  });
});

// --- recordDependencyHealth --------------------------------------------------

describe('recordDependencyHealth', () => {
  it('persists a snapshot and rejects a duplicate snapshotId', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = snapshot();

    const id = await op.mutation(internal.observability.recordDependencyHealth, {
      snapshot: input,
    });
    expect(id).toBe(input.snapshotId);

    await expect(
      op.mutation(internal.observability.recordDependencyHealth, { snapshot: input }),
    ).rejects.toThrow(/CONFLICT/i);
  });

  it('denies an unauthorized environment', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.recordDependencyHealth, {
        snapshot: snapshot({ environment: 'PREVIEW' }),
      }),
    ).rejects.toThrow(/FORBIDDEN|environment/i);
  });
});

// --- computeSloWindow / getSloWindows ---------------------------------------

describe('computeSloWindow', () => {
  it('persists an INTERNAL operational target window', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = sloWindow();

    const id = await op.mutation(internal.observability.computeSloWindow, { window: input });
    expect(id).toBe(input.windowId);

    const rows = await t.run((ctx) => ctx.db.query('sloWindows').collect());
    expect(rows[0]?.targetClass).toBe('INTERNAL_OPERATIONAL_TARGET');
    expect(rows[0]?.complianceClaim).toBe('NONE');
  });

  it('rejects a duplicate windowId with CONFLICT', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = sloWindow();
    await op.mutation(internal.observability.computeSloWindow, { window: input });
    await expect(
      op.mutation(internal.observability.computeSloWindow, { window: input }),
    ).rejects.toThrow(/CONFLICT/i);
  });

  it('rejects an inverted window', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.computeSloWindow, {
        window: sloWindow({ windowStart: 2_000, windowEnd: 1_000 }),
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|window end/i);
  });
});

describe('getSloWindows', () => {
  it('returns windows inside the range, newest first', async () => {
    const t = setup();
    const op = await seedOperator(t);

    await op.mutation(internal.observability.computeSloWindow, {
      window: sloWindow({ windowStart: 1_000, windowEnd: 2_000 }),
    });
    await op.mutation(internal.observability.computeSloWindow, {
      window: sloWindow({ windowStart: 3_000, windowEnd: 4_000 }),
    });
    await op.mutation(internal.observability.computeSloWindow, {
      window: sloWindow({ windowStart: 9_000, windowEnd: 10_000 }),
    });

    const rows = await op.query(internal.observability.getSloWindows, {
      serviceId: SVC_A,
      from: 0,
      to: 5_000,
    });
    expect(rows.map((r) => r.windowStart)).toEqual([3_000, 1_000]);
  });

  it('rejects an inverted range', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.query(internal.observability.getSloWindows, {
        serviceId: SVC_A,
        from: 5_000,
        to: 1_000,
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|Window end/i);
  });
});

// --- recordTransportCost -----------------------------------------------------

describe('recordTransportCost', () => {
  it('records API-Hub-owned transport cost', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = costRecord();

    const id = await op.mutation(internal.observability.recordTransportCost, { cost: input });
    expect(id).toBe(input.costRecordId);

    const rows = await t.run((ctx) => ctx.db.query('transportCostRecords').collect());
    expect(rows[0]?.costOwner).toBe('API_HUB');
    expect(rows[0]?.complianceClaim).toBe('NONE');
  });

  it('rejects a duplicate costRecordId with CONFLICT', async () => {
    const t = setup();
    const op = await seedOperator(t);
    const input = costRecord();
    await op.mutation(internal.observability.recordTransportCost, { cost: input });
    await expect(
      op.mutation(internal.observability.recordTransportCost, { cost: input }),
    ).rejects.toThrow(/CONFLICT/i);
  });

  it('rejects a negative or fractional amount', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.recordTransportCost, {
        cost: costRecord({ amountMinor: -1 }),
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|non-negative integer/i);
    await expect(
      op.mutation(internal.observability.recordTransportCost, {
        cost: costRecord({ amountMinor: 1.5 }),
      }),
    ).rejects.toThrow(/VALIDATION_FAILED|non-negative integer/i);
  });

  it('denies a service outside the caller grant', async () => {
    const t = setup();
    const op = await seedOperator(t);
    await expect(
      op.mutation(internal.observability.recordTransportCost, {
        cost: costRecord({ serviceId: SVC_B }),
      }),
    ).rejects.toThrow(/FORBIDDEN|service/i);
  });
});

// --- purgeExpiredObservations ------------------------------------------------

describe('purgeExpiredObservations', () => {
  it('deletes only rows whose retention window has elapsed', async () => {
    const t = setup();
    const op = await seedOperator(t);

    await op.mutation(internal.observability.recordObservation, {
      observation: observation(),
      expiresAt: 1_000,
    });
    await op.mutation(internal.observability.recordObservation, {
      observation: observation(),
      expiresAt: 9_000,
    });
    await op.mutation(internal.observability.recordObservation, {
      observation: observation(),
    });

    const purged = await op.mutation(internal.observability.purgeExpiredObservations, {
      now: 5_000,
    });
    expect(purged).toBe(1);

    const rows = await t.run((ctx) => ctx.db.query('transportObservations').collect());
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.expiresAt === 1_000)).toBe(false);
  });

  it('honours the caller-supplied bound', async () => {
    const t = setup();
    const op = await seedOperator(t);
    for (let i = 0; i < 5; i += 1) {
      await op.mutation(internal.observability.recordObservation, {
        observation: observation(),
        expiresAt: 1_000,
      });
    }
    const purged = await op.mutation(internal.observability.purgeExpiredObservations, {
      now: 5_000,
      limit: 2,
    });
    expect(purged).toBe(2);
  });

  it('is denied to a read-only viewer', async () => {
    const t = setup();
    const viewer = await seedViewer(t);
    await expect(
      viewer.mutation(internal.observability.purgeExpiredObservations, { now: 5_000 }),
    ).rejects.toThrow(/FORBIDDEN|role/i);
  });
});
