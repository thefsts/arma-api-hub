// Scenario coverage: revoked service, missing capability, tenant mismatch,
// kill-switch denial. All decisions fail closed.

import { describe, expect, it } from 'vitest';
import { revokeCredential } from '@arma/auth';
import { admitServiceRequest, evaluatePolicy, InMemoryPolicyRegistry } from '@arma/policy';
import { syntheticActiveService } from '@arma/testing';
import {
  createHarness,
  signedRequest,
  TEST_AUDIENCE,
  TEST_CAPABILITY,
  TEST_KEY_ID,
} from '../support/harness.js';

describe('policy enforcement', () => {
  it('SCENARIO 7: rejects a request signed with a revoked credential', async () => {
    const h = createHarness();
    revokeCredential(h.credentials, TEST_KEY_ID, 'test-revocation', h.clock.now());
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
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('CREDENTIAL_REVOKED');
  });

  it('SCENARIO 8: denies a service that lacks the required capability', () => {
    const registry = new InMemoryPolicyRegistry();
    registry.register(syntheticActiveService());
    const decision = evaluatePolicy(registry, {
      serviceId: 'arma-sentinel',
      capability: 'admin.deleteEverything',
      direction: 'INBOUND',
      classification: 'CONFIDENTIAL',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('CAPABILITY_MISSING');
  });

  it('SCENARIO 9: denies a tenant-scoped request outside the authorized tenant', async () => {
    const h = createHarness({ authorizedTenantIds: ['tenant-alpha'] });
    const { envelope, body } = signedRequest({ tenant: { tenantId: 'tenant-beta' } });
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
    if (!decision.ok) {
      expect(decision.code).toBe('POLICY_DENIED');
      expect(decision.detail?.reason).toBe('TENANT_MISMATCH');
    }
  });

  it('SCENARIO 13: denies a service whose kill switch is engaged', async () => {
    const h = createHarness({ killSwitchEngaged: true });
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
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('POLICY_DENIED');
      expect(decision.detail?.reason).toBe('KILL_SWITCH_ENGAGED');
    }
  });

  it('denies an unregistered service (fail closed)', () => {
    const registry = new InMemoryPolicyRegistry();
    const decision = evaluatePolicy(registry, {
      serviceId: 'arma-unknown',
      capability: 'events.subscribe',
      direction: 'INBOUND',
      classification: 'PUBLIC',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('SERVICE_UNKNOWN');
  });

  it('denies a service that is not in an active lifecycle', () => {
    const registry = new InMemoryPolicyRegistry();
    registry.register(syntheticActiveService({ lifecycle: 'DRAFT' }));
    const decision = evaluatePolicy(registry, {
      serviceId: 'arma-sentinel',
      capability: 'events.subscribe',
      direction: 'INBOUND',
      classification: 'CONFIDENTIAL',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('SERVICE_NOT_ACTIVE');
  });

  it('denies a request exceeding the capability classification ceiling', () => {
    const registry = new InMemoryPolicyRegistry();
    registry.register(syntheticActiveService());
    const decision = evaluatePolicy(registry, {
      serviceId: 'arma-sentinel',
      capability: 'events.subscribe',
      direction: 'INBOUND',
      classification: 'REGULATED',
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe('CLASSIFICATION_EXCEEDED');
  });
});
