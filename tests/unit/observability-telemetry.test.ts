// Phase 9 — canonical transport telemetry record.
//
// These tests pin the closed allow-list, the fail-closed projection, the
// governed failure taxonomy, and the honesty invariants. A transport
// observation is never a compliance verdict.

import { describe, expect, it } from 'vitest';
import {
  FAILURE_CODES,
  FORBIDDEN_OBSERVATION_FIELDS,
  MANDATED_FAILURE_CODES,
  OBSERVATION_COMPLIANCE_CLAIM,
  OBSERVATION_CERTIFICATION_CLAIM,
  OBSERVATION_KINDS,
  OPERATIONAL_STATES,
  RETRYABLE_FAILURE_CODES,
  SAFE_OBSERVATION_FIELDS,
  assertNoComplianceVocabulary,
  failureClassFor,
  isRetryableFailure,
  isTransportObservation,
  newObservationId,
  projectObservation,
} from '@arma/observability';

const TRACE = `trc_${'a'.repeat(32)}`;
const OBS = `obs_${'b'.repeat(32)}`;

function validCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observationId: OBS,
    observedAt: 1_700_000_000_000,
    kind: 'REQUEST',
    traceId: TRACE,
    ...overrides,
  };
}

describe('failure taxonomy', () => {
  it('publishes exactly 18 codes and mandates 17', () => {
    expect(FAILURE_CODES).toHaveLength(18);
    expect(MANDATED_FAILURE_CODES).toHaveLength(17);
    expect(MANDATED_FAILURE_CODES).not.toContain('NOT_FOUND');
  });

  it('allows retry only for the three clean-retryable codes', () => {
    expect([...RETRYABLE_FAILURE_CODES].sort()).toEqual(
      ['DEPENDENCY_UNAVAILABLE', 'INTERNAL_FAILURE', 'RATE_LIMITED'].sort(),
    );
    for (const code of FAILURE_CODES) {
      expect(isRetryableFailure(code)).toBe(RETRYABLE_FAILURE_CODES.includes(code));
      expect(failureClassFor(code)).toBe(
        RETRYABLE_FAILURE_CODES.includes(code) ? 'CLEAN_RETRYABLE' : 'TERMINAL',
      );
    }
  });

  it('has no failure class for AMBIGUOUS at the taxonomy level', () => {
    // AMBIGUOUS exists for delivery semantics, never for a bounded code.
    for (const code of FAILURE_CODES) {
      expect(failureClassFor(code)).not.toBe('AMBIGUOUS');
    }
  });
});

describe('operational vocabulary', () => {
  it('has exactly four states and no compliance word', () => {
    expect(OPERATIONAL_STATES).toEqual(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']);
    expect(() => assertNoComplianceVocabulary(OPERATIONAL_STATES)).not.toThrow();
  });

  it('rejects a compliance word presented as an operational state', () => {
    expect(() => assertNoComplianceVocabulary(['COMPLIANT'])).toThrow(
      /FORBIDDEN_OPERATIONAL_VOCABULARY/,
    );
    expect(() => assertNoComplianceVocabulary(['certified'])).toThrow(
      /FORBIDDEN_OPERATIONAL_VOCABULARY/,
    );
  });
});

describe('observation allow-list', () => {
  it('never contains a raw-body, signature, secret, credential, or evidence field', () => {
    for (const forbidden of [
      'body',
      'payload',
      'signature',
      'secret',
      'credential',
      'evidence',
      'verdict',
    ]) {
      expect(SAFE_OBSERVATION_FIELDS.has(forbidden)).toBe(false);
      expect(FORBIDDEN_OBSERVATION_FIELDS.has(forbidden)).toBe(true);
    }
  });

  it('projects a minimal valid observation with explicit non-claims', () => {
    const result = projectObservation(validCandidate());
    expect(result.ok).toBe(true);
    expect(result.observation?.complianceClaim).toBe(OBSERVATION_COMPLIANCE_CLAIM);
    expect(result.observation?.certificationClaim).toBe(OBSERVATION_CERTIFICATION_CLAIM);
    expect(isTransportObservation(result.observation)).toBe(true);
  });

  it('drops a forbidden field and fails closed', () => {
    const result = projectObservation(validCandidate({ body: '{"card":"4111"}' }));
    expect(result.ok).toBe(false);
    expect(result.observation).toBeNull();
    expect(result.issues).toContainEqual({ field: 'body', reason: 'FORBIDDEN_FIELD' });
  });

  it('rejects a non-allow-listed field rather than silently storing it', () => {
    const result = projectObservation(validCandidate({ arbitraryBlob: 'x' }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ field: 'arbitraryBlob', reason: 'NOT_ALLOWED' });
  });

  it('rejects control characters and ANSI escapes in any string field', () => {
    for (const injected of ['ok\nINJECTED', 'ok\r\nINJECTED', 'ok\u001b[31mred']) {
      const result = projectObservation(validCandidate({ operation: injected }));
      expect(result.ok).toBe(false);
      expect(result.issues).toContainEqual({ field: 'operation', reason: 'INJECTION' });
    }
  });

  it('rejects non-scalar values', () => {
    const result = projectObservation(validCandidate({ scope: { nested: true } }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ field: 'scope', reason: 'INVALID_TYPE' });
  });

  it('bounds numeric ranges', () => {
    expect(projectObservation(validCandidate({ httpStatus: 99 })).issues).toContainEqual({
      field: 'httpStatus',
      reason: 'OUT_OF_RANGE',
    });
    expect(projectObservation(validCandidate({ latencyMs: 600_001 })).issues).toContainEqual({
      field: 'latencyMs',
      reason: 'OUT_OF_RANGE',
    });
    expect(projectObservation(validCandidate({ attempt: 0 })).issues).toContainEqual({
      field: 'attempt',
      reason: 'OUT_OF_RANGE',
    });
  });

  it('rejects an error code outside the governed taxonomy', () => {
    const result = projectObservation(validCandidate({ errorCode: 'PRODUCT_UNKNOWN' }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ field: 'errorCode', reason: 'OUT_OF_RANGE' });
  });

  it('rejects an operational state outside the four-state vocabulary', () => {
    const result = projectObservation(validCandidate({ operationalState: 'COMPLIANT' }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ field: 'operationalState', reason: 'OUT_OF_RANGE' });
  });

  it('rejects a non-Hub-minted trace id', () => {
    const result = projectObservation(validCandidate({ traceId: 'req-12345678' }));
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ field: 'traceId', reason: 'OUT_OF_RANGE' });
  });

  it('accepts every observation kind in the closed set', () => {
    for (const kind of OBSERVATION_KINDS) {
      expect(projectObservation(validCandidate({ kind })).ok).toBe(true);
    }
  });
});

describe('observation identity', () => {
  it('mints a well-shaped, unique observation id', () => {
    const a = newObservationId();
    const b = newObservationId();
    expect(a).toMatch(/^obs_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
