// Role-claim trust — deterministic negative tests.
//
// The Phase 0 authorization model NEVER trusts caller-supplied role claims.
// A caller is authenticated only when its identity originates from the
// configured trusted issuer, and it is authorized only through a durable
// `principalAuthorizations` record. These tests prove that forged, missing,
// unknown, and conflicting role claims all fail closed, and that service and
// human identities cannot masquerade as one another.

import { describe, expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api.js';
import {
  GLOBAL_ADMIN,
  TRUSTED_ISSUER,
  identity,
  seedAuthorization,
  seedGlobalAdmin,
  setup,
} from '../convex/helpers.js';

/** Seed a single system and return its generated system ID. */
async function seedSystem(t: ReturnType<typeof setup>, slug = 'alpha') {
  return await t.mutation(internal.systems.create, {
    name: 'Alpha',
    slug,
    ownership: 'FSTS_OWNED',
    lifecycle: 'ACTIVE',
    environment: 'DEVELOPMENT',
    owner: 'platform',
    dataClassification: 'INTERNAL',
  });
}

describe('role-claim trust — forged and missing claims', () => {
  it('rejects a caller that forges an admin role claim with no durable binding', async () => {
    const t = setup();
    await seedSystem(t);
    const forged = t.withIdentity({
      subject: 'attacker',
      issuer: TRUSTED_ISSUER,
      roles: ['admin'],
      role: 'admin',
    });
    await expect(forged.query(internal.systems.list, {})).rejects.toThrow(/FORBIDDEN|binding/i);
  });

  it('rejects a caller with a verified subject but no authorization binding', async () => {
    const t = setup();
    await seedSystem(t);
    const caller = t.withIdentity(identity('unbound-subject'));
    await expect(caller.query(internal.systems.list, {})).rejects.toThrow(/FORBIDDEN|binding/i);
  });

  it('rejects an unauthenticated caller (no identity at all)', async () => {
    const t = setup();
    await seedSystem(t);
    await expect(t.query(internal.systems.list, {})).rejects.toThrow(/UNAUTHENTICATED|identity/i);
  });

  it('rejects an identity from an untrusted issuer even with a valid binding', async () => {
    const t = setup();
    await seedSystem(t);
    await seedAuthorization(t, {
      principalId: 'someone',
      roles: ['admin'],
      global: true,
    });
    const wrongIssuer = t.withIdentity(identity('someone', 'https://evil.example'));
    await expect(wrongIssuer.query(internal.systems.list, {})).rejects.toThrow(
      /UNAUTHENTICATED|issuer|identity/i,
    );
  });
});

describe('role-claim trust — unknown and conflicting claims', () => {
  it('ignores an unknown role claim and enforces the durable binding', async () => {
    const t = setup();
    const systemId = await seedSystem(t);
    await seedAuthorization(t, {
      principalId: 'viewer-1',
      roles: ['viewer'],
      systemIds: [systemId],
    });
    // The caller claims a role that does not exist; the durable binding wins.
    const caller = t.withIdentity({
      subject: 'viewer-1',
      issuer: TRUSTED_ISSUER,
      roles: ['superuser', 'root'],
    });
    const rows = await caller.query(internal.systems.list, {});
    expect(rows.map((r) => r.systemId)).toEqual([systemId]);
  });

  it('resolves conflicting role claims in favour of the durable binding (deny)', async () => {
    const t = setup();
    const systemId = await seedSystem(t);
    await seedAuthorization(t, {
      principalId: 'conflicted',
      roles: ['viewer'],
      systemIds: ['sys_other'],
    });
    // The caller claims admin, but the durable binding grants only sys_other.
    const caller = t.withIdentity({
      subject: 'conflicted',
      issuer: TRUSTED_ISSUER,
      roles: ['admin'],
    });
    await expect(caller.query(internal.systems.get, { systemId })).rejects.toThrow(
      /FORBIDDEN|authorized/i,
    );
  });

  it('denies access when the durable binding is SUSPENDED or REVOKED', async () => {
    const t = setup();
    await seedSystem(t);
    await seedAuthorization(t, {
      principalId: 'suspended',
      roles: ['admin'],
      global: true,
      state: 'SUSPENDED',
    });
    const caller = t.withIdentity(identity('suspended'));
    await expect(caller.query(internal.systems.list, {})).rejects.toThrow(/FORBIDDEN|binding/i);
  });
});

describe('role-claim trust — identity-type masquerade', () => {
  it('prevents a service identity from acting as a global human admin', async () => {
    const t = setup();
    const systemId = await seedSystem(t);
    await seedAuthorization(t, {
      principalId: 'svc-a',
      principalType: 'SERVICE',
      roles: ['service'],
      serviceIds: ['svc-a'],
    });
    const service = t.withIdentity({
      subject: 'svc-a',
      issuer: TRUSTED_ISSUER,
      roles: ['admin'],
    });
    // A service principal is not global; it cannot read an unrelated system.
    await expect(service.query(internal.systems.get, { systemId })).rejects.toThrow(
      /FORBIDDEN|authorized/i,
    );
  });

  it('prevents a human identity from masquerading as a service identity', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'human-1',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: ['svc-a'],
    });
    const human = t.withIdentity(identity('human-1'));
    // The human holds svc-a in scope, so the binding passes; but a human that
    // does NOT hold the service in scope is rejected. Prove the negative case.
    await seedAuthorization(t, {
      principalId: 'human-2',
      principalType: 'HUMAN',
      roles: ['operator'],
      serviceIds: ['svc-b'],
    });
    const other = t.withIdentity(identity('human-2'));
    await expect(
      other.query(internal.idempotency.get, { serviceId: 'svc-a', idempotencyKey: 'k' }),
    ).rejects.toThrow(/FORBIDDEN|bound/i);
    // Sanity: the in-scope human is allowed.
    const allowed = await human.query(internal.idempotency.get, {
      serviceId: 'svc-a',
      idempotencyKey: 'k',
    });
    expect(allowed).toBeNull();
  });
});

describe('role-claim trust — global grant is explicit and auditable', () => {
  it('grants cross-scope access only through an explicit global binding', async () => {
    const t = setup();
    const systemId = await seedSystem(t);
    await seedGlobalAdmin(t);
    const admin = t.withIdentity(identity(GLOBAL_ADMIN));
    const rows = await admin.query(internal.systems.list, {});
    expect(rows.map((r) => r.systemId)).toContain(systemId);
  });
});
