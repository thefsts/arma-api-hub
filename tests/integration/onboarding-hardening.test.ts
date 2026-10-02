// Phase 8 integration review — onboarding hardening regressions.
//
// Covers the defects corrected on the integration branch:
//   D1  read scope must key on the Hub routing identity (service identity),
//       never on the product id.
//   D2  `register` is idempotent by `onboardingId` (identical replay returns
//       the same id; a different payload under the same id is a conflict).
//   D3  a non-finite evaluation clock fails closed (no credential-expiry
//       bypass).
//   D4  conflicting authorization (more than one onboarding for the same
//       product/tenant/environment) fails closed.
//   D5  a registration descriptor does NOT grant access or activate a product:
//       registration is not activation and carries no routing authority.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup } from '../convex/helpers.js';
import { decideRouting, type ProductOnboardingRecord } from '../../convex/lib/productRouting.js';
import { serviceRegisterPayloadSchema, validate } from '@arma/contracts';

const NOW = 1_700_000_000_000;
const PRODUCT = 'patches';
const SERVICE = 'svc-patches-compliance-signals';
const OTHER_SERVICE = 'svc-lawshield-compliance-assurance';
const TENANT = 'SYNTH-TENANT-A';
const ENV = 'PRODUCTION';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';
const CRED_REF = 'key-patches-0001';
const CONTRACT_VERSION = '1.0.0';
const API_VERSION = '1.1.0';

/**
 * Seed an ADMIN principal authorized for the given service ids and the target
 * environment. Onboarding administration (register/advance/lifecycle) requires
 * the admin role; reads additionally require service scope.
 */
async function seedAdmin(serviceIds: string[]) {
  const t = setup();
  await seedAuthorization(t, {
    principalId: 'admin-1',
    principalType: 'HUMAN',
    roles: ['admin'],
    serviceIds,
    environments: [ENV],
  });
  return { t, op: t.withIdentity(identity('admin-1')) };
}

function registerArgs(over: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: SERVICE,
    allowedScopes: [SCOPE],
    allowedOperations: [OP],
    credentialReference: CRED_REF,
    contractVersion: CONTRACT_VERSION,
    ...over,
  };
}

// ===========================================================================
// D1 — read scope keys on the routing identity, not the product id.
// ===========================================================================
describe('D1 — read scope keys on the Hub routing identity', () => {
  it('an operator authorized for the owning service can read the onboarding', async () => {
    const { op } = await seedAdmin([SERVICE]);
    await op.mutation(internal.productOnboardings.register, registerArgs());
    const record = await op.query(internal.productOnboardings.getByProductTenant, {
      productId: PRODUCT,
      tenantId: TENANT,
    });
    expect(record).not.toBeNull();
    expect(record?.hubRoutingIdentity).toBe(SERVICE);
    expect(record?.productId).toBe(PRODUCT);
  });

  it('an operator authorized for a DIFFERENT service cannot read it', async () => {
    // The owning admin (scoped for SERVICE) registers the onboarding. A separate
    // principal scoped only for OTHER_SERVICE must not be able to read it, even
    // though it holds the `operator` role. Scope keys on the routing identity.
    const { t, op: admin } = await seedAdmin([SERVICE]);
    await admin.mutation(internal.productOnboardings.register, registerArgs());
    await seedAuthorization(t, {
      principalId: 'operator-other',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: [OTHER_SERVICE],
      environments: [ENV],
    });
    const other = t.withIdentity(identity('operator-other'));
    await expect(
      other.query(internal.productOnboardings.getByProductTenant, {
        productId: PRODUCT,
        tenantId: TENANT,
      }),
    ).rejects.toThrow(/FORBIDDEN|authorized/i);
  });

  it('listByProduct returns only onboardings the caller is scoped for', async () => {
    const { t, op: admin } = await seedAdmin([SERVICE]);
    await admin.mutation(internal.productOnboardings.register, registerArgs());
    await seedAuthorization(t, {
      principalId: 'operator-other',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: [OTHER_SERVICE],
      environments: [ENV],
    });
    const other = t.withIdentity(identity('operator-other'));
    const rows = await other.query(internal.productOnboardings.listByProduct, {
      productId: PRODUCT,
    });
    expect(rows).toEqual([]);
  });
});

// ===========================================================================
// D2 — register idempotency.
// ===========================================================================
describe('D2 — register is idempotent by onboardingId', () => {
  it('an identical replay returns the same id without error', async () => {
    const { op } = await seedAdmin([SERVICE]);
    const args = registerArgs({ onboardingId: 'onb-fixed' });
    const first = await op.mutation(internal.productOnboardings.register, args);
    const second = await op.mutation(internal.productOnboardings.register, args);
    expect(first).toBe('onb-fixed');
    expect(second).toBe('onb-fixed');
  });

  it('a different payload under the same id is a conflict', async () => {
    const { op } = await seedAdmin([SERVICE]);
    await op.mutation(
      internal.productOnboardings.register,
      registerArgs({ onboardingId: 'onb-fixed' }),
    );
    await expect(
      op.mutation(
        internal.productOnboardings.register,
        registerArgs({ onboardingId: 'onb-fixed', tenantId: 'SYNTH-TENANT-Z' }),
      ),
    ).rejects.toThrow(/CONFLICT|different content/i);
  });
});

// ===========================================================================
// D3 — non-finite clock fails closed.
// ===========================================================================
describe('D3 — a non-finite evaluation clock fails closed', () => {
  function record(over: Partial<ProductOnboardingRecord> = {}): ProductOnboardingRecord {
    return {
      productId: PRODUCT,
      tenantId: TENANT,
      environment: ENV,
      hubRoutingIdentity: SERVICE,
      allowedScopes: [SCOPE],
      allowedOperations: [OP],
      credentialReference: CRED_REF,
      contractVersion: CONTRACT_VERSION,
      state: 'ACTIVE',
      history: ['PROPOSED', 'REVIEWED', 'APPROVED', 'PROVISIONED', 'VERIFIED', 'ACTIVE'],
      credentialExpiresAt: NOW + 10_000,
      ...over,
    };
  }
  const request = {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: SERVICE,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
  };

  it('NaN now denies (would otherwise skip the expiry comparison)', () => {
    expect(decideRouting(request, record(), Number.NaN)).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
    });
  });

  it('Infinity now denies', () => {
    expect(decideRouting(request, record(), Number.POSITIVE_INFINITY)).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
    });
  });

  it('a finite now still allows a valid, unexpired onboarding', () => {
    expect(decideRouting(request, record(), NOW).allowed).toBe(true);
  });
});

// ===========================================================================
// D4 — conflicting authorization fails closed.
// ===========================================================================
describe('D4 — conflicting authorization fails closed', () => {
  it('register refuses a second onboarding for the same product/tenant/environment', async () => {
    const { op } = await seedAdmin([SERVICE]);
    await op.mutation(internal.productOnboardings.register, registerArgs());
    await expect(
      op.mutation(
        internal.productOnboardings.register,
        registerArgs({ onboardingId: 'onb-second', hubRoutingIdentity: SERVICE }),
      ),
    ).rejects.toThrow(/CONFLICT|already binds/i);
  });

  it('route fails closed when two rows claim the same binding', async () => {
    const { t, op } = await seedAdmin([SERVICE]);
    await t.run(async (ctx) => {
      for (const onboardingId of ['onb-a', 'onb-b']) {
        await ctx.db.insert('productOnboardings', {
          onboardingId,
          productId: PRODUCT,
          tenantId: TENANT,
          environment: ENV,
          hubRoutingIdentity: SERVICE,
          allowedScopes: [SCOPE],
          allowedOperations: [OP],
          credentialReference: CRED_REF,
          contractVersion: CONTRACT_VERSION,
          state: 'ACTIVE',
          history: ['PROPOSED', 'REVIEWED', 'APPROVED', 'PROVISIONED', 'VERIFIED', 'ACTIVE'],
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    const decision = await op.query(internal.productOnboardings.route, {
      productId: PRODUCT,
      tenantId: TENANT,
      environment: ENV,
      hubRoutingIdentity: SERVICE,
      operation: OP,
      scope: SCOPE,
      contractVersion: CONTRACT_VERSION,
      apiVersion: API_VERSION,
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, code: 'CONFLICT' });
  });
});

// ===========================================================================
// D5 — a registration descriptor does not grant access or activate a product.
// ===========================================================================
describe('D5 — registration descriptors do not grant access or activate a product', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const descriptor = JSON.parse(
    readFileSync(`${root}contracts/products/patches.compliance-signals.register.json`, 'utf8'),
  ) as Record<string, unknown>;

  it('validates against the generic registration schema', () => {
    expect(validate(serviceRegisterPayloadSchema, descriptor).ok).toBe(true);
  });

  it('carries no onboarding/lifecycle state and no routing authority', () => {
    for (const forbidden of [
      'state',
      'lifecycle',
      'onboardingStatus',
      'history',
      'hubRoutingIdentity',
      'allowedScopes',
      'allowedOperations',
      'credentialReference',
      'killSwitchEngaged',
    ]) {
      expect(descriptor[forbidden]).toBeUndefined();
    }
  });

  it('does not create an onboarding and cannot route (registration != activation)', async () => {
    const { op } = await seedAdmin([descriptor.serviceId as string]);
    // No onboarding exists for the descriptor's product.
    const record = await op.query(internal.productOnboardings.getByProductTenant, {
      productId: descriptor.productId as string,
      tenantId: TENANT,
    });
    expect(record).toBeNull();
    // With no onboarding, the routing gate denies.
    const decision = await op.query(internal.productOnboardings.route, {
      productId: descriptor.productId as string,
      tenantId: TENANT,
      environment: descriptor.environment as string,
      hubRoutingIdentity: descriptor.serviceId as string,
      operation: OP,
      scope: SCOPE,
      contractVersion: CONTRACT_VERSION,
      apiVersion: API_VERSION,
      now: NOW,
    });
    expect(decision).toMatchObject({ allowed: false, code: 'PRODUCT_DENIED' });
  });
});
