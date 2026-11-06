// Phase 9 — transport cost ownership boundary and Core boundary adapters.
//
// PM direction §3: API Hub owns external API/connector/webhook transport cost.
// AI Hub owns model/token/agent cost. REGIVANTA Cost Guard owns
// profitability/margin. These are not merged, and the Hub never becomes a
// second cost or compliance authority.

import { describe, expect, it } from 'vitest';
import {
  API_HUB_COST_CATEGORIES,
  CORE_HEALTH_ADMISSIONS,
  CORE_HEALTH_WINDOW_SIZE,
  CORE_IMPLEMENTATION_ONLY_CODES,
  CORE_INTEGRATION_HEALTH_STATES,
  COST_OWNER,
  FOREIGN_COST_CATEGORIES,
  FORBIDDEN_COST_FIELDS,
  assertCostOwnershipBoundary,
  buildRawHealthCounters,
  isGovernedFailureCode,
  mapCoreHealthToHubState,
  projectCoreFailureCode,
  toCoreUsageTelemetry,
} from '@arma/observability';

function costRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    costEventId: 'cost-1',
    traceId: `trc_${'a'.repeat(32)}`,
    costOwner: COST_OWNER,
    costCategory: 'EXTERNAL_API',
    amountMinor: 1250,
    currency: 'USD',
    billingPeriod: '2026-11',
    recordedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('cost ownership boundary', () => {
  it('accepts a Hub-owned transport cost record', () => {
    const result = assertCostOwnershipBoundary(costRecord());
    expect(result.ok).toBe(true);
  });

  it('never includes AI Hub or REGIVANTA categories in the Hub category set', () => {
    for (const foreign of FOREIGN_COST_CATEGORIES) {
      expect(API_HUB_COST_CATEGORIES as readonly string[]).not.toContain(foreign);
    }
  });

  it('rejects a foreign category', () => {
    for (const category of ['MODEL_INFERENCE', 'TOKEN_USAGE', 'PROFITABILITY', 'MARGIN']) {
      const result = assertCostOwnershipBoundary(costRecord({ costCategory: category }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations).toContainEqual({ kind: 'FOREIGN_CATEGORY', category });
      }
    }
  });

  it('rejects a foreign field such as margin or token count', () => {
    const result = assertCostOwnershipBoundary(costRecord({ marginMinor: 100, tokenCount: 42 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toContainEqual({ kind: 'FORBIDDEN_FIELD', field: 'marginMinor' });
      expect(result.violations).toContainEqual({ kind: 'FORBIDDEN_FIELD', field: 'tokenCount' });
    }
    for (const field of FORBIDDEN_COST_FIELDS) {
      const perField = assertCostOwnershipBoundary(costRecord({ [field]: 1 }));
      expect(perField.ok).toBe(false);
      if (!perField.ok) {
        expect(perField.violations).toContainEqual({ kind: 'FORBIDDEN_FIELD', field });
      }
    }
  });

  it('rejects a non-integer or negative amount', () => {
    for (const amountMinor of [1.5, -1]) {
      const result = assertCostOwnershipBoundary(costRecord({ amountMinor }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations).toContainEqual({ kind: 'NON_INTEGER_AMOUNT' });
      }
    }
  });

  it('rejects a record owned by another system', () => {
    const result = assertCostOwnershipBoundary(costRecord({ costOwner: 'AI_HUB' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toContainEqual({ kind: 'WRONG_OWNER', owner: 'AI_HUB' });
    }
  });
});

describe('Core failure-code projection', () => {
  it('passes governed codes through unchanged', () => {
    for (const code of ['RATE_LIMITED', 'AUTHENTICATION_FAILED', 'INTERNAL_FAILURE']) {
      const projection = projectCoreFailureCode(code);
      expect(projection.code).toBe(code);
      expect(projection.projected).toBe(false);
    }
  });

  it('fails closed to INTERNAL_FAILURE for every Core implementation-only code', () => {
    for (const code of CORE_IMPLEMENTATION_ONLY_CODES) {
      const projection = projectCoreFailureCode(code);
      expect(projection.code).toBe('INTERNAL_FAILURE');
      expect(projection.projected).toBe(true);
      expect(isGovernedFailureCode(code)).toBe(false);
    }
  });

  it('fails closed for malformed input', () => {
    const projection = projectCoreFailureCode(undefined);
    expect(projection.code).toBe('INTERNAL_FAILURE');
    expect(projection.malformed).toBe(true);
    expect(projection.retryable).toBe(true);
  });

  it('never returns a code outside the governed taxonomy', () => {
    for (const input of ['nonsense', '', 42, null, {}, 'PRODUCT_UNKNOWN']) {
      expect(isGovernedFailureCode(projectCoreFailureCode(input).code)).toBe(true);
    }
  });
});

describe('Core health mapping', () => {
  it('maps Core states one-directionally onto Hub states', () => {
    expect(mapCoreHealthToHubState('HEALTHY')).toMatchObject({
      hubState: 'AVAILABLE',
      assumedAdmission: 'ALLOW',
      failClosed: false,
    });
    expect(mapCoreHealthToHubState('DEGRADED')).toMatchObject({
      hubState: 'DEGRADED',
      assumedAdmission: 'ALLOW_BOUNDED',
      failClosed: false,
    });
    expect(mapCoreHealthToHubState('UNHEALTHY')).toMatchObject({
      hubState: 'UNAVAILABLE',
      assumedAdmission: 'BLOCK',
      failClosed: true,
    });
    expect(mapCoreHealthToHubState('UNKNOWN')).toMatchObject({
      hubState: 'UNKNOWN',
      assumedAdmission: 'BLOCK',
      failClosed: true,
    });
  });

  it('never maps UNKNOWN or an unrecognised value to AVAILABLE', () => {
    for (const input of ['UNKNOWN', 'WHATEVER', undefined, null, 42]) {
      const mapping = mapCoreHealthToHubState(input);
      expect(mapping.hubState).not.toBe('AVAILABLE');
      expect(mapping.failClosed).toBe(true);
    }
  });

  it('publishes the Core vocabularies without merging them', () => {
    expect(CORE_INTEGRATION_HEALTH_STATES).toEqual(['HEALTHY', 'DEGRADED', 'UNHEALTHY', 'UNKNOWN']);
    expect(CORE_HEALTH_ADMISSIONS).toEqual(['ALLOW', 'ALLOW_BOUNDED', 'BLOCK']);
    // Core HEALTHY is not a Hub state; the vocabularies stay distinct.
    expect(CORE_INTEGRATION_HEALTH_STATES as readonly string[]).not.toContain('AVAILABLE');
  });

  it('builds raw counters and refuses any caller-asserted state', () => {
    expect(
      buildRawHealthCounters({ successCount: 10, failureCount: 2, consecutiveFailures: 1 }),
    ).toEqual({
      ok: true,
      counters: { successCount: 10, failureCount: 2, consecutiveFailures: 1 },
    });
    for (const forbidden of [{ state: 'HEALTHY' }, { source: 'TELEMETRY' }]) {
      const result = buildRawHealthCounters({
        successCount: 1,
        failureCount: 0,
        consecutiveFailures: 0,
        ...forbidden,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('HEALTH_TELEMETRY_INVALID');
        expect(result.reason).toBe('CALLER_ASSERTED_STATE_FORBIDDEN');
      }
    }
  });

  it('rejects an oversized window, negative counts, and impossible consecutive failures', () => {
    expect(
      buildRawHealthCounters({
        successCount: CORE_HEALTH_WINDOW_SIZE,
        failureCount: 1,
        consecutiveFailures: 0,
      }),
    ).toMatchObject({ ok: false, reason: 'WINDOW_EXCEEDED' });
    expect(
      buildRawHealthCounters({ successCount: -1, failureCount: 0, consecutiveFailures: 0 }),
    ).toMatchObject({ ok: false, reason: 'INVALID_successCount' });
    expect(
      buildRawHealthCounters({ successCount: 0, failureCount: 1, consecutiveFailures: 2 }),
    ).toMatchObject({ ok: false, reason: 'CONSECUTIVE_EXCEEDS_FAILURES' });
  });
});

describe('Core usage-telemetry handoff projection', () => {
  const input = {
    telemetryId: 'TEL-0001',
    correlationId: 'a'.repeat(32),
    requestId: 'req-12345678',
    tenantId: 'tenant-a',
    productId: 'arma-sentinel',
    serviceIdentityId: 'svc-a',
    action: 'apiHub.event.publish',
    apiVersion: '1.0.0',
    direction: 'OUTBOUND' as const,
    costUnits: 3,
    vendorRef: 'vendor-ref-1',
    occurredAt: 1_700_000_000_000,
  };

  it('projects a valid handoff with USD and REAL status by default', () => {
    const result = toCoreUsageTelemetry(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.currency).toBe('USD');
      expect(result.projection.recordStatus).toBe('REAL');
      expect(result.projection.units).toEqual([
        { unit: 'REQUEST', quantity: 1 },
        { unit: 'RESPONSE', quantity: 1 },
      ]);
      expect(result.projection.vendorRef).toBe('vendor-ref-1');
    }
  });

  it('rejects a malformed telemetry id, correlation id, or api version', () => {
    expect(toCoreUsageTelemetry({ ...input, telemetryId: 'bad' })).toMatchObject({
      ok: false,
      reason: 'TELEMETRY_ID_INVALID',
    });
    expect(toCoreUsageTelemetry({ ...input, correlationId: 'XYZ' })).toMatchObject({
      ok: false,
      reason: 'CORRELATION_ID_INVALID',
    });
    expect(toCoreUsageTelemetry({ ...input, apiVersion: '1.0' })).toMatchObject({
      ok: false,
      reason: 'API_VERSION_INVALID',
    });
  });

  it('rejects non-integer cost units and timestamps', () => {
    expect(toCoreUsageTelemetry({ ...input, costUnits: 1.5 })).toMatchObject({
      ok: false,
      reason: 'COST_UNITS_INVALID',
    });
    expect(toCoreUsageTelemetry({ ...input, occurredAt: 1.5 })).toMatchObject({
      ok: false,
      reason: 'OCCURRED_AT_INVALID',
    });
  });

  it('carries no vendor secret: vendorRef is a reference only', () => {
    const result = toCoreUsageTelemetry({ ...input, vendorRef: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.projection.vendorRef).toBeNull();
  });
});
