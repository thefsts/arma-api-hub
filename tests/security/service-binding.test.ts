// Service-identity binding — deterministic negative tests.
//
// A service caller is bound to its server-derived service identity. It may
// only read or affect its OWN resources. Supplying another service's
// `serviceId` is rejected even when the caller holds the `service` role. These
// tests prove service A cannot read or affect service B across every
// service-facing resource.

import { describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';

const SVC_A = 'svc-a';
const SVC_B = 'svc-b';

/** Seed two services, each authorized only for its own service scope. */
async function seedTwoServices(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: SVC_A,
    principalType: 'SERVICE',
    roles: ['service'],
    serviceIds: [SVC_A],
  });
  await seedAuthorization(t, {
    principalId: SVC_B,
    principalType: 'SERVICE',
    roles: ['service'],
    serviceIds: [SVC_B],
  });
  return {
    a: t.withIdentity(identity(SVC_A)),
    b: t.withIdentity(identity(SVC_B)),
  };
}

describe('service-identity binding — idempotency records', () => {
  it('service A cannot read service B idempotency records', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await expect(
      a.query(internal.idempotency.get, { serviceId: SVC_B, idempotencyKey: 'k1' }),
    ).rejects.toThrow(/FORBIDDEN|bound/i);
  });

  it('service A can read its own idempotency records', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    const result = await a.query(internal.idempotency.get, {
      serviceId: SVC_A,
      idempotencyKey: 'k1',
    });
    expect(result).toBeNull();
  });
});

describe('service-identity binding — nonce records', () => {
  it('service A cannot record a nonce for service B', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await expect(
      a.mutation(internal.nonces.record, {
        serviceId: SVC_B,
        keyId: 'key-b',
        nonce: 'nonce-1',
        validityMs: 60_000,
      }),
    ).rejects.toThrow(/FORBIDDEN|bound/i);
  });

  it('service A cannot probe replay state for service B', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await expect(
      a.query(internal.nonces.isReplay, { serviceId: SVC_B, nonce: 'nonce-1', now: 1000 }),
    ).rejects.toThrow(/FORBIDDEN|bound/i);
  });
});

describe('service-identity binding — capabilities and credentials', () => {
  it('service A cannot read service B capability grants', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await expect(
      a.query(internal.capabilities.listByService, { serviceId: SVC_B }),
    ).rejects.toThrow(/FORBIDDEN|authorized/i);
  });

  it('service A cannot read service B credential metadata', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await expect(a.query(internal.credentials.listByService, { serviceId: SVC_B })).rejects.toThrow(
      /FORBIDDEN|authorized/i,
    );
  });
});

describe('service-identity binding — webhooks and connector health', () => {
  it('service A cannot list service B webhook endpoints', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await expect(
      a.query(internal.webhooks.listEndpointsByService, { serviceId: SVC_B }),
    ).rejects.toThrow(/FORBIDDEN|authorized/i);
  });

  it('service A cannot read connector health owned by service B', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await t.mutation(internal.connectors.reportHealth, {
      connectorId: 'con-b',
      serviceId: SVC_B,
      status: 'HEALTHY',
    });
    await expect(a.query(internal.connectors.getHealth, { connectorId: 'con-b' })).rejects.toThrow(
      /FORBIDDEN|authorized/i,
    );
  });

  it('service A can read connector health it owns', async () => {
    const t = setup();
    const { a } = await seedTwoServices(t);
    await t.mutation(internal.connectors.reportHealth, {
      connectorId: 'con-a',
      serviceId: SVC_A,
      status: 'HEALTHY',
    });
    const health = await a.query(internal.connectors.getHealth, { connectorId: 'con-a' });
    expect(health?.serviceId).toBe(SVC_A);
  });
});
