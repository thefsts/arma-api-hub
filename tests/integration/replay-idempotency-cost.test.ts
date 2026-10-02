// Phase 8 PM HOLD — Section 9: replay / idempotency / correlation / cost proof.
//
// Proves that the governed path preserves the request's identity and
// correlation keys END-TO-END, and that cost is never double-counted:
//
//   * the forwarded envelope carries the SAME requestId / correlationId /
//     idempotencyKey / service identity / product / tenant / environment the
//     caller supplied (the Hub never rewrites identity on the wire);
//   * a DENIAL never reaches the transport, so no charge is emitted;
//   * a SAFE RETRY re-forwards the SAME idempotencyKey, so the downstream
//     dedup sees one charge, never two;
//   * a REPLAY of the same request is deduplicated by idempotencyKey;
//   * an AMBIGUOUS outcome is quarantined, never blindly re-charged;
//   * a cost event carrying the same correlation/idempotency/request keys
//     validates against the shared cost-event contract (linkable, never a
//     second authoritative charge).
//
// Evidence class: CONFIGURED DEVELOPMENT RUNTIME (convex-test-backed internal
// boundary + spy transport + in-process cost ledger). The transport and the
// downstream cost ledger are MOCKED; the routing boundary is the REAL Convex
// internal query under convex-test.

import { describe, expect, it } from 'vitest';

import { internal } from '../../convex/_generated/api.js';
import { identity, seedAuthorization, setup, type TestConvex } from '../convex/helpers.js';
import { validate, apiCostRecordedSchema } from '@arma/contracts';
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
const SECRET = 'synthetic-replay-secret';
const CORRELATION_ID = 'corr-0000001';
const IDEMPOTENCY_KEY = 'idem-0000001';
const REQUEST_ID = 'req-00000001';

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
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    payload: { asOf: '2026-09-16' },
    secret: SECRET,
    ...over,
  });
}

/**
 * A transport backed by an in-process COST LEDGER that simulates downstream
 * idempotent charging: the first forward for an idempotency key is charged; any
 * later forward with the SAME key is deduplicated (no second charge).
 */
function costLedgerTransport(result: TransportResult): {
  transport: ComplianceCoreTransport;
  calls: GovernedRequest[];
  charged: Map<string, number>;
  uniqueCharges: () => number;
} {
  const calls: GovernedRequest[] = [];
  const charged = new Map<string, number>();
  return {
    calls,
    charged,
    uniqueCharges: () => charged.size,
    transport: {
      forward: async (signed: GovernedRequest): Promise<TransportResult> => {
        calls.push(signed);
        if (!charged.has(signed.idempotencyKey)) charged.set(signed.idempotencyKey, 1);
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

function job(over: Partial<GovernedDispatchJobPayload> = {}, jobId = 'job-00000001') {
  return {
    jobId,
    type: 'governed.dispatch',
    payload: { request: routeRequest(), signed: signedEnvelope(), governedBody: '{}', ...over },
    attempt: 0,
    maxAttempts: 5,
    enqueuedAt: NOW,
    availableAt: NOW,
  };
}

// ===========================================================================
// 9.1 — identity / correlation / idempotency preservation on the wire.
// ===========================================================================
describe('9.1 — the forwarded envelope preserves identity and correlation keys', () => {
  it('forwards the SAME requestId/correlationId/idempotencyKey/identity/product/tenant/env', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport, calls } = costLedgerTransport({
      ok: true,
      body: '{}',
      correlationId: CORRELATION_ID,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    const sent = signedEnvelope();
    await queue.enqueue(job({ signed: sent }));

    expect((await worker.runOnce(NOW))?.status).toBe('ACKED');
    expect(calls.length).toBe(1);
    const forwarded = calls[0]!;
    expect(forwarded.requestId).toBe(REQUEST_ID);
    expect(forwarded.correlationId).toBe(CORRELATION_ID);
    expect(forwarded.idempotencyKey).toBe(IDEMPOTENCY_KEY);
    expect(forwarded.serviceIdentityId).toBe(ROUTING_IDENTITY);
    expect(forwarded.productId).toBe(PRODUCT);
    expect(forwarded.tenantId).toBe(TENANT);
    expect(forwarded.environment).toBe(ENV);
    expect(forwarded.apiVersion).toBe(API_VERSION);
    expect(forwarded.action).toBe(OP);
    expect(forwarded.signature).toBe(sent.signature); // signature is not rewritten
  });
});

// ===========================================================================
// 9.2 — no charge on denial.
// ===========================================================================
describe('9.2 — a denial never charges (transport untouched)', () => {
  for (const state of ['SUSPENDED', 'REVOKED'] as const) {
    it(`a ${state} onboarding denies and charges nothing`, async () => {
      const t = setup();
      const router = await seedRouter(t);
      const id = await register(router);
      await activate(router, id);
      await router.mutation(internal.productOnboardings.setLifecycleState, {
        onboardingId: id,
        state,
      });

      const { transport, calls, uniqueCharges } = costLedgerTransport({
        ok: true,
        body: '{}',
        correlationId: CORRELATION_ID,
      });
      const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
      const worker = createGovernedWorker({
        queue,
        clock: () => NOW,
        boundary: boundaryFor(router, transport),
      });
      await queue.enqueue(job());

      await worker.runOnce(NOW);
      expect(calls.length).toBe(0);
      expect(uniqueCharges()).toBe(0);
    });
  }

  it('a route/envelope mismatch denies and charges nothing', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport, calls, uniqueCharges } = costLedgerTransport({
      ok: true,
      body: '{}',
      correlationId: CORRELATION_ID,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    // Signed envelope claims a DIFFERENT tenant than the route resolves.
    await queue.enqueue(job({ signed: signedEnvelope({ tenantId: 'SYNTH-TENANT-Z' }) }));

    const result = await worker.runOnce(NOW);
    expect(result?.status).toBe('DEAD_LETTERED'); // TERMINAL
    expect(calls.length).toBe(0);
    expect(uniqueCharges()).toBe(0);
  });
});

// ===========================================================================
// 9.3 — no duplicate charge on a safe retry.
// ===========================================================================
describe('9.3 — a safe retry does not duplicate the charge', () => {
  it('re-forwards the SAME idempotencyKey; the ledger charges once', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport, calls, uniqueCharges } = costLedgerTransport({
      ok: false,
      error: { error: 'CONNECTION_REFUSED', message: 'refused' } as never,
      retryable: true,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });
    await queue.enqueue(job());

    const first = await worker.runOnce(NOW);
    expect(first?.status).toBe('RETRIED');
    const second = await worker.runOnce(NOW + 1_000);
    expect(second?.status).toBe('RETRIED');

    expect(calls.length).toBe(2); // forwarded twice
    expect(calls.every((c) => c.idempotencyKey === IDEMPOTENCY_KEY)).toBe(true);
    expect(uniqueCharges()).toBe(1); // but charged once
  });
});

// ===========================================================================
// 9.4 — no second charge on replay.
// ===========================================================================
describe('9.4 — replaying the same request does not charge twice', () => {
  it('two dispatches of the same idempotencyKey deduplicate to one charge', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport, calls, uniqueCharges } = costLedgerTransport({
      ok: true,
      body: '{}',
      correlationId: CORRELATION_ID,
    });
    const queue = new InMemoryQueue<GovernedDispatchJobPayload>();
    const worker = createGovernedWorker({
      queue,
      clock: () => NOW,
      boundary: boundaryFor(router, transport),
    });

    await queue.enqueue(job({}, 'job-00000001'));
    expect((await worker.runOnce(NOW))?.status).toBe('ACKED');
    // Replay: a second delivery of the SAME request (same idempotency key).
    await queue.enqueue(job({}, 'job-00000002'));
    expect((await worker.runOnce(NOW))?.status).toBe('ACKED');

    expect(calls.length).toBe(2);
    expect(uniqueCharges()).toBe(1);
  });
});

// ===========================================================================
// 9.5 — ambiguous is never blindly re-charged.
// ===========================================================================
describe('9.5 — an ambiguous outcome is quarantined, never blindly re-charged', () => {
  it('quarantines the job and does not re-forward it', async () => {
    const t = setup();
    const router = await seedRouter(t);
    const id = await register(router);
    await activate(router, id);

    const { transport, calls, uniqueCharges } = costLedgerTransport({
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
    expect(calls.length).toBe(1);
    expect(uniqueCharges()).toBe(1);

    // The quarantined job is NOT ready: it cannot be re-reserved/re-forwarded.
    expect(await queue.reserve(NOW + 10_000_000)).toBeNull();
    expect(calls.length).toBe(1); // still exactly one forward
  });
});

// ===========================================================================
// 9.6 — the cost event is linkable to the request (shared keys).
// ===========================================================================
describe('9.6 — a cost event is linkable to the request by shared keys', () => {
  it('a cost event carrying the same correlation/idempotency/request keys validates', () => {
    const costEvent = {
      eventType: 'apiHub.apiCostRecorded' as const,
      costEventId: 'cost-0000001',
      sourceHub: 'ARMA_API_HUB' as const,
      eventVersion: '1.0.0',
      schemaVersion: '1.0.0',
      vendorId: 'vendor-0001',
      connectorId: 'connector-0001',
      systemId: 'system-0001',
      serviceId: ROUTING_IDENTITY,
      tenantId: TENANT,
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      quantity: 1,
      unitType: 'REQUEST' as const,
      amountMinor: 5,
      currency: 'USD',
      pricingVersionId: 'pricing-0001',
      costStatus: 'FINALIZED' as const,
      calculationVersion: '1.0.0',
      effectiveDate: String(NOW),
      auditRef: 'audit-0001',
      billingPeriod: '2023-11',
      eventTimestamp: String(NOW),
      pricingSource: 'vendor-price-list-2023',
    };
    const result = validate(apiCostRecordedSchema, costEvent);
    expect(result.ok).toBe(true);
  });

  it('a cost event with a floating-point amount is rejected (integer minor units only)', () => {
    const bad = {
      eventType: 'apiHub.apiCostRecorded' as const,
      costEventId: 'cost-0000001',
      sourceHub: 'ARMA_API_HUB' as const,
      eventVersion: '1.0.0',
      schemaVersion: '1.0.0',
      vendorId: 'vendor-0001',
      connectorId: 'connector-0001',
      systemId: 'system-0001',
      serviceId: ROUTING_IDENTITY,
      correlationId: CORRELATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestId: REQUEST_ID,
      quantity: 1,
      unitType: 'REQUEST' as const,
      amountMinor: 5.5, // NOT an integer
      currency: 'USD',
      pricingVersionId: 'pricing-0001',
      costStatus: 'FINALIZED' as const,
      calculationVersion: '1.0.0',
      effectiveDate: String(NOW),
      auditRef: 'audit-0001',
      billingPeriod: '2023-11',
      eventTimestamp: String(NOW),
      pricingSource: 'vendor-price-list-2023',
    };
    expect(validate(apiCostRecordedSchema, bad).ok).toBe(false);
  });
});
