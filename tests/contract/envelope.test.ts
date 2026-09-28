// Scenario coverage: valid envelope acceptance, missing signature metadata,
// invalid body hash, unsupported schema version, malformed receipt.

import { describe, expect, it } from 'vitest';
import { serviceRequestEnvelopeSchema, signedReceiptSchema, validate } from '@arma/contracts';
import { admitServiceRequest } from '@arma/policy';
import {
  createHarness,
  signedRequest,
  TEST_AUDIENCE,
  TEST_BODY,
  TEST_CAPABILITY,
} from '../support/harness.js';

describe('envelope contracts', () => {
  it('SCENARIO 1: accepts a valid, correctly-signed service request', async () => {
    const h = createHarness();
    const { envelope, body } = signedRequest();
    const decision = await admitServiceRequest({
      envelope,
      rawBody: body,
      method: 'POST',
      path: '/v1/validate',
      expectedAudience: TEST_AUDIENCE,
      capability: TEST_CAPABILITY,
      direction: 'INBOUND',
      now: h.clock.now(),
      credentials: h.credentials,
      resolveSecret: h.resolveSecret,
      nonces: h.nonces,
      idempotency: h.idempotency,
      policy: h.policy,
    });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.serviceId).toBe('arma-sentinel');
      expect(decision.duplicate).toBe(false);
    }
  });

  it('SCENARIO 2: rejects an envelope missing signature metadata', async () => {
    const { envelope } = signedRequest();
    const { signature: _signature, ...withoutSignature } = envelope;
    const parsed = validate(serviceRequestEnvelopeSchema, withoutSignature);
    expect(parsed.ok).toBe(false);

    const h = createHarness();
    const decision = await admitServiceRequest({
      envelope: withoutSignature,
      rawBody: TEST_BODY,
      method: 'POST',
      path: '/v1/validate',
      expectedAudience: TEST_AUDIENCE,
      capability: TEST_CAPABILITY,
      direction: 'INBOUND',
      now: h.clock.now(),
      credentials: h.credentials,
      resolveSecret: h.resolveSecret,
      nonces: h.nonces,
      idempotency: h.idempotency,
      policy: h.policy,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('ENVELOPE_INVALID');
  });

  it('SCENARIO 3: rejects a request whose body does not match the signed body hash', async () => {
    const h = createHarness();
    const { envelope } = signedRequest();
    const decision = await admitServiceRequest({
      envelope,
      rawBody: '{"hello":"tampered"}',
      method: 'POST',
      path: '/v1/validate',
      expectedAudience: TEST_AUDIENCE,
      capability: TEST_CAPABILITY,
      direction: 'INBOUND',
      now: h.clock.now(),
      credentials: h.credentials,
      resolveSecret: h.resolveSecret,
      nonces: h.nonces,
      idempotency: h.idempotency,
      policy: h.policy,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('BODY_HASH_MISMATCH');
  });

  it('SCENARIO 10: rejects an unsupported schema version', async () => {
    const h = createHarness();
    const { envelope, body } = signedRequest({ schemaVersion: '2.0.0' });
    const decision = await admitServiceRequest({
      envelope,
      rawBody: body,
      method: 'POST',
      path: '/v1/validate',
      expectedAudience: TEST_AUDIENCE,
      capability: TEST_CAPABILITY,
      direction: 'INBOUND',
      now: h.clock.now(),
      credentials: h.credentials,
      resolveSecret: h.resolveSecret,
      nonces: h.nonces,
      idempotency: h.idempotency,
      policy: h.policy,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });

  it('SCENARIO 12: rejects a malformed signed receipt', () => {
    const malformed = {
      schemaVersion: '1.0.0',
      receiptId: 'rcpt-00000001',
      subjectId: 'req-00000001',
      subjectType: 'NOT_A_SUBJECT_TYPE',
      status: 'ACCEPTED',
      accepted: 'yes',
      receivedBodyHash: 'not-a-hash',
      receiptHash: 'not-a-hash',
      acceptedAt: '1700000000000',
      issuer: 'arma-api-hub',
      signature: { algorithm: 'HMAC-SHA256', keyId: 'k1', value: 'x' },
      correlation: { correlationId: 'corr-00000001' },
    };
    const parsed = validate(signedReceiptSchema, malformed);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const paths = parsed.issues.map((i) => i.path);
      expect(paths).toContain('subjectType');
      expect(paths).toContain('accepted');
    }
  });

  it('accepts a well-formed signed receipt', () => {
    const receipt = {
      schemaVersion: '1.0.0',
      receiptId: 'rcpt-00000001',
      subjectId: 'req-00000001',
      subjectType: 'SERVICE_REQUEST',
      status: 'ACCEPTED',
      accepted: true,
      receivedBodyHash: 'a'.repeat(64),
      receiptHash: 'b'.repeat(64),
      acceptedAt: '1700000000000',
      issuer: 'arma-api-hub',
      signature: { algorithm: 'HMAC-SHA256', keyId: 'local-dev-key-0001', value: 'c'.repeat(64) },
      correlation: { correlationId: 'corr-00000001' },
    };
    expect(validate(signedReceiptSchema, receipt).ok).toBe(true);
  });
});
