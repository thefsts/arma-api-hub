// Scenario coverage: duplicate idempotency key (idempotent replay vs conflict).

import { describe, expect, it } from 'vitest';
import { InMemoryIdempotencyRepository } from '@arma/database';
import { admitServiceRequest } from '@arma/policy';
import {
  createHarness,
  signedRequest,
  TEST_AUDIENCE,
  TEST_CAPABILITY,
} from '../support/harness.js';

const IDEMPOTENCY_KEY = 'idem-key-00000001';

describe('idempotency', () => {
  it('SCENARIO 11: treats a repeated key with the same body as an idempotent duplicate', async () => {
    const h = createHarness();
    const base = {
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

    const first = signedRequest({ idempotencyKey: IDEMPOTENCY_KEY });
    const firstDecision = await admitServiceRequest({
      ...base,
      envelope: first.envelope,
      rawBody: first.body,
    });
    expect(firstDecision.ok).toBe(true);
    if (firstDecision.ok) expect(firstDecision.duplicate).toBe(false);

    // Same key, same body, fresh nonce -> idempotent duplicate.
    const second = signedRequest({ idempotencyKey: IDEMPOTENCY_KEY });
    const secondDecision = await admitServiceRequest({
      ...base,
      envelope: second.envelope,
      rawBody: second.body,
    });
    expect(secondDecision.ok).toBe(true);
    if (secondDecision.ok) expect(secondDecision.duplicate).toBe(true);
  });

  it('SCENARIO 11: rejects a repeated key bound to a different body as a conflict', async () => {
    const h = createHarness();
    const base = {
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

    const first = signedRequest({ idempotencyKey: IDEMPOTENCY_KEY });
    await admitServiceRequest({ ...base, envelope: first.envelope, rawBody: first.body });

    const conflicting = signedRequest({
      idempotencyKey: IDEMPOTENCY_KEY,
      body: '{"hello":"other"}',
    });
    const decision = await admitServiceRequest({
      ...base,
      envelope: conflicting.envelope,
      rawBody: conflicting.body,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('resolves FRESH, DUPLICATE, and CONFLICT deterministically', async () => {
    const repo = new InMemoryIdempotencyRepository();
    expect(await repo.resolve('svc', 'k1', 'hash-a')).toBe('FRESH');
    await repo.record('svc', 'k1', 'hash-a', 'outcome-1');
    expect(await repo.resolve('svc', 'k1', 'hash-a')).toBe('DUPLICATE');
    expect(await repo.resolve('svc', 'k1', 'hash-b')).toBe('CONFLICT');
  });
});
