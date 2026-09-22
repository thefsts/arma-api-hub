// Cost & Usage Guard — deterministic backend tests (convex-test).
//
// Exercises the Convex cost functions in an in-memory backend. Every scenario
// is deterministic: no wall-clock dependence, no network, no real vendors.

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from '../../convex/schema.js';
import { api, internal } from '../../convex/_generated/api.js';

const modules = import.meta.glob('../../convex/**/*.*s');

const admin = { subject: 'test-admin', roles: ['admin'] };

function setup() {
  return convexTest(schema, modules);
}

/** Register a synthetic vendor and return its id. */
async function seedVendor(t: ReturnType<typeof setup>, slug = 'example-vendor') {
  return await t.mutation(internal.costVendors.registerVendor, {
    name: 'Example Vendor',
    slug,
    lifecycle: 'ACTIVE',
    environment: 'DEVELOPMENT',
    owner: 'platform-cost',
    dataClassification: 'INTERNAL',
  });
}

const baseCostEvent = {
  sourceHub: 'ARMA_API_HUB' as const,
  eventVersion: '1.0.0',
  schemaVersion: '1.0.0',
  connectorId: 'con_example',
  systemId: 'sys_example',
  serviceId: 'arma-sentinel',
  correlationId: 'corr-example-00000001',
  causationId: 'caus-example-00000001',
  requestId: 'req_example_00000001',
  quantity: 1,
  unitType: 'REQUEST' as const,
  unitPriceMinor: 25,
  currency: 'USD',
  pricingVersionId: 'prc_example_00000001',
  costStatus: 'FINALIZED' as const,
  calculationVersion: '1.0.0',
  effectiveDate: 1_700_000_000_000,
  auditRef: 'aud_example_00000001',
  billingPeriod: '2024-01',
};

describe('cost events — authoritative charge and deduplication', () => {
  it('SCENARIO 1: records exactly one authoritative charge per cost-event ID', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    const first = await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000001',
      idempotencyKey: 'idem-00000001',
      vendorId,
    });
    expect(first.status).toBe('RECORDED');
    expect(first.amountMinor).toBe(25);

    const count = await t.run(async (ctx) => {
      const rows = await ctx.db.query('apiCostEvents').take(10);
      return rows.length;
    });
    expect(count).toBe(1);
  });

  it('SCENARIO 2: rejects a duplicate cost-event ID (no second charge)', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000002',
      idempotencyKey: 'idem-00000002',
      vendorId,
    });
    const second = await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000002',
      idempotencyKey: 'idem-00000002b',
      vendorId,
    });
    expect(second.status).toBe('DUPLICATE');
    const count = await t.run(async (ctx) => (await ctx.db.query('apiCostEvents').take(10)).length);
    expect(count).toBe(1);
  });

  it('SCENARIO 3: idempotent replay returns DUPLICATE; conflicting key is rejected', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000003',
      idempotencyKey: 'idem-00000003',
      vendorId,
    });
    const replay = await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000003',
      idempotencyKey: 'idem-00000003',
      vendorId,
    });
    expect(replay.status).toBe('DUPLICATE');

    await expect(
      t.mutation(internal.costEvents.recordCostEvent, {
        ...baseCostEvent,
        costEventId: 'cev_00000003b',
        idempotencyKey: 'idem-00000003',
        vendorId,
      }),
    ).rejects.toThrow();
  });

  it('SCENARIO 5: stores monetary amounts as integers (no floating-point money)', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    const result = await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000005',
      idempotencyKey: 'idem-00000005',
      vendorId,
      quantity: 3,
      unitPriceMinor: 25,
    });
    expect(result.amountMinor).toBe(75);
    expect(Number.isInteger(result.amountMinor)).toBe(true);
  });

  it('SCENARIO 19: cost events carry correlation and causation IDs', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_00000019',
      idempotencyKey: 'idem-00000019',
      vendorId,
    });
    const row = await t.withIdentity(admin).query(api.costEvents.getCostEvent, {
      costEventId: 'cev_00000019',
    });
    expect(row?.correlationId).toBe('corr-example-00000001');
    expect(row?.causationId).toBe('caus-example-00000001');
  });
});

describe('vendor price versions', () => {
  it('SCENARIO 4: resolves the correct price version by effective date', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costVendors.addPriceVersion, {
      vendorId,
      unitType: 'REQUEST',
      unitPriceMinor: 10,
      currency: 'USD',
      pricingSource: 'rate-card-v1',
      effectiveFrom: 1000,
      effectiveTo: 2000,
    });
    await t.mutation(internal.costVendors.addPriceVersion, {
      vendorId,
      unitType: 'REQUEST',
      unitPriceMinor: 20,
      currency: 'USD',
      pricingSource: 'rate-card-v2',
      effectiveFrom: 2000,
    });
    const at1500 = await t.withIdentity(admin).query(api.costVendors.resolvePriceVersion, {
      vendorId,
      at: 1500,
    });
    const at2500 = await t.withIdentity(admin).query(api.costVendors.resolvePriceVersion, {
      vendorId,
      at: 2500,
    });
    expect(at1500?.unitPriceMinor).toBe(10);
    expect(at2500?.unitPriceMinor).toBe(20);
  });
});

describe('retry, cache, and batch savings', () => {
  it('SCENARIO 6: records retry waste deterministically', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    const result = await t.mutation(internal.costOptimization.recordRetryWaste, {
      connectorId: 'con_example',
      vendorId,
      requestId: 'req_example_00000006',
      attempts: 3,
      failedAttempts: 2,
      unitPriceMinor: 25,
      currency: 'USD',
      failureClass: 'TIMEOUT',
    });
    expect(result.wastedMinor).toBe(50);
  });

  it('SCENARIO 7: records cache savings deterministically', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    const result = await t.mutation(internal.costOptimization.recordCacheUsage, {
      connectorId: 'con_example',
      vendorId,
      tenantId: 'ten_example',
      cacheKey: 'cache-key-0001',
      hit: true,
      classification: 'INTERNAL',
      tenantScoped: true,
      unitPriceMinor: 25,
    });
    expect(result.savingsMinor).toBe(25);
  });

  it('SCENARIO 7: denies caching protected responses without tenant scoping', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await expect(
      t.mutation(internal.costOptimization.recordCacheUsage, {
        connectorId: 'con_example',
        vendorId,
        cacheKey: 'cache-key-0002',
        hit: true,
        classification: 'PROTECTED',
        tenantScoped: false,
        unitPriceMinor: 25,
      }),
    ).rejects.toThrow();
  });

  it('SCENARIO 8: records batch savings deterministically', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    const result = await t.mutation(internal.costOptimization.recordBatchUsage, {
      connectorId: 'con_example',
      vendorId,
      batchSize: 100,
      realtimeEquivalentMinor: 2500,
      batchedMinor: 500,
      currency: 'USD',
    });
    expect(result.savingsMinor).toBe(2000);
  });
});

describe('quota, budget, and spending controls', () => {
  it('SCENARIO 9: raises a quota warning at the configured threshold', async () => {
    const t = setup();
    const quotaId = await t.mutation(internal.costControls.allocateQuota, {
      scope: 'TENANT',
      scopeId: 'ten_example',
      tenantId: 'ten_example',
      billingPeriod: '2024-01',
      limitQuantity: 1000,
      unitType: 'REQUEST',
    });
    const result = await t.mutation(internal.costControls.consumeQuota, {
      quotaId,
      amount: 800,
      warningPct: 80,
      actor: 'test-admin',
    });
    expect(result.status).toBe('WARNING');
    expect(result.consumedPct).toBe(80);
  });

  it('SCENARIO 10: throttles a connector at its spending limit', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costControls.createSpendingLimit, {
      connectorId: 'con_throttle',
      vendorId,
      billingPeriod: '2024-01',
      limitMinor: 1000,
      currency: 'USD',
      action: 'THROTTLE',
    });
    const decision = await t.mutation(internal.costControls.evaluateSpendingLimit, {
      connectorId: 'con_throttle',
      billingPeriod: '2024-01',
      incrementalMinor: 1000,
      warningPct: 80,
      actor: 'test-admin',
    });
    expect(decision.status).toBe('THROTTLED');
    expect(decision.allowed).toBe(false);
  });

  it('SCENARIO 11: hard-blocks a connector at its spending limit', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costControls.createSpendingLimit, {
      connectorId: 'con_block',
      vendorId,
      billingPeriod: '2024-01',
      limitMinor: 1000,
      currency: 'USD',
      action: 'BLOCK',
    });
    const decision = await t.mutation(internal.costControls.evaluateSpendingLimit, {
      connectorId: 'con_block',
      billingPeriod: '2024-01',
      incrementalMinor: 1000,
      warningPct: 80,
      actor: 'test-admin',
    });
    expect(decision.status).toBe('BLOCKED');
    expect(decision.allowed).toBe(false);
  });
});

describe('emergency vendor shutdown', () => {
  it('SCENARIO 12: activates and releases an emergency vendor shutdown', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    const shutdownId = await t.mutation(internal.costControls.activateShutdown, {
      vendorId,
      reason: 'Emergency cost containment.',
      activatedBy: 'test-admin',
    });
    const active = await t.withIdentity(admin).query(api.costControls.isVendorShutdown, {
      vendorId,
    });
    expect(active).toBe(true);

    await t.mutation(internal.costControls.releaseShutdown, {
      shutdownId,
      releasedBy: 'test-admin',
    });
    const released = await t.withIdentity(admin).query(api.costControls.isVendorShutdown, {
      vendorId,
    });
    expect(released).toBe(false);
  });
});

describe('tenant and customer cost attribution', () => {
  it('SCENARIO 13: attributes cost per tenant without cross-tenant leakage', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_ten_a',
      idempotencyKey: 'idem-ten-a',
      vendorId,
      tenantId: 'ten_a',
    });
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_ten_b',
      idempotencyKey: 'idem-ten-b',
      vendorId,
      tenantId: 'ten_b',
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('apiCostEvents')
        .withIndex('by_tenantId_billingPeriod', (q) =>
          q.eq('tenantId', 'ten_a').eq('billingPeriod', '2024-01'),
        )
        .take(10),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe('ten_a');
  });

  it('SCENARIO 14: isolates cost by authorized customer reference', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_cus_a',
      idempotencyKey: 'idem-cus-a',
      vendorId,
      customerRef: 'cus_a',
    });
    await t.mutation(internal.costEvents.recordCostEvent, {
      ...baseCostEvent,
      costEventId: 'cev_cus_b',
      idempotencyKey: 'idem-cus-b',
      vendorId,
      customerRef: 'cus_b',
    });
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('apiCostEvents')
        .withIndex('by_customerRef_billingPeriod', (q) =>
          q.eq('customerRef', 'cus_b').eq('billingPeriod', '2024-01'),
        )
        .take(10),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.customerRef).toBe('cus_b');
  });
});

describe('audit coverage', () => {
  it('SCENARIO 20: writes an audit event for every warning, throttle, block, and shutdown', async () => {
    const t = setup();
    const vendorId = await seedVendor(t);

    // Quota warning.
    const quotaId = await t.mutation(internal.costControls.allocateQuota, {
      scope: 'TENANT',
      scopeId: 'ten_audit',
      billingPeriod: '2024-01',
      limitQuantity: 1000,
      unitType: 'REQUEST',
    });
    await t.mutation(internal.costControls.consumeQuota, {
      quotaId,
      amount: 900,
      warningPct: 80,
      actor: 'test-admin',
    });

    // Throttle + block.
    await t.mutation(internal.costControls.createSpendingLimit, {
      connectorId: 'con_audit_throttle',
      vendorId,
      billingPeriod: '2024-01',
      limitMinor: 1000,
      currency: 'USD',
      action: 'THROTTLE',
    });
    await t.mutation(internal.costControls.evaluateSpendingLimit, {
      connectorId: 'con_audit_throttle',
      billingPeriod: '2024-01',
      incrementalMinor: 1000,
      warningPct: 80,
      actor: 'test-admin',
    });
    await t.mutation(internal.costControls.createSpendingLimit, {
      connectorId: 'con_audit_block',
      vendorId,
      billingPeriod: '2024-01',
      limitMinor: 1000,
      currency: 'USD',
      action: 'BLOCK',
    });
    await t.mutation(internal.costControls.evaluateSpendingLimit, {
      connectorId: 'con_audit_block',
      billingPeriod: '2024-01',
      incrementalMinor: 1000,
      warningPct: 80,
      actor: 'test-admin',
    });

    // Shutdown.
    await t.mutation(internal.costControls.activateShutdown, {
      vendorId,
      reason: 'Audit coverage test.',
      activatedBy: 'test-admin',
    });

    const actions = await t.run(async (ctx) => {
      const rows = await ctx.db.query('auditEvents').take(50);
      return rows.map((r) => r.action);
    });
    expect(actions).toContain('cost.quota.threshold');
    expect(actions).toContain('cost.spendLimit.throttled');
    expect(actions).toContain('cost.spendLimit.blocked');
    expect(actions).toContain('cost.vendorShutdown.activate');
  });
});
