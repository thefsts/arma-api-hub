// Scenario coverage: stale request (clock skew), duplicate nonce (replay),
// incorrect audience (destination mismatch).

import { describe, expect, it } from 'vitest';
import { MAX_CLOCK_SKEW_MS, verifyCanonicalRequestSignature } from '@arma/crypto';
import { admitServiceRequest } from '@arma/policy';
import {
  createHarness,
  signedRequest,
  TEST_AUDIENCE,
  TEST_CAPABILITY,
  TEST_SECRET,
} from '../support/harness.js';

describe('signature and replay controls', () => {
  it('SCENARIO 4: rejects a stale request outside the clock-skew window', async () => {
    const h = createHarness();
    const staleNow = h.clock.now() - (MAX_CLOCK_SKEW_MS + 60_000);
    const { envelope, body } = signedRequest({}, staleNow);

    // Direct primitive check surfaces the precise failure code.
    const direct = verifyCanonicalRequestSignature({
      secret: TEST_SECRET,
      method: 'POST',
      path: '/v1/validate',
      timestamp: envelope.timestamp,
      nonce: envelope.nonce,
      bodyHash: envelope.bodyHash,
      providedSignature: envelope.signature.value,
      now: h.clock.now(),
    });
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.code).toBe('SIGNATURE_CLOCK_SKEW_EXCEEDED');

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
    if (!decision.ok) expect(decision.code).toBe('SIGNATURE_INVALID');
  });

  it('SCENARIO 5: rejects a replayed nonce', async () => {
    const h = createHarness();
    const { envelope, body } = signedRequest();
    const base = {
      envelope,
      rawBody: body,
      method: 'POST',
      path: '/v1/validate',
      expectedAudience: TEST_AUDIENCE,
      capability: TEST_CAPABILITY,
      direction: 'INBOUND' as const,
      now: h.clock.now(),
      credentials: h.credentials,
      resolveSecret: h.resolveSecret,
      nonces: h.nonces,
      idempotency: h.idempotency,
      policy: h.policy,
    };

    const first = await admitServiceRequest(base);
    expect(first.ok).toBe(true);

    const second = await admitServiceRequest(base);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('NONCE_REPLAYED');
  });

  it('SCENARIO 6: rejects a request addressed to the wrong audience', async () => {
    const h = createHarness();
    const { envelope, body } = signedRequest();
    const decision = await admitServiceRequest({
      envelope,
      rawBody: body,
      method: 'POST',
      path: '/v1/validate',
      expectedAudience: 'arma-some-other-service',
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
    if (!decision.ok) expect(decision.code).toBe('AUDIENCE_MISMATCH');
  });

  it('rejects a tampered signature', async () => {
    const h = createHarness();
    const { envelope, body } = signedRequest();
    const tampered = {
      ...envelope,
      signature: { ...envelope.signature, value: 'f'.repeat(64) },
    };
    const decision = await admitServiceRequest({
      envelope: tampered,
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
    if (!decision.ok) expect(decision.code).toBe('SIGNATURE_INVALID');
  });
});
