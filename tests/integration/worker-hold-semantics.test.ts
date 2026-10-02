// Phase 8 PM HOLD — Section 8: retry / hold / dead-letter semantics.
//
// A routing denial is a DECISION, not a transient failure, and it is NEVER
// blanket-classified as terminal. This suite proves the full disposition map
// end-to-end through the REAL governed worker:
//
//   * TERMINAL        -> DEAD_LETTERED (permanently invalid authority);
//   * HELD            -> HELD (SUSPENDED / not-yet-ACTIVE / gate failure):
//                        preserved, no retry budget consumed, resumable;
//   * AMBIGUOUS       -> HELD_FOR_REVIEW (quarantined for reconciliation);
//   * CLEAN_RETRYABLE -> RETRIED with backoff (transport failed pre-side-effect).
//
// Evidence class: CONFIGURED DEVELOPMENT RUNTIME (convex-test-backed internal
// boundary + spy transport). The transport is MOCKED; the routing boundary is
// the REAL Convex internal query under convex-test.

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
  InMemoryQueue,
  processJob,
  type GovernedBoundary,
  type GovernedDispatchJobPayload,
  type Job,
} from '@arma/worker';
import { decideRouting, type ProductOnboardingRecord } from '../../convex/lib/productRouting.js';

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
const SECRET = 'synthetic-hold-secret';

const LEGAL_ACTIVE_HISTORY = [
  'PROPOSED',
  'REVIEWED',
  'APPROVED',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVE',
] as const;

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

function spyTransport(result: TransportResult): {
  transport: ComplianceCoreTransport;
  calls: GovernedRequest[];
} {
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

function boundaryFor(
  router: ReturnType<TestConvex['withIdentity']>,
  transport: ComplianceCoreTransport,
): GovernedBoundary {
  return {
    resolveRoute: async (request: RoutingGateRequest, now: number): Promise<RoutingDecision> =>
      (await router.query(internal.productOnboardings.route, {
        ...request,
        now,
      })) as RoutingDecision,
    resolveCredential: async (reference: string) => ({
      keyId: reference,
      algorithm: 'ed25519',
      secret: SECRET,
    }),
    transport,
  };
}

function job(over: Partial<Job<GovernedDispatchJobPayload>> = {}): Job<GovernedDispatchJobPayload> {
  return {
    jobId: 'job-00000001',
    type: 'governed.dispatch',
    payload: { request: routeRequest(), signed: signedEnvelope(), governedBody: '{}' },
    attempt: 0,
    maxAttempts: 5,
    enqueuedAt: NOW,
    availableAt: NOW,
    ...over,
  };
}

function pureRecord(over: Partial<ProductOnboardingRecord> = {}): ProductOnboardingRecord {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    allowedScopes: [SCOPE],
    allowedOperations: [OP],
    credentialReference: CRED_REF,
    contractVersion: CONTRACT_VERSION,
    state: 'ACTIVE',
    history: [...LEGAL_ACTIVE_HISTORY],
    ...over,
  };
}

// ===========================================================================
// 8.1 — the pure disposition map (every denial code -> disposition).
// ===========================================================================
describe('8.1 — routing denial disposition map', () => {
  const req = routeRequest();
  const cases: Array<[string, ReturnType<typeof decideRouting>]> = [
    ['PRODUCT_DENIED (no onboarding)', decideRouting(req, null, NOW)],
    [
      'PRODUCT_DENIED (impersonation)',
      decideRouting({ ...req, productId: 'other-product' }, pureRecord(), NOW),
    ],
    ['TENANT_DENIED', decideRouting({ ...req, tenantId: 'SYNTH-TENANT-Z' }, pureRecord(), NOW)],
    [
      'ENVIRONMENT_DENIED',
      decideRouting({ ...req, environment: 'DEVELOPMENT' }, pureRecord(), NOW),
    ],
    [
      'INTEGRATION_INACTIVE (REVOKED)',
      decideRouting(
        req,
        pureRecord({ state: 'REVOKED', history: [...LEGAL_ACTIVE_HISTORY, 'REVOKED'] }),
        NOW,
      ),
    ],
    [
      'INTEGRATION_INACTIVE (REJECTED)',
      decideRouting(req, pureRecord({ state: 'REJECTED', history: ['PROPOSED', 'REJECTED'] }), NOW),
    ],
    [
      'INTEGRATION_INACTIVE (forged history)',
      decideRouting(req, pureRecord({ state: 'ACTIVE', history: ['PROPOSED', 'ACTIVE'] }), NOW),
    ],
    [
      'AUTHENTICATION_FAILED (blank ref)',
      decideRouting(req, pureRecord({ credentialReference: '' }), NOW),
    ],
    [
      'AUTHENTICATION_FAILED (expired)',
      decideRouting(req, pureRecord({ credentialExpiresAt: NOW - 1 }), NOW),
    ],
    [
      'UNSUPPORTED_VERSION (contract)',
      decideRouting({ ...req, contractVersion: '2.0.0' }, pureRecord(), NOW),
    ],
    [
      'UNSUPPORTED_VERSION (api)',
      decideRouting({ ...req, apiVersion: '9.9.9' }, pureRecord(), NOW),
    ],
    ['UNKNOWN_OPERATION', decideRouting({ ...req, operation: 'nope' }, pureRecord(), NOW)],
    ['SCOPE_DENIED', decideRouting({ ...req, scope: 'nope' }, pureRecord(), NOW)],
    ['VALIDATION_FAILED (non-finite now)', decideRouting(req, pureRecord(), Number.NaN)],
  ];

  for (const [label, decision] of cases) {
    it(`${label} -> TERMINAL`, () => {
      expect(decision).toMatchObject({ allowed: false, disposition: 'TERMINAL' });
    });
  }

  it('INTEGRATION_INACTIVE for a SUSPENDED onboarding -> HELD (resumable)', () => {
    const decision = decideRouting(
      req,
      pureRecord({ state: 'SUSPENDED', history: [...LEGAL_ACTIVE_HISTORY, 'SUSPENDED'] }),
      NOW,
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: 'INTEGRATION_INACTIVE',
      disposition: 'HELD',
    });
  });

  it('INTEGRATION_INACTIVE for a not-yet-ACTIVE onboarding -> HELD (may still activate)', () => {
    const decision = decideRouting(
      req,
      pureRecord({ state: 'PROPOSED', history: ['PROPOSED'] }),
      NOW,
    );
    expect(decision).toMatchObject({
      allowed: false,
      code: 'INTEGRATION_INACTIVE',
      disposition: 'HELD',
    });
  });
});

// ===========================================================================
// 8.2 — HELD is preserved, consumes no retry budget, and resumes.
// ===========================================================================
describe('8.2 — HELD work is preserved, budget-free, and resumable', () => {
  it('a HELD outcome holds the job (no dead-letter, no reconciliation)', async () => {
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const j = job();
    await queue.enqueue(j);
    const reserved = await queue.reserve(NOW);
    const result = await processJob(
      queue,
      reserved!,
      async () => ({ ok: false, failureClass: 'HELD', reason: 'SUSPENDED' }),
      NOW,
    );
    expect(result.status).toBe('HELD');
    expect(queue.heldCount()).toBe(1);
    expect(queue.deadLetterCount()).toBe(0);
    expect(queue.reconciliationCount()).toBe(0);
  });

  it('release resumes a held job WITHOUT consuming its retry budget', async () => {
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    await queue.enqueue(job());
    const reserved = await queue.reserve(NOW);
    await processJob(queue, reserved!, async () => ({ ok: false, failureClass: 'HELD' }), NOW);
    const released = await queue.release(NOW);
    expect(released).toBe(1);
    const again = await queue.reserve(NOW);
    expect(again).not.toBeNull();
    expect(again?.attempt).toBe(0); // retry budget untouched by the hold
  });

  it('a SUSPENDED onboarding holds the job end-to-end through the governed worker', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);
    await router.mutation(internal.productOnboardings.setLifecycleState, {
      onboardingId: id,
      state: 'SUSPENDED',
    });

    const { transport, calls } = spyTransport({
      ok: true,
      body: '{}',
      correlationId: 'corr-0000001',
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('HELD');
    expect(queue.heldCount()).toBe(1);
    expect(queue.deadLetterCount()).toBe(0);
    expect(calls.length).toBe(0); // never forwarded while suspended
  });

  it('a released HELD job completes once the onboarding is ACTIVE again', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);
    await router.mutation(internal.productOnboardings.setLifecycleState, {
      onboardingId: id,
      state: 'SUSPENDED',
    });

    const { transport, calls } = spyTransport({
      ok: true,
      body: '{}',
      correlationId: 'corr-0000001',
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    expect((await worker.runOnce(NOW))?.status).toBe('HELD');
    // Reactivate (SUSPENDED -> ACTIVE is a legal transition), then release.
    await router.mutation(internal.productOnboardings.advanceState, {
      onboardingId: id,
      to: 'ACTIVE',
    });
    expect(await worker.releaseHeld(NOW)).toBe(1);
    expect((await worker.runOnce(NOW))?.status).toBe('ACKED');
    expect(calls.length).toBe(1);
  });

  it('a gate failure holds the work (ROUTING_GATE_ERROR -> HELD), never dead-letters', async () => {
    const { transport, calls } = spyTransport({
      ok: true,
      body: '{}',
      correlationId: 'corr-0000001',
    });
    const boundary: GovernedBoundary = {
      resolveRoute: async () => {
        throw new Error('routing boundary temporarily unavailable');
      },
      resolveCredential: async (reference: string) => ({
        keyId: reference,
        algorithm: 'ed25519',
        secret: SECRET,
      }),
      transport,
    };
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({ queue, clock: () => NOW, boundary });
    await queue.enqueue(job());
    expect((await worker.runOnce(NOW))?.status).toBe('HELD');
    expect(queue.heldCount()).toBe(1);
    expect(queue.deadLetterCount()).toBe(0);
    expect(calls.length).toBe(0);
  });
});

// ===========================================================================
// 8.3 — AMBIGUOUS -> reconciliation; TERMINAL -> dead-letter; CLEAN -> retry.
// ===========================================================================
describe('8.3 — ambiguous / terminal / clean-retryable classification', () => {
  it('an AMBIGUOUS transport outcome quarantines the job (never dead-lettered)', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport } = spyTransport({
      ok: false,
      error: { error: 'TIMEOUT', message: 'timed out after send' } as never,
      retryable: true,
      ambiguous: true,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('HELD_FOR_REVIEW');
    expect(queue.reconciliationCount()).toBe(1);
    expect(queue.deadLetterCount()).toBe(0);
    expect(queue.heldCount()).toBe(0);
  });

  it('a REVOKED onboarding dead-letters the job (TERMINAL)', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);
    await router.mutation(internal.productOnboardings.setLifecycleState, {
      onboardingId: id,
      state: 'REVOKED',
    });

    const { transport, calls } = spyTransport({
      ok: true,
      body: '{}',
      correlationId: 'corr-0000001',
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('DEAD_LETTERED');
    expect(queue.deadLetterCount()).toBe(1);
    expect(queue.heldCount()).toBe(0);
    expect(calls.length).toBe(0);
  });

  it('a CLEAN_RETRYABLE transport failure retries with backoff', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport } = spyTransport({
      ok: false,
      error: { error: 'CONNECTION_REFUSED', message: 'connection refused' } as never,
      retryable: true,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('RETRIED');
    expect(result?.nextAvailableAt).toBe(NOW + 1_000); // first backoff step
    expect(queue.deadLetterCount()).toBe(0);
  });

  it('a TERMINAL transport failure dead-letters the job', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport } = spyTransport({
      ok: false,
      error: { error: 'REJECTED', message: 'core rejected' } as never,
      retryable: false,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('DEAD_LETTERED');
    expect(queue.deadLetterCount()).toBe(1);
  });
});
