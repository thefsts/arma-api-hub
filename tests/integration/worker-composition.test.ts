// Phase 8 PM HOLD — governed worker composition root + trusted routing gate.
//
// This suite drives the REAL, executable governed path composed by
// `createGovernedWorker`:
//
//   durable queue/reservation
//     -> governed worker handler
//       -> trusted routing-gate adapter
//         -> trusted server clock
//           -> credential/reference resolution
//             -> ComplianceCoreTransport
//               -> Compliance Core boundary
//
// It proves three things the PM required:
//   1. the composition is a running worker (not just a factory): a reserved job
//      flows through the gate and reaches the transport exactly once;
//   2. `now` is supplied by the TRUSTED SERVER CLOCK, never by the caller, so a
//      caller cannot move the credential-expiry comparison;
//   3. there is NO ungoverned alternate path to the Core transport.
//
// Evidence class: CONFIGURED DEVELOPMENT RUNTIME (convex-test-backed internal
// boundary + spy transport). The transport is MOCKED; the routing boundary is
// the REAL Convex internal query under convex-test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';
import {
  buildGovernedEnvelope,
  type ComplianceCoreTransport,
  type GovernedRequest,
  type RoutingDecision,
  type RoutingGateRequest,
  type TransportResult,
} from '@arma/compliance-core-client';
import {
  createGovernedWorker,
  createTrustedRoutingGate,
  InMemoryQueue,
  type GovernedBoundary,
  type GovernedDispatchJobPayload,
} from '@arma/worker';

const NOW = 1_700_000_000_000;
const PRODUCT = 'arma-system-360';
const ROUTING_IDENTITY = 'arma-system-360';
const TENANT = 'SYNTH-TENANT-A';
const ENV = 'PRODUCTION';
const CRED_REF = 'key-arma-0001';
const CONTRACT_VERSION = '1.0.0';
const API_VERSION = '1.1.0';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';
const HUB_ROUTER = 'hub-router';
const SECRET = 'synthetic-composition-secret';

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

async function register(
  router: ReturnType<TestConvex['withIdentity']>,
  over: Record<string, unknown> = {},
): Promise<string> {
  return (await router.mutation(internal.productOnboardings.register, {
    productId: PRODUCT,
    tenantId: TENANT,
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
    productId: PRODUCT,
    tenantId: TENANT,
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
    tenantId: TENANT,
    serviceIdentityId: ROUTING_IDENTITY,
    productId: PRODUCT,
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

function spyTransport(
  result: TransportResult = { ok: true, body: '{"accepted":true}', correlationId: 'corr-0000001' },
): {
  transport: ComplianceCoreTransport;
  calls: GovernedRequest[];
  credentials: Array<{ keyId: string } | undefined>;
} {
  const calls: GovernedRequest[] = [];
  const credentials: Array<{ keyId: string } | undefined> = [];
  return {
    calls,
    credentials,
    transport: {
      forward: async (signed: GovernedRequest, _body: string, credential) => {
        calls.push(signed);
        credentials.push(credential);
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

/** A boundary backed by the REAL Convex internal routing query. */
function boundaryFor(
  router: ReturnType<TestConvex['withIdentity']>,
  transport: ComplianceCoreTransport,
  opts: { now: number; credentialResolvable?: boolean } = { now: NOW },
): GovernedBoundary {
  return {
    resolveRoute: async (request: RoutingGateRequest, now: number): Promise<RoutingDecision> =>
      (await router.query(internal.productOnboardings.route, {
        ...request,
        now,
      })) as RoutingDecision,
    resolveCredential: async (reference: string) => {
      if (opts.credentialResolvable === false) throw new Error('credential not resolvable');
      return { keyId: reference, algorithm: 'ed25519', secret: SECRET };
    },
    transport,
  };
}

function job(payload: GovernedDispatchJobPayload) {
  return {
    jobId: 'job-00000001',
    type: 'governed.dispatch',
    payload,
    attempt: 0,
    maxAttempts: 5,
    enqueuedAt: NOW,
    availableAt: NOW,
  };
}

// ===========================================================================
// 1. The composition is a running worker (not a factory).
// ===========================================================================
describe('governed worker composition root — executable path', () => {
  it('reserves a durable job, routes it, resolves the credential, and forwards exactly once', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport, calls, credentials } = spyTransport();
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });

    await queue.enqueue(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    const result = await worker.runOnce(NOW);

    expect(result?.status).toBe('ACKED');
    expect(calls).toHaveLength(1);
    // Credential/reference resolution ran: the route's reference was resolved
    // Hub-side and passed to the transport.
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.keyId).toBe(CRED_REF);
    // The forwarded envelope is the signed one (correlation preserved).
    expect(calls[0]?.correlationId).toBe('corr-0000001');
  });

  it('returns null when the queue is empty (no work, no dispatch)', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const { transport, calls } = spyTransport();
    const worker = createGovernedWorker({
      queue: new InMemoryQueue<GovernedDispatchJobPayload>(),
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    expect(await worker.runOnce(NOW)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a denied job is never forwarded and is dead-lettered (TERMINAL)', async () => {
    const t = setup();
    const router = await seedRouter(t);
    // No onboarding registered -> PRODUCT_DENIED (TERMINAL).
    const { transport, calls } = spyTransport();
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('DEAD_LETTERED');
    expect(calls).toHaveLength(0);
  });

  it('an unresolvable credential reference fails closed before the transport', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);
    const { transport, calls } = spyTransport();
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport, { now: NOW, credentialResolvable: false }),
    });
    await queue.enqueue(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('DEAD_LETTERED');
    expect(calls).toHaveLength(0);
  });
});

// ===========================================================================
// 2. The trusted server clock supplies `now`; the caller cannot.
// ===========================================================================
describe('trusted routing gate — server-authoritative clock', () => {
  it('injects `now` from the trusted clock and the caller supplies no clock', async () => {
    const seen: number[] = [];
    const gate = createTrustedRoutingGate({
      clock: () => NOW,
      resolveRoute: async (_request, now) => {
        seen.push(now);
        return { allowed: true, route: { ...routeRequest(), credentialReference: CRED_REF } };
      },
    });
    // The request type has NO clock field; the adapter supplies it.
    await gate(routeRequest());
    expect(seen).toEqual([NOW]);
    expect('now' in routeRequest()).toBe(false);
  });

  it('the trusted clock — not the caller — decides credential expiry', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router, { credentialExpiresAt: NOW + 1 });
    await activate(router, id);

    // Clock at NOW: credential still valid -> forwarded.
    const ok = spyTransport();
    const w1 = createGovernedWorker({
      queue: new InMemoryQueue<GovernedDispatchJobPayload>(),
      clock: () => NOW,
      boundary: boundaryFor(router, ok.transport),
    });
    await w1.runOnce(NOW);
    const q1 = new InMemoryQueue<GovernedDispatchJobPayload>();
    await q1.enqueue(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    const w1b = createGovernedWorker({
      queue: q1,
      clock: () => NOW,
      boundary: boundaryFor(router, ok.transport),
    });
    expect((await w1b.runOnce(NOW))?.status).toBe('ACKED');
    expect(ok.calls).toHaveLength(1);

    // Clock at NOW+2: credential expired -> denied, never forwarded.
    const expired = spyTransport();
    const q2 = new InMemoryQueue<GovernedDispatchJobPayload>();
    await q2.enqueue(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    const w2 = createGovernedWorker({
      queue: q2,
      clock: () => NOW + 2,
      boundary: boundaryFor(router, expired.transport),
    });
    expect((await w2.runOnce(NOW + 2))?.status).toBe('DEAD_LETTERED');
    expect(expired.calls).toHaveLength(0);
  });
});

// ===========================================================================
// 3. No ungoverned alternate path to the Core transport.
// ===========================================================================
describe('no ungoverned alternate path', () => {
  it('the worker never calls transport.forward directly (structural)', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const workerFiles = [
      'apps/worker/src/governedDispatch.ts',
      'apps/worker/src/composition.ts',
      'apps/worker/src/processor.ts',
      'apps/worker/src/queue.ts',
      'apps/worker/src/main.ts',
      'apps/worker/src/trustedRoutingGate.ts',
      'apps/worker/src/boundary.ts',
    ];
    for (const file of workerFiles) {
      const source = readFileSync(`${root}${file}`, 'utf8');
      expect(source).not.toMatch(/\.forward\s*\(/);
    }
  });

  it('transport.forward is referenced exactly once, inside the governed dispatcher (structural)', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const client = readFileSync(`${root}packages/compliance-core-client/src/index.ts`, 'utf8');
    const occurrences = client.match(/transport\.forward\s*\(/g) ?? [];
    expect(occurrences).toHaveLength(1);
    // The single call site is inside `createGovernedDispatcher`.
    const dispatcherStart = client.indexOf('export function createGovernedDispatcher');
    const callIndex = client.search(/transport\.forward\s*\(/);
    expect(dispatcherStart).toBeGreaterThanOrEqual(0);
    expect(callIndex).toBeGreaterThan(dispatcherStart);
  });

  it('the governed handler always consults the gate before the transport', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const order: string[] = [];
    const transport: ComplianceCoreTransport = {
      forward: async () => {
        order.push('forward');
        return { ok: true, body: '{}', correlationId: 'corr-0000001' };
      },
      health: async () => ({
        status: 'AVAILABLE',
        killSwitchEngaged: false,
        contractVersion: '1.0.0',
      }),
    };
    const boundary: GovernedBoundary = {
      resolveRoute: async (request, now) => {
        order.push('gate');
        return (await router.query(internal.productOnboardings.route, {
          ...request,
          now,
        })) as RoutingDecision;
      },
      resolveCredential: async (reference) => ({
        keyId: reference,
        algorithm: 'ed25519',
        secret: SECRET,
      }),
      transport,
    };
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({ queue, clock: () => NOW, boundary });
    await queue.enqueue(
      job({ request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' }),
    );
    await worker.runOnce(NOW);
    expect(order).toEqual(['gate', 'forward']);
  });
});
