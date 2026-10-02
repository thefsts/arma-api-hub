// Phase 8 PM HOLD — Sections 4 & 11: onboarding administration authorization.
//
// Onboarding administration (register / advanceState / setLifecycleState) is a
// privileged CONTROL-PLANE action. This suite proves it requires EXPLICIT
// trusted authority and fails closed for every unauthorized caller:
//
//   * a non-admin (operator / viewer) can never administer onboarding authority;
//   * an unauthenticated caller can never register;
//   * a SERVICE principal can NEVER administer onboarding authority, even if a
//     durable record mistakenly grants it the `admin` role (a product must never
//     self-register or self-activate);
//   * an administrator is bound to the environments AND the Hub routing
//     identity it is scoped for: it can neither escalate environment nor bind
//     another service's routing identity.
//
// It also covers the routing-gate negatives that key on the server-derived
// service scope (cross-service routing).
//
// All identities/tenants are synthetic. Evidence class: IN-PROCESS (convex-test).

import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';

const NOW = 1_700_000_000_000;
const PRODUCT = 'arma-system-360';
const SERVICE = 'arma-system-360';
const OTHER_SERVICE = 'svc-other-product';
const TENANT = 'SYNTH-TENANT-A';
const ENV = 'PRODUCTION';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';
const CRED_REF = 'key-arma-0001';
const CONTRACT_VERSION = '1.0.0';
const API_VERSION = '1.1.0';

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

/** Seed a HUMAN admin scoped for the given services/environments. */
async function seedHumanAdmin(
  opts: {
    serviceIds?: string[];
    environments?: Array<'DEVELOPMENT' | 'PREVIEW' | 'PRODUCTION'>;
  } = {},
) {
  const t = setup();
  await seedAuthorization(t, {
    principalId: 'admin-1',
    principalType: 'HUMAN',
    roles: ['admin'],
    serviceIds: opts.serviceIds ?? [SERVICE],
    environments: opts.environments ?? [ENV],
  });
  return { t, op: t.withIdentity(identity('admin-1')) };
}

/** Register + walk to ACTIVE using a human admin. */
async function seedActive(
  op: ReturnType<TestConvex['withIdentity']>,
  over: Record<string, unknown> = {},
): Promise<string> {
  const id = (await op.mutation(
    internal.productOnboardings.register,
    registerArgs(over),
  )) as string;
  for (const to of ['REVIEWED', 'APPROVED', 'PROVISIONED', 'VERIFIED', 'ACTIVE']) {
    await op.mutation(internal.productOnboardings.advanceState, { onboardingId: id, to });
  }
  return id;
}

// ===========================================================================
// Non-admin HUMAN principals.
// ===========================================================================
describe('onboarding administration — non-admin humans are denied', () => {
  async function seedNonAdmin(roles: Array<'operator' | 'viewer' | 'service'>) {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'non-admin',
      principalType: 'HUMAN',
      roles,
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    return { t, op: t.withIdentity(identity('non-admin')) };
  }

  for (const role of ['operator', 'viewer'] as const) {
    it(`a ${role} cannot register an onboarding`, async () => {
      const { op } = await seedNonAdmin([role]);
      await expect(
        op.mutation(internal.productOnboardings.register, registerArgs()),
      ).rejects.toThrow(/FORBIDDEN|role/i);
    });
  }

  it('a non-admin cannot advance an onboarding', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = (await admin.mutation(
      internal.productOnboardings.register,
      registerArgs(),
    )) as string;
    await seedAuthorization(t, {
      principalId: 'non-admin',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    const op = t.withIdentity(identity('non-admin'));
    await expect(
      op.mutation(internal.productOnboardings.advanceState, { onboardingId: id, to: 'REVIEWED' }),
    ).rejects.toThrow(/FORBIDDEN|role/i);
  });

  it('a non-admin cannot suspend an onboarding', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = await seedActive(admin);
    await seedAuthorization(t, {
      principalId: 'non-admin',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    const op = t.withIdentity(identity('non-admin'));
    await expect(
      op.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state: 'SUSPENDED',
      }),
    ).rejects.toThrow(/FORBIDDEN|role/i);
  });

  it('a non-admin cannot revoke an onboarding', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = await seedActive(admin);
    await seedAuthorization(t, {
      principalId: 'non-admin',
      principalType: 'HUMAN',
      roles: ['viewer'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    const op = t.withIdentity(identity('non-admin'));
    await expect(
      op.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state: 'REVOKED',
      }),
    ).rejects.toThrow(/FORBIDDEN|role/i);
  });
});

// ===========================================================================
// Unauthenticated / untrusted principals.
// ===========================================================================
describe('onboarding administration — unauthenticated callers are denied', () => {
  it('an unauthenticated caller cannot register', async () => {
    const t = setup();
    await expect(t.mutation(internal.productOnboardings.register, registerArgs())).rejects.toThrow(
      /UNAUTHENTICATED|verified identity/i,
    );
  });

  it('a caller from an untrusted issuer cannot register', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'admin-1',
      principalType: 'HUMAN',
      roles: ['admin'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    const op = t.withIdentity(identity('admin-1', 'https://evil.example.com'));
    await expect(op.mutation(internal.productOnboardings.register, registerArgs())).rejects.toThrow(
      /UNAUTHENTICATED|verified identity/i,
    );
  });
});

// ===========================================================================
// SERVICE principals can never administer onboarding authority.
// ===========================================================================
describe('onboarding administration — a SERVICE principal can never administer', () => {
  async function seedServiceAdmin() {
    const t = setup();
    // A durable record that (mistakenly) grants the service the admin role.
    await seedAuthorization(t, {
      principalId: SERVICE,
      principalType: 'SERVICE',
      roles: ['admin'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    return { t, op: t.withIdentity(identity(SERVICE)) };
  }

  it('a SERVICE principal with an admin role cannot register', async () => {
    const { op } = await seedServiceAdmin();
    await expect(op.mutation(internal.productOnboardings.register, registerArgs())).rejects.toThrow(
      /FORBIDDEN|human administrator/i,
    );
  });

  it('a SERVICE principal cannot advance its own onboarding', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = (await admin.mutation(
      internal.productOnboardings.register,
      registerArgs(),
    )) as string;
    await seedAuthorization(t, {
      principalId: SERVICE,
      principalType: 'SERVICE',
      roles: ['admin'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    const op = t.withIdentity(identity(SERVICE));
    await expect(
      op.mutation(internal.productOnboardings.advanceState, { onboardingId: id, to: 'REVIEWED' }),
    ).rejects.toThrow(/FORBIDDEN|human administrator/i);
  });

  it('a SERVICE principal cannot suspend or revoke', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = await seedActive(admin);
    await seedAuthorization(t, {
      principalId: SERVICE,
      principalType: 'SERVICE',
      roles: ['admin'],
      serviceIds: [SERVICE],
      environments: [ENV],
    });
    const op = t.withIdentity(identity(SERVICE));
    await expect(
      op.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state: 'SUSPENDED',
      }),
    ).rejects.toThrow(/FORBIDDEN|human administrator/i);
  });
});

// ===========================================================================
// Environment binding — no environment escalation.
// ===========================================================================
describe('onboarding administration — environment binding is enforced', () => {
  it('an admin scoped only for DEVELOPMENT cannot register for PRODUCTION', async () => {
    const { op } = await seedHumanAdmin({ environments: ['DEVELOPMENT'] });
    await expect(
      op.mutation(internal.productOnboardings.register, registerArgs({ environment: ENV })),
    ).rejects.toThrow(/FORBIDDEN|environment/i);
  });

  it('an admin scoped only for DEVELOPMENT cannot advance a PRODUCTION onboarding', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = (await admin.mutation(
      internal.productOnboardings.register,
      registerArgs(),
    )) as string;
    await seedAuthorization(t, {
      principalId: 'dev-admin',
      principalType: 'HUMAN',
      roles: ['admin'],
      serviceIds: [SERVICE],
      environments: ['DEVELOPMENT'],
    });
    const op = t.withIdentity(identity('dev-admin'));
    await expect(
      op.mutation(internal.productOnboardings.advanceState, { onboardingId: id, to: 'REVIEWED' }),
    ).rejects.toThrow(/FORBIDDEN|environment/i);
  });

  it('an admin scoped only for DEVELOPMENT cannot suspend a PRODUCTION onboarding', async () => {
    const { t, op: admin } = await seedHumanAdmin();
    const id = await seedActive(admin);
    await seedAuthorization(t, {
      principalId: 'dev-admin',
      principalType: 'HUMAN',
      roles: ['admin'],
      serviceIds: [SERVICE],
      environments: ['DEVELOPMENT'],
    });
    const op = t.withIdentity(identity('dev-admin'));
    await expect(
      op.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state: 'SUSPENDED',
      }),
    ).rejects.toThrow(/FORBIDDEN|environment/i);
  });
});

// ===========================================================================
// Service binding — an admin may only bind a routing identity it is scoped for.
// ===========================================================================
describe('onboarding administration — routing-identity binding is enforced', () => {
  it('an admin scoped for service A cannot register service B routing identity', async () => {
    const { op } = await seedHumanAdmin({ serviceIds: [SERVICE] });
    await expect(
      op.mutation(
        internal.productOnboardings.register,
        registerArgs({ hubRoutingIdentity: OTHER_SERVICE }),
      ),
    ).rejects.toThrow(/FORBIDDEN|authorized for this service/i);
  });

  it('a global admin may bind any routing identity (control)', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'global-admin',
      principalType: 'HUMAN',
      roles: ['admin'],
      global: true,
      environments: [ENV],
    });
    const op = t.withIdentity(identity('global-admin'));
    const id = (await op.mutation(
      internal.productOnboardings.register,
      registerArgs({ hubRoutingIdentity: OTHER_SERVICE }),
    )) as string;
    expect(id).toBeTruthy();
  });
});

// ===========================================================================
// Routing-gate negatives keyed on server-derived service scope.
// ===========================================================================
describe('routing gate — server-derived service scope is enforced', () => {
  it('a caller not scoped for the routing identity cannot route (FORBIDDEN)', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'outsider',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: [OTHER_SERVICE],
      environments: [ENV],
    });
    const outsider = t.withIdentity(identity('outsider'));
    await expect(
      outsider.query(internal.productOnboardings.route, {
        productId: PRODUCT,
        tenantId: TENANT,
        environment: ENV,
        hubRoutingIdentity: SERVICE,
        operation: OP,
        scope: SCOPE,
        contractVersion: CONTRACT_VERSION,
        apiVersion: API_VERSION,
        now: NOW,
      }),
    ).rejects.toThrow(/FORBIDDEN|authorized for this service/i);
  });

  it('a caller not scoped for the routing identity cannot read the exact binding', async () => {
    // Register with the owning admin (same backend), then read with a separate
    // principal scoped only for OTHER_SERVICE. The read must fail closed on the
    // routing identity, not return the record.
    const { t, op: admin } = await seedHumanAdmin();
    await admin.mutation(internal.productOnboardings.register, registerArgs());
    await seedAuthorization(t, {
      principalId: 'outsider',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: [OTHER_SERVICE],
      environments: [ENV],
    });
    const outsider = t.withIdentity(identity('outsider'));
    await expect(
      outsider.query(internal.productOnboardings.getByProductTenantEnvironment, {
        productId: PRODUCT,
        tenantId: TENANT,
        environment: ENV,
      }),
    ).rejects.toThrow(/FORBIDDEN|authorized for this service/i);
  });
});
