// Shared helpers for the Convex control-plane tests.
//
// The Phase 0 authorization model is server-derived: a caller is authenticated
// only when its identity originates from the configured trusted issuer, and it
// is authorized only when a durable `principalAuthorizations` record exists for
// the verified subject. These helpers make that model explicit in tests:
//
//   * `TRUSTED_ISSUER` is the synthetic issuer used for the test environment.
//   * `seedAuthorization` writes a durable authorization binding.
//   * `identity` builds a `withIdentity` argument bound to the trusted issuer.
//
// No real identity provider is used. The issuer string is a clearly-labeled
// test placeholder, never a production value.

import { convexTest } from 'convex-test';
import schema from '../../convex/schema.js';

export const TRUSTED_ISSUER = 'https://issuer.test.arma.local';

// Ensure the trusted issuer is configured for the whole test process. Without
// it the authorization layer fails closed by design.
process.env.ARMA_TRUSTED_ISSUER = TRUSTED_ISSUER;

const modules = import.meta.glob('../../convex/**/*.*s');

export type TestConvex = ReturnType<typeof convexTest>;

/** Create a fresh in-memory Convex backend. */
export function setup(): TestConvex {
  return convexTest(schema, modules);
}

export interface AuthorizationSeed {
  principalId: string;
  principalType?: 'HUMAN' | 'SERVICE';
  roles?: Array<'admin' | 'operator' | 'service' | 'viewer'>;
  global?: boolean;
  systemIds?: string[];
  serviceIds?: string[];
  tenantIds?: string[];
  customerRefs?: string[];
  capabilities?: string[];
  environments?: Array<'DEVELOPMENT' | 'PREVIEW' | 'PRODUCTION'>;
  state?: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
}

/**
 * Write a durable authorization binding directly into the backend. This is the
 * only source of authorization in the model; tests seed it explicitly so that
 * every grant is visible and auditable.
 */
export async function seedAuthorization(t: TestConvex, seed: AuthorizationSeed): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('principalAuthorizations', {
      principalId: seed.principalId,
      principalType: seed.principalType ?? 'HUMAN',
      roles: seed.roles ?? ['viewer'],
      global: seed.global ?? false,
      systemIds: seed.systemIds ?? [],
      serviceIds: seed.serviceIds ?? [],
      tenantIds: seed.tenantIds ?? [],
      customerRefs: seed.customerRefs ?? [],
      capabilities: seed.capabilities ?? [],
      environments: seed.environments ?? ['DEVELOPMENT'],
      state: seed.state ?? 'ACTIVE',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
  });
}

/** Build a `withIdentity` argument bound to the trusted issuer. */
export function identity(subject: string, issuer: string = TRUSTED_ISSUER) {
  return { subject, issuer };
}

/** A global FSTS owner/admin identity (the only cross-scope grant). */
export const GLOBAL_ADMIN = 'test-global-admin';

/** Seed the global admin binding. */
export async function seedGlobalAdmin(t: TestConvex): Promise<void> {
  await seedAuthorization(t, {
    principalId: GLOBAL_ADMIN,
    principalType: 'HUMAN',
    roles: ['admin'],
    global: true,
    environments: ['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'],
  });
}
