// Phase 8 PM HOLD — Section 5: hostile durable records fail closed.
//
// A durable onboarding record is AUTHORITY-BEARING. A corrupted or hostile
// record — a non-finite credential-expiry clock, a forged ACTIVE history, a
// blank credential reference — must NEVER widen routing authority. This suite
// writes such records DIRECTLY into the backend (bypassing the normal
// registration flow, exactly as a corruption bug or a hostile write would) and
// proves the routing gate fails closed.
//
// convex-test ENFORCES the schema for non-number types (a string in a number
// field is rejected), but `NaN` and `+/-Infinity` are `typeof 'number'` and are
// therefore PERMITTED by the validator — precisely the hostile durable state a
// real corruption could produce. The finiteness guard in `decideRouting` is what
// fails closed on them, and these tests are the proof.
//
// Evidence class: IN-PROCESS (convex-test).
//
// All identities/tenants are synthetic.

import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import type { Doc } from '../../convex/_generated/dataModel.js';
import { decideRouting, type ProductOnboardingRecord } from '../../convex/lib/productRouting.js';
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

const LEGAL_ACTIVE_HISTORY = [
  'PROPOSED',
  'REVIEWED',
  'APPROVED',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVE',
] as const;

type OnboardingInsert = Omit<Doc<'productOnboardings'>, '_id' | '_creationTime'>;

/** Seed a routing caller scoped for the owning service (route needs service scope only). */
async function seedRouter(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: 'router',
    principalType: 'HUMAN',
    roles: ['operator'],
    serviceIds: [SERVICE],
    environments: [ENV],
  });
  return t.withIdentity(identity('router'));
}

/**
 * Insert a durable onboarding record DIRECTLY, overriding any field. This is the
 * hostile-write path: it does not go through `register`, so it can carry values
 * the normal flow would never produce (NaN/Infinity expiry, forged history).
 */
async function insertOnboarding(
  t: TestConvex,
  over: Partial<OnboardingInsert> = {},
): Promise<void> {
  const base: OnboardingInsert = {
    onboardingId: 'onb-hostile',
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
  };
  await t.run(async (ctx) => {
    await ctx.db.insert('productOnboardings', { ...base, ...over });
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

/** A valid, ACTIVE, unexpired pure record for the unit-level checks. */
function pureRecord(over: Partial<ProductOnboardingRecord> = {}): ProductOnboardingRecord {
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
    history: [...LEGAL_ACTIVE_HISTORY],
    ...over,
  };
}

function pureRequest(over: Partial<Record<string, string>> = {}) {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: SERVICE,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
    ...over,
  };
}

// ===========================================================================
// S5.1 — hostile credential-expiry clock (durable record).
// ===========================================================================
describe('S5.1 — hostile credential-expiry clock fails closed (durable record)', () => {
  it('NaN credentialExpiresAt denies AUTHENTICATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialExpiresAt: Number.NaN });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('+Infinity credentialExpiresAt denies AUTHENTICATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialExpiresAt: Number.POSITIVE_INFINITY });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('-Infinity credentialExpiresAt denies AUTHENTICATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialExpiresAt: Number.NEGATIVE_INFINITY });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('an expiry exactly equal to now denies (expired at the boundary)', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialExpiresAt: NOW });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('an expiry one millisecond in the past denies', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialExpiresAt: NOW - 1 });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('a finite future expiry allows', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialExpiresAt: NOW + 1 });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({ allowed: true });
  });

  it('an absent expiry allows (no expiry configured)', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t);
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({ allowed: true });
  });
});

// ===========================================================================
// S5.2 — hostile evaluation clock (the server-supplied `now`).
// ===========================================================================
describe('S5.2 — hostile evaluation clock fails closed', () => {
  it('NaN now denies VALIDATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t);
    const decision = await router.query(
      internal.productOnboardings.route,
      routeArgs({ now: Number.NaN }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('+Infinity now denies VALIDATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t);
    const decision = await router.query(
      internal.productOnboardings.route,
      routeArgs({ now: Number.POSITIVE_INFINITY }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('-Infinity now denies VALIDATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t);
    const decision = await router.query(
      internal.productOnboardings.route,
      routeArgs({ now: Number.NEGATIVE_INFINITY }),
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('a non-finite now is denied BEFORE the credential-expiry comparison (pure)', () => {
    // The credential is unexpired; a non-finite now would make `expiresAt <= now`
    // false and silently admit it. The guard must run first.
    const record = pureRecord({ credentialExpiresAt: NOW + 10_000 });
    expect(decideRouting(pureRequest(), record, Number.NaN)).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
      disposition: 'TERMINAL',
    });
    expect(decideRouting(pureRequest(), record, Number.POSITIVE_INFINITY)).toMatchObject({
      allowed: false,
      code: 'VALIDATION_FAILED',
      disposition: 'TERMINAL',
    });
  });
});

// ===========================================================================
// S5.3 — forged / blank durable authority fields.
// ===========================================================================
describe('S5.3 — forged or blank durable authority fields fail closed', () => {
  it('a forged ACTIVE history (gap) denies INTEGRATION_INACTIVE / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    // ACTIVE claimed with an illegal walk (PROPOSED -> ACTIVE is a forbidden shortcut).
    await insertOnboarding(t, { state: 'ACTIVE', history: ['PROPOSED', 'ACTIVE'] });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'INTEGRATION_INACTIVE',
      disposition: 'TERMINAL',
    });
  });

  it('a history that does not start at PROPOSED denies INTEGRATION_INACTIVE / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { state: 'ACTIVE', history: ['ACTIVE'] });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'INTEGRATION_INACTIVE',
      disposition: 'TERMINAL',
    });
  });

  it('an empty history denies INTEGRATION_INACTIVE / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { state: 'ACTIVE', history: [] });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'INTEGRATION_INACTIVE',
      disposition: 'TERMINAL',
    });
  });

  it('a blank credential reference denies AUTHENTICATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialReference: '' });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('a whitespace-only credential reference denies AUTHENTICATION_FAILED / TERMINAL', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await insertOnboarding(t, { credentialReference: '   ' });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toMatchObject({
      allowed: false,
      code: 'AUTHENTICATION_FAILED',
      disposition: 'TERMINAL',
    });
  });

  it('a non-number credentialExpiresAt cannot even be persisted (schema rejects it)', async () => {
    const t = setup();
    await expect(
      insertOnboarding(t, { credentialExpiresAt: 'soon' as unknown as number }),
    ).rejects.toThrow(/Validator error|Expected 'number'/i);
  });
});
