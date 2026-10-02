// Phase 8 PM HOLD — Section 6: ambiguity cannot be hidden by a query limit.
//
// The routing authority key is the EXACT (productId, tenantId, environment)
// binding. A hostile durable state could contain MANY rows claiming the same
// binding. If any read or the uniqueness check used a bounded scan (`.take(N)`)
// or `.first()`, a conflicting sibling could be hidden and the Hub would
// silently pick one — ambiguous routing authority. This suite writes MORE THAN
// TEN siblings directly and proves every read fails closed (or resolves the
// exact binding correctly), never silently picking a row.
//
// Evidence class: IN-PROCESS (convex-test).

import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import type { Doc } from '../../convex/_generated/dataModel.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';

const NOW = 1_700_000_000_000;
const PRODUCT = 'arma-system-360';
const SERVICE = 'arma-system-360';
const TENANT = 'SYNTH-TENANT-A';
const ENV = 'PRODUCTION';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';
const CRED_REF = 'key-arma-0001';
const CONTRACT_VERSION = '1.0.0';
const API_VERSION = '1.1.0';
const SIBLINGS = 12; // deliberately > 10

const LEGAL_ACTIVE_HISTORY = [
  'PROPOSED',
  'REVIEWED',
  'APPROVED',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVE',
] as const;

type OnboardingInsert = Omit<Doc<'productOnboardings'>, '_id' | '_creationTime'>;

async function seedRouter(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: 'router',
    principalType: 'HUMAN',
    roles: ['operator'],
    serviceIds: [SERVICE],
    environments: ['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'],
  });
  return t.withIdentity(identity('router'));
}

async function seedAdmin(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: 'admin-1',
    principalType: 'HUMAN',
    roles: ['admin'],
    serviceIds: [SERVICE],
    environments: ['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'],
  });
  return t.withIdentity(identity('admin-1'));
}

function baseDoc(over: Partial<OnboardingInsert>): OnboardingInsert {
  return {
    onboardingId: 'onb-sib',
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: SERVICE,
    allowedScopes: [SCOPE],
    allowedOperations: [OP],
    credentialReference: CRED_REF,
    contractVersion: CONTRACT_VERSION,
    state: 'ACTIVE',
    history: [...LEGAL_ACTIVE_HISTORY],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** Insert N rows that all claim the SAME exact (product, tenant, environment) binding. */
async function insertSameBindingSiblings(t: TestConvex, count: number): Promise<void> {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i += 1) {
      await ctx.db.insert(
        'productOnboardings',
        baseDoc({ onboardingId: `onb-same-${i}`, environment: ENV }),
      );
    }
  });
}

function routeArgs(over: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: SERVICE,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
    now: NOW,
    ...over,
  };
}

// ===========================================================================
// S6.1 — >10 rows claiming the SAME exact binding.
// ===========================================================================
describe('S6.1 — >10 rows claiming the same exact binding', () => {
  it(`route fails closed (CONFLICT) with ${SIBLINGS} same-binding siblings`, async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertSameBindingSiblings(t, SIBLINGS);
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'CONFLICT',
      disposition: 'TERMINAL',
    });
  });

  it(`getByProductTenantEnvironment fails closed (CONFLICT) with ${SIBLINGS} same-binding siblings`, async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertSameBindingSiblings(t, SIBLINGS);
    await expect(
      router.query(internal.productOnboardings.getByProductTenantEnvironment, {
        productId: PRODUCT,
        tenantId: TENANT,
        environment: ENV,
      }),
    ).rejects.toThrow(/CONFLICT|more than one/i);
  });

  it(`register refuses to create a duplicate binding when ${SIBLINGS} siblings exist`, async () => {
    const t = setup();
    const admin = await seedAdmin(t);
    await insertSameBindingSiblings(t, SIBLINGS);
    await expect(
      admin.mutation(internal.productOnboardings.register, {
        onboardingId: 'onb-new',
        productId: PRODUCT,
        tenantId: TENANT,
        environment: ENV,
        hubRoutingIdentity: SERVICE,
        allowedScopes: [SCOPE],
        allowedOperations: [OP],
        credentialReference: CRED_REF,
        contractVersion: CONTRACT_VERSION,
      }),
    ).rejects.toThrow(/CONFLICT|already binds/i);
  });
});

// ===========================================================================
// S6.2 — >10 siblings across OTHER environments must not confuse the exact read.
// ===========================================================================
describe('S6.2 — >10 siblings across other environments do not confuse the exact read', () => {
  it('the exact-binding read resolves the single target row amid >10 siblings', async () => {
    const t = setup();
    const router = await seedRouter(t);
    // 11 siblings in DEVELOPMENT + 1 in the target PRODUCTION environment.
    await t.run(async (ctx) => {
      for (let i = 0; i < SIBLINGS - 1; i += 1) {
        await ctx.db.insert(
          'productOnboardings',
          baseDoc({ onboardingId: `onb-dev-${i}`, environment: 'DEVELOPMENT' }),
        );
      }
      await ctx.db.insert(
        'productOnboardings',
        baseDoc({ onboardingId: 'onb-prod-target', environment: 'PRODUCTION' }),
      );
    });
    const record = await router.query(internal.productOnboardings.getByProductTenantEnvironment, {
      productId: PRODUCT,
      tenantId: TENANT,
      environment: ENV,
    });
    expect(record).not.toBeNull();
    expect(record?.onboardingId).toBe('onb-prod-target');
    expect(record?.environment).toBe('PRODUCTION');
  });

  it('route resolves the exact PRODUCTION binding even with >10 DEVELOPMENT siblings', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < SIBLINGS - 1; i += 1) {
        await ctx.db.insert(
          'productOnboardings',
          baseDoc({ onboardingId: `onb-dev-${i}`, environment: 'DEVELOPMENT' }),
        );
      }
      await ctx.db.insert(
        'productOnboardings',
        baseDoc({ onboardingId: 'onb-prod-target', environment: 'PRODUCTION' }),
      );
    });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({ allowed: true });
  });

  it('the deprecated product+tenant read fails closed (CONFLICT) when >10 siblings are ambiguous', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < SIBLINGS - 1; i += 1) {
        await ctx.db.insert(
          'productOnboardings',
          baseDoc({ onboardingId: `onb-dev-${i}`, environment: 'DEVELOPMENT' }),
        );
      }
      await ctx.db.insert(
        'productOnboardings',
        baseDoc({ onboardingId: 'onb-prod-target', environment: 'PRODUCTION' }),
      );
    });
    await expect(
      router.query(internal.productOnboardings.getByProductTenant, {
        productId: PRODUCT,
        tenantId: TENANT,
      }),
    ).rejects.toThrow(/CONFLICT|Ambiguous/i);
  });
});
