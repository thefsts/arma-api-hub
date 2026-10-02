// Phase 8 integration review — governed dispatch boundary.
//
// This suite proves that a governed request CANNOT bypass onboarding and
// authorization checks through the ACTUAL dispatch path. It composes the REAL
// server-side routing gate (the Convex `productOnboardings.route` internal
// query, which loads the onboarding from durable records and enforces the
// caller's server-derived service scope) with the transport boundary and a spy
// transport.
//
// A passing pure routing-helper test is NOT sufficient: these tests drive the
// dispatcher and the worker job handler and assert that the transport is NEVER
// touched on any denial, and that a transport outcome is never turned into a
// compliance verdict.
//
// All tenants/identities are synthetic. No production data is used.

import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';
import {
  buildGovernedEnvelope,
  createGovernedDispatcher,
  type ComplianceCoreTransport,
  type GovernedRequest,
  type RoutingDecision,
  type RoutingGateRequest,
  type TransportResult,
} from '@arma/compliance-core-client';
import { createGovernedJobHandler, type GovernedDispatchJobPayload } from '@arma/worker';

const NOW = 1_700_000_000_000;
const ARMA_PRODUCT = 'arma-system-360';
const ROUTING_IDENTITY = 'arma-system-360';
const TENANT_A = 'SYNTH-TENANT-A';
const TENANT_B = 'SYNTH-TENANT-B';
const ENV = 'PRODUCTION';
const CRED_REF = 'key-arma-0001';
const CONTRACT_VERSION = '1.0.0';
const API_VERSION = '1.1.0';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';
const HUB_ROUTER = 'hub-router';
const SECRET = 'synthetic-dispatch-secret'; // never a production value

async function seedRouter(t: TestConvex) {
  await seedAuthorization(t, {
    principalId: HUB_ROUTER,
    principalType: 'HUMAN',
    roles: ['admin'],
    serviceIds: [ROUTING_IDENTITY],
    environments: [ENV],
  });
  return t.withIdentity(identity(HUB_ROUTER));
}

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

async function activate(
  router: ReturnType<TestConvex['withIdentity']>,
  onboardingId: string,
): Promise<void> {
  for (const to of ['REVIEWED', 'APPROVED', 'PROVISIONED', 'VERIFIED', 'ACTIVE']) {
    await router.mutation(internal.productOnboardings.advanceState, { onboardingId, to });
  }
}

function routeRequest(over: Partial<RoutingGateRequest> = {}): RoutingGateRequest {
  return {
    productId: ARMA_PRODUCT,
    tenantId: TENANT_A,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
    ...over,
  };
}

function signedEnvelope(
  over: Partial<Parameters<typeof buildGovernedEnvelope>[0]> = {},
): GovernedRequest {
  return buildGovernedEnvelope({
    apiVersion: API_VERSION,
    tenantId: TENANT_A,
    serviceIdentityId: ROUTING_IDENTITY,
    productId: ARMA_PRODUCT,
    environment: ENV,
    action: OP,
    resourceType: 'complianceRead',
    resourceId: 'RES-1',
    timestamp: NOW,
    nonce: 'nonce-0123456789abcdef',
    requestId: 'req-00000001',
    correlationId: 'corr-0000001',
    idempotencyKey: 'idem-0000001',
    payload: { asOf: '2026-09-16' },
    secret: SECRET,
    ...over,
  });
}

/** A spy transport that records every forward call. */
function spyTransport(
  result: TransportResult = { ok: true, body: '{"accepted":true}', correlationId: 'corr-0000001' },
): { transport: ComplianceCoreTransport; calls: GovernedRequest[] } {
  const calls: GovernedRequest[] = [];
  return {
    calls,
    transport: {
      forward: async (signed: GovernedRequest): Promise<TransportResult> => {
        calls.push(signed);
        return result;
      },
      health: async () => ({
        status: 'AVAILABLE',
        killSwitchEngaged: false,
        contractVersion: '1.0.0',
      }),
    },
  };
}

/** The REAL server-side gate: the Convex `route` internal query. */
function convexGate(router: ReturnType<TestConvex['withIdentity']>) {
  return async (request: RoutingGateRequest): Promise<RoutingDecision> => {
    const decision = (await router.query(internal.productOnboardings.route, {
      ...request,
      now: NOW,
    })) as RoutingDecision;
    return decision;
  };
}

describe('governed dispatch — authorized request reaches the transport', () => {
  it('an ACTIVE, authorized request is forwarded exactly once', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const onboardingId = await registerArma(router);
    await activate(router, onboardingId);

    const { transport, calls } = spyTransport();
    const dispatcher = createGovernedDispatcher({ gate: convexGate(router), transport });

    const result = await dispatcher.dispatch({
      request: routeRequest(),
      signed: signedEnvelope(),
      governedBody: '{"asOf":"2026-09-16"}',
    });

    expect(result.dispatched).toBe(true);
    expect(calls).toHaveLength(1);
    if (!result.dispatched) throw new Error('unreachable');
    expect(result.transport.ok).toBe(true);
    expect(result.correlationId).toBe('corr-0000001');
    // The result carries transport facts only — never a compliance verdict.
    expect(Object.keys(result).sort()).toEqual(['correlationId', 'dispatched', 'transport']);
  });
});

describe('governed dispatch — denials never reach the transport', () => {
  async function dispatchWith(
    over: {
      request?: Partial<RoutingGateRequest>;
      signed?: Partial<Parameters<typeof buildGovernedEnvelope>[0]>;
    },
    setupOnboarding?: (router: ReturnType<TestConvex['withIdentity']>) => Promise<void>,
  ) {
    const t = setup();
    const router = await seedRouter(t);
    if (setupOnboarding) {
      await setupOnboarding(router);
    } else {
      const id = await registerArma(router);
      await activate(router, id);
    }
    const { transport, calls } = spyTransport();
    const dispatcher = createGovernedDispatcher({ gate: convexGate(router), transport });
    const result = await dispatcher.dispatch({
      request: routeRequest(over.request),
      signed: signedEnvelope(over.signed),
      governedBody: '{}',
    });
    return { result, calls };
  }

  it('tenant mismatch is denied before dispatch', async () => {
    const { result, calls } = await dispatchWith({ request: { tenantId: TENANT_B } });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('product mismatch is denied before dispatch', async () => {
    const { result, calls } = await dispatchWith({ request: { productId: 'other-product' } });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('environment mismatch is denied before dispatch', async () => {
    const { result, calls } = await dispatchWith({ request: { environment: 'DEVELOPMENT' } });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a SUSPENDED onboarding is denied before dispatch', async () => {
    const { result, calls } = await dispatchWith({}, async (router) => {
      const id = await registerArma(router);
      await activate(router, id);
      await router.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state: 'SUSPENDED',
      });
    });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a REVOKED onboarding is denied before dispatch', async () => {
    const { result, calls } = await dispatchWith({}, async (router) => {
      const id = await registerArma(router);
      await activate(router, id);
      await router.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state: 'REVOKED',
      });
    });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('an expired credential is denied before dispatch', async () => {
    const { result, calls } = await dispatchWith({}, async (router) => {
      const id = await registerArma(router, { credentialExpiresAt: NOW - 1 });
      await activate(router, id);
    });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a missing onboarding is denied before dispatch', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const { transport, calls } = spyTransport();
    const dispatcher = createGovernedDispatcher({ gate: convexGate(router), transport });
    const result = await dispatcher.dispatch({
      request: routeRequest(),
      signed: signedEnvelope(),
      governedBody: '{}',
    });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a forged ACTIVE row is denied before dispatch', async () => {
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
        history: ['PROPOSED', 'ACTIVE'],
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const { transport, calls } = spyTransport();
    const dispatcher = createGovernedDispatcher({ gate: convexGate(router), transport });
    const result = await dispatcher.dispatch({
      request: routeRequest(),
      signed: signedEnvelope(),
      governedBody: '{}',
    });
    expect(result.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('an unauthorized caller is denied before dispatch (gate fails closed)', async () => {
    const t = setup();
    await seedAuthorization(t, {
      principalId: 'unrelated',
      principalType: 'HUMAN',
      roles: ['viewer'],
      serviceIds: ['someone-else'],
    });
    const router = await seedRouter(t);
    const id = await registerArma(router);
    await activate(router, id);

    // The gate is driven by an UNRELATED identity — the Convex query throws.
    const outsider = t.withIdentity(identity('unrelated'));
    const gate = async (request: RoutingGateRequest): Promise<RoutingDecision> =>
      (await outsider.query(internal.productOnboardings.route, {
        ...request,
        now: NOW,
      })) as RoutingDecision;
    const { transport, calls } = spyTransport();
    const dispatcher = createGovernedDispatcher({ gate, transport });
    const result = await dispatcher.dispatch({
      request: routeRequest(),
      signed: signedEnvelope(),
      governedBody: '{}',
    });
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTING_GATE_ERROR');
    expect(calls).toHaveLength(0);
  });
});

describe('governed dispatch — route/envelope mismatch fails closed', () => {
  it('a gate ALLOW for tenant A never forwards an envelope for tenant B', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await registerArma(router);
    await activate(router, id);

    const { transport, calls } = spyTransport();
    // A gate that always allows (simulating a compromised/misconfigured gate).
    const permissiveGate = async (): Promise<RoutingDecision> => ({
      allowed: true,
      route: {
        productId: ARMA_PRODUCT,
        tenantId: TENANT_A,
        environment: ENV,
        hubRoutingIdentity: ROUTING_IDENTITY,
        operation: OP,
        scope: SCOPE,
        contractVersion: CONTRACT_VERSION,
        apiVersion: API_VERSION,
        credentialReference: CRED_REF,
      },
    });
    const dispatcher = createGovernedDispatcher({ gate: permissiveGate, transport });
    const result = await dispatcher.dispatch({
      request: routeRequest(),
      signed: signedEnvelope({ tenantId: TENANT_B }),
      governedBody: '{}',
    });
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(calls).toHaveLength(0);
  });
});

describe('governed dispatch — worker job handler enforces the gate', () => {
  function job(payload: GovernedDispatchJobPayload) {
    return {
      jobId: 'job-1',
      type: 'governed.dispatch',
      payload,
      attempt: 0,
      maxAttempts: 5,
      enqueuedAt: NOW,
      availableAt: NOW,
    };
  }

  it('a denied job is TERMINAL and never forwarded', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const { transport, calls } = spyTransport();
    const handler = createGovernedJobHandler({ gate: convexGate(router), transport });
    const outcome = await handler(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failureClass).toBe('TERMINAL');
    expect(outcome.reason).toMatch(/^ROUTING_DENIED:/);
    expect(calls).toHaveLength(0);
  });

  it('an allowed job with a clean retryable transport failure is retried', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await registerArma(router);
    await activate(router, id);
    const { transport } = spyTransport({
      ok: false,
      retryable: true,
      error: {
        schemaVersion: '1.0.0',
        error: 'UPSTREAM_TIMEOUT',
        errorClass: 'TRANSPORT',
        retryable: true,
      },
    });
    const handler = createGovernedJobHandler({ gate: convexGate(router), transport });
    const outcome = await handler(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failureClass).toBe('CLEAN_RETRYABLE');
    expect(outcome.reason).toBe('TRANSPORT_FAILED:UPSTREAM_TIMEOUT');
  });

  it('an allowed job with a terminal transport failure is not retried', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await registerArma(router);
    await activate(router, id);
    const { transport } = spyTransport({
      ok: false,
      retryable: false,
      error: {
        schemaVersion: '1.0.0',
        error: 'POLICY_DENIED',
        errorClass: 'POLICY',
        retryable: false,
      },
    });
    const handler = createGovernedJobHandler({ gate: convexGate(router), transport });
    const outcome = await handler(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.failureClass).toBe('TERMINAL');
  });
});
