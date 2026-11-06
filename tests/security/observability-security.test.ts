// Phase 9 security suite — thirteen adversarial classes.
//
// Each `describe` block is one security class the PM required for the API Hub
// production-operations / observability surface. The tests are deterministic
// negative tests: they assert that the boundary REFUSES the attack, not merely
// that a happy path works.
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE -> HUB ->
// PRODUCT. The Hub transports; the Core decides. A transport outcome is never a
// compliance verdict, a health state is never a compliance claim, and an SLO is
// an internal operational target, never an SLA.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  InMemoryTraceBindingRegistry,
  assertCostOwnershipBoundary,
  assertNoComplianceVocabulary,
  assertOperationalStateVocabulary,
  assertTraceBinding,
  buildRawHealthCounters,
  deriveOperationalState,
  failureClassFor,
  isRetryableFailure,
  mapCoreHealthToHubState,
  mintTraceIdentity,
  projectObservation,
  toCoreUsageTelemetry,
  type RoutingContext,
} from '@arma/observability';
import {
  assertNoDirectCoreDatabaseAccess,
  assertTransportDoesNotManufactureCoreState,
} from '@arma/compliance-core-client';

const TRACE = 'trc_0123456789abcdef0123456789abcdef';
const NOW = 1_700_000_000_000;

const routing: RoutingContext = {
  productId: 'arma-sentinel',
  tenantId: 'tenant-a',
  environment: 'PRODUCTION',
  hubRoutingIdentity: 'hub:prod',
  serviceId: 'svc-a',
};

/** A minimal valid observation candidate. */
function candidate(overrides: Record<string, unknown> = {}) {
  return {
    observationId: 'obs_0123456789abcdef0123456789abcdef',
    observedAt: NOW,
    kind: 'REQUEST',
    traceId: TRACE,
    productId: 'arma-sentinel',
    tenantId: 'tenant-a',
    environment: 'PRODUCTION',
    serviceId: 'svc-a',
    outcome: 'ALLOWED',
    complianceClaim: 'NONE',
    certificationClaim: 'NONE',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Tenant / product / environment trace isolation
// ---------------------------------------------------------------------------

describe('SEC-01 trace isolation across tenant, product, and environment', () => {
  it('rejects a caller correlation reference already bound to another tenant', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const first = mintTraceIdentity({
      routingContext: routing,
      callerCorrelationRef: 'corr-shared',
      now: NOW,
      registry,
    });
    expect(first.ok).toBe(true);

    const forged = mintTraceIdentity({
      routingContext: { ...routing, tenantId: 'tenant-b' },
      callerCorrelationRef: 'corr-shared',
      now: NOW,
      registry,
    });
    expect(forged.ok).toBe(false);
    expect(forged.reason).toBe('CALLER_REFERENCE_CONTEXT_MISMATCH');
  });

  it('rejects a caller correlation reference bound to another product', () => {
    const registry = new InMemoryTraceBindingRegistry();
    mintTraceIdentity({
      routingContext: routing,
      callerCorrelationRef: 'corr-p',
      now: NOW,
      registry,
    });
    const forged = mintTraceIdentity({
      routingContext: { ...routing, productId: 'other-product' },
      callerCorrelationRef: 'corr-p',
      now: NOW,
      registry,
    });
    expect(forged.reason).toBe('CALLER_REFERENCE_CONTEXT_MISMATCH');
  });

  it('rejects a caller correlation reference bound to another environment', () => {
    const registry = new InMemoryTraceBindingRegistry();
    mintTraceIdentity({
      routingContext: routing,
      callerCorrelationRef: 'corr-e',
      now: NOW,
      registry,
    });
    const forged = mintTraceIdentity({
      routingContext: { ...routing, environment: 'DEVELOPMENT' },
      callerCorrelationRef: 'corr-e',
      now: NOW,
      registry,
    });
    expect(forged.reason).toBe('CALLER_REFERENCE_CONTEXT_MISMATCH');
  });

  it('refuses to verify a trace under a different tenant context', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const minted = mintTraceIdentity({ routingContext: routing, now: NOW, registry });
    expect(minted.ok).toBe(true);
    const traceId = minted.binding!.traceId;

    const decision = assertTraceBinding({
      traceId,
      routingContext: { ...routing, tenantId: 'tenant-b' },
      registry,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('ROUTING_CONTEXT_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// 2. Correlation forgery
// ---------------------------------------------------------------------------

describe('SEC-02 correlation forgery', () => {
  it('rejects a client-supplied trace id that the Hub never minted', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const decision = assertTraceBinding({ traceId: TRACE, routingContext: routing, registry });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('TRACE_ID_UNKNOWN');
  });

  it('rejects a malformed trace id', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const decision = assertTraceBinding({
      traceId: 'trace-from-client',
      routingContext: routing,
      registry,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('TRACE_ID_SHAPE_INVALID');
  });

  it('rejects a caller correlation reference that does not match the minted binding', () => {
    const registry = new InMemoryTraceBindingRegistry();
    const minted = mintTraceIdentity({
      routingContext: routing,
      callerCorrelationRef: 'corr-real',
      now: NOW,
      registry,
    });
    const decision = assertTraceBinding({
      traceId: minted.binding!.traceId,
      routingContext: routing,
      registry,
      callerCorrelationRef: 'corr-forged',
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('CALLER_REFERENCE_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// 3. Log / telemetry injection
// ---------------------------------------------------------------------------

describe('SEC-03 telemetry injection', () => {
  const payloads = [
    'svc-a\nINJECTED',
    'svc-a\r\nX-Admin: true',
    'svc-a\u001b[31mRED',
    'svc-a\u0000null',
  ];

  for (const payload of payloads) {
    it(`rejects control characters in a string field: ${JSON.stringify(payload)}`, () => {
      const result = projectObservation(candidate({ serviceId: payload }));
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.reason === 'INJECTION')).toBe(true);
    });
  }

  it('rejects an over-length string field', () => {
    const result = projectObservation(candidate({ operation: 'x'.repeat(201) }));
    expect(result.ok).toBe(false);
    // An over-length value is rejected by the same sanitizer that blocks
    // injection: it is never truncated and never silently accepted.
    expect(result.issues.some((issue) => issue.reason === 'INJECTION')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Secret leakage
// ---------------------------------------------------------------------------

describe('SEC-04 secret leakage', () => {
  const secrets = [
    'signature',
    'secret',
    'credential',
    'token',
    'password',
    'privateKey',
    'apiKey',
  ];

  for (const field of secrets) {
    it(`rejects a "${field}" field on an observation`, () => {
      const result = projectObservation(candidate({ [field]: 'super-secret-value' }));
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.reason === 'FORBIDDEN_FIELD')).toBe(true);
      // The rejected value never appears in the projected observation.
      expect(result.observation).toBeNull();
    });
  }

  it('drops an unknown field rather than carrying it through', () => {
    const result = projectObservation(candidate({ rawSignatureValue: 'abc' }));
    expect(result.ok).toBe(false);
    expect(result.observation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Raw evidence leakage
// ---------------------------------------------------------------------------

describe('SEC-05 raw evidence leakage', () => {
  const evidenceFields = [
    'body',
    'rawBody',
    'payload',
    'rawPayload',
    'evidence',
    'rawEvidence',
    'verdict',
  ];

  for (const field of evidenceFields) {
    it(`rejects a "${field}" field on an observation`, () => {
      const result = projectObservation(candidate({ [field]: '{"raw":"evidence"}' }));
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.reason === 'FORBIDDEN_FIELD')).toBe(true);
    });
  }

  it('never returns a projected observation when any forbidden field is present', () => {
    const result = projectObservation(candidate({ body: 'x', verdict: 'COMPLIANT' }));
    expect(result.ok).toBe(false);
    expect(result.observation).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Retry mutation
// ---------------------------------------------------------------------------

describe('SEC-06 retry mutation', () => {
  it('derives the failure class from the governed code, not from the caller', () => {
    expect(failureClassFor('RATE_LIMITED')).toBe('CLEAN_RETRYABLE');
    expect(failureClassFor('DEPENDENCY_UNAVAILABLE')).toBe('CLEAN_RETRYABLE');
    expect(failureClassFor('INTERNAL_FAILURE')).toBe('CLEAN_RETRYABLE');
    expect(failureClassFor('VALIDATION_FAILED')).toBe('TERMINAL');
    expect(failureClassFor('AUTHORIZATION_DENIED')).toBe('TERMINAL');
  });

  it('treats only the three governed codes as retryable', () => {
    expect(isRetryableFailure('RATE_LIMITED')).toBe(true);
    expect(isRetryableFailure('DEPENDENCY_UNAVAILABLE')).toBe(true);
    expect(isRetryableFailure('INTERNAL_FAILURE')).toBe(true);
    for (const code of ['VALIDATION_FAILED', 'AUTHORIZATION_DENIED', 'INTEGRITY_FAILED'] as const) {
      expect(isRetryableFailure(code)).toBe(false);
    }
  });

  it('rejects a retry attempt counter below one', () => {
    const result = projectObservation(candidate({ kind: 'RETRY', attempt: 0 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.reason === 'OUT_OF_RANGE')).toBe(true);
  });

  it('rejects an error code outside the governed taxonomy', () => {
    const result = projectObservation(candidate({ kind: 'FAILURE', errorCode: 'PRODUCT_UNKNOWN' }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.reason === 'OUT_OF_RANGE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Idempotency conflict
// ---------------------------------------------------------------------------

describe('SEC-07 idempotency conflict', () => {
  it('records idempotency as a transport fact, never as a compliance verdict', () => {
    const result = projectObservation(
      candidate({ kind: 'REPLAY', idempotencyMatched: true, replayed: true }),
    );
    expect(result.ok).toBe(true);
    expect(result.observation?.idempotencyMatched).toBe(true);
    expect(result.observation?.complianceClaim).toBe('NONE');
    expect(result.observation?.certificationClaim).toBe('NONE');
  });

  it('rejects a non-boolean idempotency flag', () => {
    const result = projectObservation(candidate({ idempotencyMatched: 'yes' }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.reason === 'INVALID_TYPE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Rate-limit bypass
// ---------------------------------------------------------------------------

describe('SEC-08 rate-limit bypass', () => {
  it('records a rate-limit event as a bounded fact only', () => {
    const result = projectObservation(
      candidate({ kind: 'RATELIMIT', outcome: 'DENIED', errorCode: 'RATE_LIMITED' }),
    );
    expect(result.ok).toBe(true);
    expect(result.observation?.kind).toBe('RATELIMIT');
    expect(result.observation?.errorCode).toBe('RATE_LIMITED');
  });

  it('rejects an out-of-range HTTP status on a rate-limit observation', () => {
    const result = projectObservation(candidate({ kind: 'RATELIMIT', httpStatus: 99 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.reason === 'OUT_OF_RANGE')).toBe(true);
  });

  it('rejects an operational state of COMPLIANT on a rate-limit observation', () => {
    const result = projectObservation(
      candidate({ kind: 'RATELIMIT', operationalState: 'COMPLIANT' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.reason === 'OUT_OF_RANGE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Outage fail-open
// ---------------------------------------------------------------------------

describe('SEC-09 outage fail-open', () => {
  it('returns UNKNOWN, never AVAILABLE, when there are no checks', () => {
    const evaluation = deriveOperationalState({ checks: [], now: NOW, freshnessWindowMs: 60_000 });
    expect(evaluation.state).toBe('UNKNOWN');
    expect(evaluation.state).not.toBe('AVAILABLE');
  });

  it('returns UNKNOWN when a mandatory check is stale', () => {
    const evaluation = deriveOperationalState({
      checks: [{ name: 'core', mandatory: true, ok: true, observedAt: NOW - 120_000 }],
      now: NOW,
      freshnessWindowMs: 60_000,
    });
    expect(evaluation.state).toBe('UNKNOWN');
  });

  it('returns UNAVAILABLE when a mandatory check fails', () => {
    const evaluation = deriveOperationalState({
      checks: [{ name: 'core', mandatory: true, ok: false, observedAt: NOW }],
      now: NOW,
      freshnessWindowMs: 60_000,
    });
    expect(evaluation.state).toBe('UNAVAILABLE');
  });

  it('maps an unrecognised Core health state to UNKNOWN with a fail-closed admission', () => {
    const mapping = mapCoreHealthToHubState('SOMETHING_NEW');
    expect(mapping.hubState).toBe('UNKNOWN');
    expect(mapping.assumedAdmission).toBe('BLOCK');
    expect(mapping.failClosed).toBe(true);
  });

  it('never lets an unknown Core health state become AVAILABLE', () => {
    expect(mapCoreHealthToHubState('UNKNOWN').hubState).toBe('UNKNOWN');
    expect(mapCoreHealthToHubState('UNHEALTHY').hubState).toBe('UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// 10. Direct Core database access
// ---------------------------------------------------------------------------

describe('SEC-10 direct Core database access', () => {
  const sources = [
    'packages/observability/src/telemetry.ts',
    'packages/observability/src/boundary.ts',
    'packages/observability/src/health.ts',
    'apps/api/src/telemetry.ts',
  ];

  for (const relative of sources) {
    it(`has no Core Convex client in ${relative}`, () => {
      const text = readFileSync(join(process.cwd(), relative), 'utf8');
      expect(() => assertNoDirectCoreDatabaseAccess(text)).not.toThrow();
    });
  }

  it('detects a planted direct-access violation', () => {
    expect(() =>
      assertNoDirectCoreDatabaseAccess("import { api } from '../_generated/api.js';"),
    ).toThrow(/direct Compliance Core Convex database access is forbidden/);
  });
});

// ---------------------------------------------------------------------------
// 11. Transport-manufactured Core state
// ---------------------------------------------------------------------------

describe('SEC-11 transport must not manufacture Core state', () => {
  for (const state of ['RECEIVED', 'APPLIED', 'VERIFIED']) {
    it(`refuses to assert the Core-only policy state "${state}"`, () => {
      expect(() => assertTransportDoesNotManufactureCoreState(state)).toThrow(
        /transport must not manufacture authoritative Core policy state/,
      );
    });
  }

  it('allows a transport-only outcome such as DELIVERED', () => {
    expect(() => assertTransportDoesNotManufactureCoreState('DELIVERED')).not.toThrow();
  });

  it('rejects a caller-asserted health state when building raw Core counters', () => {
    const result = buildRawHealthCounters({ successCount: 10, failureCount: 1, state: 'HEALTHY' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('CALLER_ASSERTED_STATE_FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// 12. Compliance vocabulary
// ---------------------------------------------------------------------------

describe('SEC-12 compliance vocabulary', () => {
  it('uses exactly the four approved operational states', () => {
    expect(() => assertOperationalStateVocabulary()).not.toThrow();
  });

  it('rejects compliance vocabulary in free text', () => {
    expect(() => assertNoComplianceVocabulary(['COMPLIANT'])).toThrow();
    expect(() => assertNoComplianceVocabulary(['CERTIFIED'])).toThrow();
    expect(() => assertNoComplianceVocabulary(['AVAILABLE', 'DEGRADED'])).not.toThrow();
  });

  it('carries explicit non-claims on every derived health evaluation', () => {
    const evaluation = deriveOperationalState({
      checks: [{ name: 'core', mandatory: true, ok: true, observedAt: NOW }],
      now: NOW,
      freshnessWindowMs: 60_000,
    });
    expect(evaluation.complianceClaim).toBe('NONE');
    expect(evaluation.certificationClaim).toBe('NONE');
  });
});

// ---------------------------------------------------------------------------
// 13. Cost authority boundary
// ---------------------------------------------------------------------------

describe('SEC-13 cost authority boundary', () => {
  it('rejects AI Hub / REGIVANTA cost categories on a transport cost record', () => {
    for (const category of [
      'MODEL_INFERENCE',
      'TOKEN_USAGE',
      'AGENT_EXECUTION',
      'PROFITABILITY',
      'MARGIN',
    ]) {
      const result = assertCostOwnershipBoundary({
        costEventId: 'cost-1',
        costCategory: category,
        amountMinor: 10,
        costOwner: 'API_HUB',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a transport cost record owned by another authority', () => {
    const result = assertCostOwnershipBoundary({
      costEventId: 'cost-1',
      costCategory: 'EXTERNAL_API',
      amountMinor: 10,
      costOwner: 'AI_HUB',
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === 'WRONG_OWNER')).toBe(true);
  });

  it('projects a transport cost fact into the governed Core handoff shape', () => {
    const result = toCoreUsageTelemetry({
      telemetryId: 'TEL-0001',
      correlationId: '0123456789abcdef0123456789abcdef',
      tenantId: 'tenant-a',
      productId: 'arma-sentinel',
      serviceIdentityId: 'svc-a',
      action: 'validate',
      apiVersion: '1.0.0',
      direction: 'INBOUND',
      costUnits: 2,
      occurredAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.currency).toBe('USD');
      expect(result.projection.recordStatus).toBe('REAL');
      // The handoff shape carries usage facts only. `costOwner` is enforced on
      // the Hub record boundary, not re-asserted into the Core contract.
      expect(result.projection.units).toEqual([
        { unit: 'REQUEST', quantity: 1 },
        { unit: 'RESPONSE', quantity: 1 },
      ]);
    }
  });

  it('refuses a malformed correlation id at the handoff boundary', () => {
    const result = toCoreUsageTelemetry({
      telemetryId: 'TEL-0001',
      correlationId: 'not-a-hash',
      tenantId: 'tenant-a',
      productId: 'arma-sentinel',
      serviceIdentityId: 'svc-a',
      action: 'validate',
      apiVersion: '1.0.0',
      direction: 'INBOUND',
      costUnits: 2,
      occurredAt: NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('CORRELATION_ID_INVALID');
  });
});
