// Cost-data isolation — deterministic negative tests.
//
// Cost and usage data is the most sensitive cross-tenant surface in the
// platform. These tests prove that a caller can never cross an authorization
// boundary by supplying another tenant, customer, service, correlation ID, or
// cost-event ID. Every read enforces the caller's server-derived SERVICE scope
// and, when the row carries them, its TENANT and CUSTOMER scope.

import { describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';

const SVC_A = 'svc-a';
const SVC_B = 'svc-b';

const baseCostEvent = {
  sourceHub: 'ARMA_API_HUB' as const,
  eventVersion: '1.0.0',
  schemaVersion: '1.0.0',
  connectorId: 'con-1',
  systemId: 'sys-1',
  serviceId: SVC_A,
  correlationId: 'corr-1',
  causationId: 'caus-1',
  requestId: 'req-1',
  quantity: 1,
  unitType: 'REQUEST' as const,
  unitPriceMinor: 25,
  currency: 'USD',
  pricingVersionId: 'prc-1',
  costStatus: 'FINALIZED' as const,
  calculationVersion: '1.0.0',
  effectiveDate: 1_700_000_000_000,
  auditRef: 'aud-1',
  billingPeriod: '2024-01',
};

/** Seed a vendor and return its id. */
async function seedVendor(t: TestConvex) {
  return await t.mutation(internal.costVendors.registerVendor, {
    name: 'Vendor One',
    slug: 'vendor-one',
    lifecycle: 'ACTIVE',
    environment: 'DEVELOPMENT',
    owner: 'platform-cost',
    dataClassification: 'INTERNAL',
  });
}

/** Record a cost event with a unique cost-event ID and idempotency key. */
async function seedCostEvent(
  t: TestConvex,
  vendorId: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  return await t.mutation(internal.costEvents.recordCostEvent, {
    ...baseCostEvent,
    costEventId: `cev-${suffix}`,
    idempotencyKey: `idem-${suffix}`,
    vendorId,
    ...overrides,
  });
}

/** Seed a scoped operator: service svc-a, tenant ten_a, customer cus_a. */
async function seedScopedOperator(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: 'scoped-op',
    principalType: 'HUMAN',
    roles: ['operator'],
    serviceIds: [SVC_A],
    tenantIds: ['ten_a'],
    customerRefs: ['cus_a'],
  });
  return t.withIdentity(identity('scoped-op'));
}

describe('cost isolation — tenant boundaries', () => {
  it('tenant A cannot read tenant B usage or costs', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'ten-a', { tenantId: 'ten_a' });
    await seedCostEvent(t, vendorId, 'ten-b', { tenantId: 'ten_b' });
    const op = await seedScopedOperator(t);

    const rows = await op.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(rows.map((r) => r.tenantId)).toEqual(['ten_a']);
  });

  it('cost-event-ID lookup cannot bypass tenant scope', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'ten-b-id', { tenantId: 'ten_b' });
    const op = await seedScopedOperator(t);
    await expect(
      op.query(internal.costEvents.getCostEvent, { costEventId: 'cev-ten-b-id' }),
    ).rejects.toThrow(/FORBIDDEN|authorized/i);
  });
});

describe('cost isolation — customer boundaries', () => {
  it('customer A cannot read customer B attribution', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'cus-a', { customerRef: 'cus_a' });
    await seedCostEvent(t, vendorId, 'cus-b', { customerRef: 'cus_b' });
    const op = await seedScopedOperator(t);

    const rows = await op.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(rows.map((r) => r.customerRef)).toEqual(['cus_a']);
  });
});

describe('cost isolation — service boundaries', () => {
  it('service A cannot inspect service B costs', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'svc-b', { serviceId: SVC_B });
    const op = await seedScopedOperator(t);
    await expect(
      op.query(internal.costEvents.getCostEvent, { costEventId: 'cev-svc-b' }),
    ).rejects.toThrow(/FORBIDDEN|authorized/i);
  });

  it('service A cannot inspect service B idempotency records', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: SVC_A,
      principalType: 'SERVICE',
      roles: ['service'],
      serviceIds: [SVC_A],
    });
    const a = t.withIdentity(identity(SVC_A));
    await expect(
      a.query(internal.idempotency.get, { serviceId: SVC_B, idempotencyKey: 'k' }),
    ).rejects.toThrow(/FORBIDDEN|bound/i);
  });
});

describe('cost isolation — role scope limits', () => {
  it('a viewer is limited to its assigned scopes', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'viewer-a', { tenantId: 'ten_a' });
    await seedCostEvent(t, vendorId, 'viewer-b', { tenantId: 'ten_b' });
    await seedAuthorization(t, {
      principalId: 'viewer-1',
      roles: ['viewer'],
      serviceIds: [SVC_A],
      tenantIds: ['ten_a'],
    });
    const viewer = t.withIdentity(identity('viewer-1'));
    const rows = await viewer.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(rows.map((r) => r.tenantId)).toEqual(['ten_a']);
  });

  it('an operator is limited to its assigned scopes unless explicitly global', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'op-a', { tenantId: 'ten_a' });
    await seedCostEvent(t, vendorId, 'op-b', { tenantId: 'ten_b' });

    await seedAuthorization(t, {
      principalId: 'op-limited',
      roles: ['operator'],
      serviceIds: [SVC_A],
      tenantIds: ['ten_a'],
    });
    const limited = t.withIdentity(identity('op-limited'));
    const limitedRows = await limited.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(limitedRows.map((r) => r.tenantId)).toEqual(['ten_a']);

    await seedAuthorization(t, {
      principalId: 'op-global',
      roles: ['operator'],
      global: true,
    });
    const global = t.withIdentity(identity('op-global'));
    const globalRows = await global.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(globalRows.map((r) => r.tenantId).sort()).toEqual(['ten_a', 'ten_b']);
  });
});

describe('cost isolation — correlation and vendor-period lookups', () => {
  it('correlation-ID lookup cannot cross authorization boundaries', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'corr-a', { correlationId: 'shared-corr' });
    await seedCostEvent(t, vendorId, 'corr-b', {
      correlationId: 'shared-corr',
      serviceId: SVC_B,
    });
    const op = await seedScopedOperator(t);
    const rows = await op.query(internal.costEvents.listByCorrelation, {
      correlationId: 'shared-corr',
    });
    expect(rows.map((r) => r.serviceId)).toEqual([SVC_A]);
  });

  it('vendor-period queries do not expose unauthorized customer or tenant records', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'vp-ok', { tenantId: 'ten_a', customerRef: 'cus_a' });
    await seedCostEvent(t, vendorId, 'vp-tenant', { tenantId: 'ten_b' });
    await seedCostEvent(t, vendorId, 'vp-customer', { customerRef: 'cus_b' });
    const op = await seedScopedOperator(t);
    const rows = await op.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe('ten_a');
    expect(rows[0]?.customerRef).toBe('cus_a');
  });
});

describe('cost isolation — export and cross-hub association', () => {
  it('a REGIVANTA export contains only the caller authorized scope', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'exp-a', { tenantId: 'ten_a' });
    await seedCostEvent(t, vendorId, 'exp-b', { tenantId: 'ten_b' });
    await seedCostEvent(t, vendorId, 'exp-c', { serviceId: SVC_B });
    const op = await seedScopedOperator(t);

    // The export source is the scoped cost-event listing.
    const exported = await op.query(internal.costEvents.listByVendorPeriod, {
      vendorId,
      billingPeriod: '2024-01',
    });
    expect(exported).toHaveLength(1);
    expect(exported[0]?.tenantId).toBe('ten_a');
    expect(exported.every((r) => r.serviceId === SVC_A)).toBe(true);
  });

  it('an AI Hub association cannot retrieve unrelated cost events', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await seedCostEvent(t, vendorId, 'aihub-a', {
      sourceHub: 'FSTS_AI_HUB',
      correlationId: 'aihub-corr',
    });
    await seedCostEvent(t, vendorId, 'aihub-b', {
      sourceHub: 'FSTS_AI_HUB',
      correlationId: 'aihub-corr',
      serviceId: SVC_B,
    });
    const op = await seedScopedOperator(t);
    const rows = await op.query(internal.costEvents.listByCorrelation, {
      correlationId: 'aihub-corr',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serviceId).toBe(SVC_A);
  });
});
