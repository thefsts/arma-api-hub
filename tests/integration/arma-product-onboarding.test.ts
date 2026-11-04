// Phase 8 · Chat 2 — ARMA System 360 pilot integration (Hub side).
//
// This suite certifies the FIRST controlled real product consumer of the
// Phase 7 Core ↔ API Hub architecture. It exercises the ACTUAL converged
// artifacts:
//   - the Hub product-onboarding registry (`convex/productOnboardings.ts`) and
//     its pure, fail-closed routing decision (`convex/lib/productRouting.ts`);
//   - the REAL Core governed pipeline (`runGovernedPipeline`) via the vendored
//     Core conformance fixture (`tests/fixtures/core-handoff`, pinned to Core
//     main @ c7ac04b2d40624bef1742f819a9f7eee43e3d12c);
//   - the transport-only client guards (`@arma/compliance-core-client`).
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE.
// The Hub transports. The Core decides. A transport outcome is NEVER a verdict.
//
// The governed path proven here is:
//   ARMA System 360 (onboarded ACTIVE) -> Hub routing ALLOW -> real Core
//   boundary (runGovernedPipeline) accepts, authorizes, dispatches, audits.
//
// All tenants/identities are synthetic. No production data is used.

import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';
import {
  FORBIDDEN_SHORTCUTS,
  ROUTING_ENVIRONMENTS,
  decideRouting,
  type ProductOnboardingRecord,
} from '../../convex/lib/productRouting.js';

// --- Real Core conformance fixture (vendored verbatim from Core main) --------
import {
  CORE_BASE,
  CORE_NOW,
  coreEnvelope,
  makeCorePorts,
  runCoreBoundary,
} from '../fixtures/core-handoff/packages/api-hub-contract/src/core-boundary.mjs';

// --- Transport-only client guards -------------------------------------------
import {
  assertNoDirectCoreDatabaseAccess,
  assertTransportDoesNotManufactureCoreState,
} from '@arma/compliance-core-client';

// --- Synthetic ARMA identity (never a production value) ----------------------
const ARMA_PRODUCT = 'arma-system-360';
const ROUTING_IDENTITY = 'arma-system-360';
const TENANT_A = 'SYNTH-TENANT-A';
const TENANT_B = 'SYNTH-TENANT-B';
const ENV = 'PRODUCTION';
const CRED_REF = 'key-arma-0001'; // a P0-5 keyId REFERENCE, never a secret
const CONTRACT_VERSION = '1.0.0';
const API_VERSION = '1.1.0';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';

// The Core scope that the Hub scope `compliance.read` maps to (per the Core
// scope registry) and that the SERVICE_IDENTITY role is authorized for.
const CORE_SCOPE = 'runtime:read';

const HUB_ROUTER = 'hub-router';

/** Seed the Hub's routing component (server-side), authorized for ARMA. */
async function seedRouter(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: HUB_ROUTER,
    principalType: 'HUMAN',
    roles: ['operator'],
    serviceIds: [ROUTING_IDENTITY],
    environments: [...ROUTING_ENVIRONMENTS],
  });
  return t.withIdentity(identity(HUB_ROUTER));
}

/** Register an ARMA onboarding in PROPOSED state. */
async function registerArma(
  router: ReturnType<TestConvex['withIdentity']>,
  over: Record<string, unknown> = {},
): Promise<string> {
  return (await router.mutation(internal.productOnboardings.register, {
    productId: ARMA_PRODUCT,
    tenantId: TENANT_A,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    allowedScopes: [SCOPE],
    allowedOperations: [OP],
    credentialReference: CRED_REF,
    contractVersion: CONTRACT_VERSION,
    ...over,
  })) as string;
}

/** Walk an onboarding through the legal forward path to ACTIVE. */
async function activate(
  router: ReturnType<TestConvex['withIdentity']>,
  onboardingId: string,
): Promise<void> {
  for (const to of ['REVIEWED', 'APPROVED', 'PROVISIONED', 'VERIFIED', 'ACTIVE']) {
    await router.mutation(internal.productOnboardings.advanceState, { onboardingId, to });
  }
}

/** A well-formed routing request for ARMA. */
function routeArgs(over: Record<string, unknown> = {}) {
  return {
    productId: ARMA_PRODUCT,
    tenantId: TENANT_A,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
    now: CORE_NOW,
    ...over,
  };
}

/** A representative onboarding record for the pure decision. */
function record(over: Partial<ProductOnboardingRecord> = {}): ProductOnboardingRecord {
  return {
    productId: ARMA_PRODUCT,
    tenantId: TENANT_A,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    allowedScopes: [SCOPE],
    allowedOperations: [OP],
    credentialReference: CRED_REF,
    contractVersion: CONTRACT_VERSION,
    state: 'ACTIVE',
    history: ['PROPOSED', 'REVIEWED', 'APPROVED', 'PROVISIONED', 'VERIFIED', 'ACTIVE'],
    ...over,
  };
}

// ===========================================================================
// Positive control — ARMA onboarded ACTIVE routes, then the REAL Core boundary
// accepts, authorizes, dispatches, and audits the governed request.
// ===========================================================================

describe('ARMA System 360 -> Hub -> real Core boundary (governed path)', () => {
  it('an ACTIVE ARMA onboarding routes ALLOW and the real Core dispatches', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const onboardingId = await registerArma(router);
    await activate(router, onboardingId);

    // 1. The Hub routing gate allows the request.
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('unreachable');
    expect(decision.route.productId).toBe(ARMA_PRODUCT);
    expect(decision.route.tenantId).toBe(TENANT_A);
    expect(decision.route.credentialReference).toBe(CRED_REF);

    // 2. The resolved route is presented to the REAL Core boundary. The Core
    //    owns authorization; the Hub only transports. The Core contract for the
    //    ARMA read action requires the mapped Core scope.
    const built = makeCorePorts({
      contract: {
        action: OP,
        requiredScope: CORE_SCOPE,
        allowedEnvironments: [ENV],
        resourceType: 'complianceRead',
      },
      identity: { productId: ARMA_PRODUCT, scope: CORE_SCOPE },
    });
    const envelope = coreEnvelope({
      productId: ARMA_PRODUCT,
      action: OP,
      environment: ENV,
      tenantId: TENANT_A,
      serviceIdentityId: CORE_BASE.serviceIdentityId,
      resourceType: 'complianceRead',
    });
    const res = await runCoreBoundary(envelope, { ports: built.ports, store: built.store });

    expect(res.ok).toBe(true);
    expect(res.outcome?.productId).toBe(ARMA_PRODUCT);
    expect(res.outcome?.tenantId).toBe(TENANT_A);
    expect(res.outcome?.action).toBe(OP);
    expect(res.outcome?.replayed).toBe(false);
    // The Core audited the success — a transport fact, never a verdict.
    expect(
      built.store.audit.some(
        (e: { action?: string; metadata?: { outcome?: string } }) =>
          e.action === 'api.invoke' && e.metadata?.outcome === 'SUCCESS',
      ),
    ).toBe(true);
  });

  it('a Hub routing ALLOW never manufactures a Core compliance verdict', () => {
    // The routing decision carries only operational facts. There is no
    // compliance/certification field to assert, and any attempt to claim an
    // authoritative Core policy state from transport fails closed.
    const decision = decideRouting(routeArgs(), record(), CORE_NOW);
    expect(decision.allowed).toBe(true);
    expect(Object.keys(decision)).toEqual(['allowed', 'route']);
    // Non-authoritative transport states are permitted; authoritative Core
    // policy states are rejected.
    expect(assertTransportDoesNotManufactureCoreState('PENDING')).toBeUndefined();
    expect(() => assertTransportDoesNotManufactureCoreState('RECEIVED')).toThrow();
    expect(() => assertTransportDoesNotManufactureCoreState('APPLIED')).toThrow();
    expect(() => assertTransportDoesNotManufactureCoreState('VERIFIED')).toThrow();
  });
});

// ===========================================================================
// Hub routing negatives — the fail-closed routing gate (pure decision).
// ===========================================================================

describe('Hub routing gate — fail-closed negatives (pure decision)', () => {
  it('P1: a request for another tenant is denied (tenant isolation)', () => {
    const d = decideRouting(routeArgs({ tenantId: TENANT_B }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'TENANT_DENIED' });
  });

  it('P2: a request claiming another product is denied (no impersonation)', () => {
    const d = decideRouting(routeArgs({ productId: 'other-fsts-product' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'PRODUCT_DENIED' });
  });

  it('P2b: a request claiming another routing identity is denied', () => {
    const d = decideRouting(
      routeArgs({ hubRoutingIdentity: 'other-routing-identity' }),
      record(),
      CORE_NOW,
    );
    expect(d).toEqual({ allowed: false, code: 'PRODUCT_DENIED' });
  });

  it('P3: a DEVELOPMENT request against a PRODUCTION onboarding is denied', () => {
    const d = decideRouting(routeArgs({ environment: 'DEVELOPMENT' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'ENVIRONMENT_DENIED' });
  });

  it('P3b: an unknown environment is denied', () => {
    const d = decideRouting(routeArgs({ environment: 'PROD' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'ENVIRONMENT_DENIED' });
  });

  it('P4: a SUSPENDED onboarding fails closed', () => {
    const d = decideRouting(routeArgs(), record({ state: 'SUSPENDED' }), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'INTEGRATION_INACTIVE' });
  });

  it('P4b: a REVOKED onboarding fails closed', () => {
    const d = decideRouting(routeArgs(), record({ state: 'REVOKED' }), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'INTEGRATION_INACTIVE' });
  });

  it('P4c: a forged ACTIVE (illegal history) fails closed', () => {
    const d = decideRouting(
      routeArgs(),
      record({ state: 'ACTIVE', history: ['PROPOSED', 'ACTIVE'] }),
      CORE_NOW,
    );
    expect(d).toEqual({ allowed: false, code: 'INTEGRATION_INACTIVE' });
  });

  it('P5: an expired credential reference fails closed', () => {
    const d = decideRouting(routeArgs(), record({ credentialExpiresAt: CORE_NOW - 1 }), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'AUTHENTICATION_FAILED' });
  });

  it('P5b: a blank credential reference fails closed', () => {
    const d = decideRouting(routeArgs(), record({ credentialReference: '   ' }), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'AUTHENTICATION_FAILED' });
  });

  it('an unsupported contract version fails closed (no silent downgrade)', () => {
    const d = decideRouting(routeArgs({ contractVersion: '2.0.0' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'UNSUPPORTED_VERSION' });
  });

  it('an unsupported wire API version fails closed', () => {
    const d = decideRouting(routeArgs({ apiVersion: '9.9.9' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'UNSUPPORTED_VERSION' });
  });

  it('an operation outside the onboarding allow-list is denied', () => {
    const d = decideRouting(routeArgs({ operation: 'compliance.verify' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'UNKNOWN_OPERATION' });
  });

  it('a scope outside the onboarding allow-list is denied', () => {
    const d = decideRouting(routeArgs({ scope: 'compliance.write' }), record(), CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'SCOPE_DENIED' });
  });

  it('a missing onboarding is denied', () => {
    const d = decideRouting(routeArgs(), null, CORE_NOW);
    expect(d).toEqual({ allowed: false, code: 'PRODUCT_DENIED' });
  });

  it('every forbidden onboarding shortcut is unreachable', () => {
    for (const [from, to] of FORBIDDEN_SHORTCUTS) {
      const d = decideRouting(
        routeArgs(),
        record({ state: from, history: ['PROPOSED', from] }),
        CORE_NOW,
      );
      expect(d.allowed).toBe(false);
      // A non-ACTIVE claim is inactive; a forged ACTIVE claim is also inactive.
      expect(d).toEqual({ allowed: false, code: 'INTEGRATION_INACTIVE' });
      void to;
    }
  });
});

// ===========================================================================
// Hub routing negatives — the Convex layer (authz + persistence).
// ===========================================================================

describe('Hub routing gate — Convex layer', () => {
  it('an unauthorized caller cannot route (server-derived scope required)', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'unrelated',
      principalType: 'HUMAN',
      roles: ['viewer'],
      serviceIds: ['someone-else'],
    });
    const router = await seedRouter(t);
    const onboardingId = await registerArma(router);
    await activate(router, onboardingId);

    const outsider = t.withIdentity(identity('unrelated'));
    await expect(outsider.query(internal.productOnboardings.route, routeArgs())).rejects.toThrow(
      /FORBIDDEN|authorized/i,
    );
  });

  it('a suspended onboarding denies at the Convex routing gate', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const onboardingId = await registerArma(router);
    await activate(router, onboardingId);
    await router.mutation(internal.productOnboardings.setLifecycleState, {
      onboardingId,
      state: 'SUSPENDED',
    });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toEqual({ allowed: false, code: 'INTEGRATION_INACTIVE' });
  });

  it('an illegal onboarding transition is rejected', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const onboardingId = await registerArma(router);
    // PROPOSED -> ACTIVE is not a legal transition.
    await expect(
      router.mutation(internal.productOnboardings.advanceState, { onboardingId, to: 'ACTIVE' }),
    ).rejects.toThrow(/Illegal onboarding transition|VALIDATION_FAILED/i);
  });

  it('a forged ACTIVE row (illegal history) denies at the Convex gate', async () => {
    const t = setup();
    const router = await seedRouter(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('productOnboardings', {
        onboardingId: 'onb-forged',
        productId: ARMA_PRODUCT,
        tenantId: TENANT_A,
        environment: ENV,
        hubRoutingIdentity: ROUTING_IDENTITY,
        allowedScopes: [SCOPE],
        allowedOperations: [OP],
        credentialReference: CRED_REF,
        contractVersion: CONTRACT_VERSION,
        state: 'ACTIVE',
        history: ['PROPOSED', 'ACTIVE'], // forged: no legal walk to ACTIVE
        createdAt: CORE_NOW,
        updatedAt: CORE_NOW,
      });
    });
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toEqual({ allowed: false, code: 'INTEGRATION_INACTIVE' });
  });

  it('an expired credential denies at the Convex routing gate', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const onboardingId = await registerArma(router, { credentialExpiresAt: CORE_NOW - 1 });
    await activate(router, onboardingId);
    const decision = await router.query(internal.productOnboardings.route, routeArgs());
    expect(decision).toEqual({ allowed: false, code: 'AUTHENTICATION_FAILED' });
  });
});

// ===========================================================================
// Core-side failures fail safely (the Core owns the decision; the Hub only
// transports). A Core outage or replay never manufactures authoritative state.
// ===========================================================================

describe('Core boundary — fail-safe transport outcomes', () => {
  it('P8: a Core outage fails safely with a bounded code (never a verdict)', async () => {
    const built = makeCorePorts({
      contract: { action: OP, requiredScope: CORE_SCOPE, allowedEnvironments: [ENV] },
      identity: { productId: ARMA_PRODUCT, scope: CORE_SCOPE },
      ports: {
        dispatch: async () => {
          throw new Error('core unavailable');
        },
      },
    });
    const envelope = coreEnvelope({
      productId: ARMA_PRODUCT,
      action: OP,
      environment: ENV,
      tenantId: TENANT_A,
    });
    const res = await runCoreBoundary(envelope, { ports: built.ports, store: built.store });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('INTERNAL');
    // No authoritative state was committed on failure.
    expect(built.store.idem.size).toBe(0);
  });

  it('P9: a replayed request does not duplicate authoritative state', async () => {
    const built = makeCorePorts({
      contract: { action: OP, requiredScope: CORE_SCOPE, allowedEnvironments: [ENV] },
      identity: { productId: ARMA_PRODUCT, scope: CORE_SCOPE },
    });
    const envelope = coreEnvelope({
      productId: ARMA_PRODUCT,
      action: OP,
      environment: ENV,
      tenantId: TENANT_A,
    });
    const first = await runCoreBoundary(envelope, { ports: built.ports, store: built.store });
    expect(first.ok).toBe(true);
    expect(first.outcome?.replayed).toBe(false);
    const idemSize = built.store.idem.size;

    // Same idempotency key + same payload (fresh nonce) -> replay, not a
    // second dispatch. The idempotency hash excludes the nonce, so this is a
    // true replay of the same logical request.
    const retry = coreEnvelope({
      productId: ARMA_PRODUCT,
      action: OP,
      environment: ENV,
      tenantId: TENANT_A,
      nonce: 'nonce-ffffffffffffffff',
    });
    const second = await runCoreBoundary(retry, { ports: built.ports, store: built.store });
    expect(second.ok).toBe(true);
    expect(second.outcome?.replayed).toBe(true);
    expect(built.store.idem.size).toBe(idemSize);
  });

  it('P9b: the same idempotency key with a different payload fails closed', async () => {
    const built = makeCorePorts({
      contract: { action: OP, requiredScope: CORE_SCOPE, allowedEnvironments: [ENV] },
      identity: { productId: ARMA_PRODUCT, scope: CORE_SCOPE },
    });
    const envelope = coreEnvelope({
      productId: ARMA_PRODUCT,
      action: OP,
      environment: ENV,
      tenantId: TENANT_A,
    });
    await runCoreBoundary(envelope, { ports: built.ports, store: built.store });
    const tampered = coreEnvelope({
      productId: ARMA_PRODUCT,
      action: OP,
      environment: ENV,
      tenantId: TENANT_A,
      nonce: 'nonce-ffffffffffffffff',
      payload: { asOf: '2026-09-16', resourceId: 'RES-2' },
    });
    const res = await runCoreBoundary(tampered, { ports: built.ports, store: built.store });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

// ===========================================================================
// P10 / P11 — structural guards: no direct Core DB access; no manufactured
// compliance state from a transport outcome.
// ===========================================================================

describe('P10/P11 — structural transport guards', () => {
  it('P10: the Hub transport client contains no direct Core Convex database path', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const clientPath = fileURLToPath(
      new URL('../../packages/compliance-core-client/src/index.ts', import.meta.url),
    );
    const source = readFileSync(clientPath, 'utf8');
    // The guard itself is allowed to name the forbidden patterns; strip the
    // guard's doc comment + definition before asserting the rest is clean.
    const withoutGuard = source.replace(
      /\/\*\*\n \* Assert a source text contains NO direct[\s\S]*?\n\}\n/,
      '',
    );
    expect(() => assertNoDirectCoreDatabaseAccess(withoutGuard)).not.toThrow();
  });

  it('P11: a transport outcome cannot manufacture COMPLIANT/CERTIFIED state', () => {
    // The client exposes no such state; the transport-only guard rejects any
    // attempt to assert an authoritative Core policy state.
    for (const state of ['RECEIVED', 'APPLIED', 'VERIFIED']) {
      expect(() => assertTransportDoesNotManufactureCoreState(state)).toThrow();
    }
    // Non-authoritative transport states are permitted.
    for (const state of ['PENDING', 'DEGRADED', 'FAILED']) {
      expect(() => assertTransportDoesNotManufactureCoreState(state)).not.toThrow();
    }
  });
});
