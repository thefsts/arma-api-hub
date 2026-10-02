// Phase 8 PM HOLD — Section 2: complete route <-> signed-envelope binding.
//
// The governed dispatcher forwards a signed envelope to the Compliance Core ONLY
// after the routing gate returns an explicit ALLOW. The ALLOW carries a resolved
// `route` (the trusted routing authority's view of the request). Defense in
// depth requires that the forwarded envelope is tied to that trusted route on
// EVERY authority-bearing field, so two independently caller-supplied values can
// never disagree and slip through.
//
// The bound fields are:
//
//   route.productId          == signed.productId
//   route.tenantId           == signed.tenantId
//   route.environment        == signed.environment
//   route.hubRoutingIdentity == signed.serviceIdentityId
//   route.apiVersion         == signed.apiVersion
//   route.operation          == signed.action
//
// This suite drives the REAL dispatcher with a permissive (compromised) gate and
// a spy transport, and proves that a mismatch on ANY ONE of those fields fails
// closed with ROUTE_ENVELOPE_MISMATCH (TERMINAL) and NEVER reaches the transport.
//
// It also documents the fields that are deliberately NOT bound because they have
// no signed-envelope counterpart (route.scope, route.contractVersion are
// routing-authority / durable-record concepts; resourceType/resourceId are
// Core-resource fields).
//
// Evidence class: IN-PROCESS (pure dispatcher + spy transport).

import { describe, expect, it } from 'vitest';
import {
  buildGovernedEnvelope,
  createGovernedDispatcher,
  type ComplianceCoreTransport,
  type GovernedRequest,
  type RoutingDecision,
  type RoutingGateRequest,
  type RoutingRoute,
  type TransportResult,
} from '@arma/compliance-core-client';

const NOW = 1_700_000_000_000;
const PRODUCT = 'arma-system-360';
const TENANT = 'SYNTH-TENANT-A';
const ENV = 'PRODUCTION';
const ROUTING_IDENTITY = 'arma-system-360';
const API_VERSION = '1.1.0';
const OP = 'compliance.applicability.read';
const SCOPE = 'compliance.read';
const CONTRACT_VERSION = '1.0.0';
const CRED_REF = 'key-arma-0001';
const SECRET = 'synthetic-binding-secret';

/** The trusted route the gate resolves (the authority's view). */
function trustedRoute(over: Partial<RoutingRoute> = {}): RoutingRoute {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
    credentialReference: CRED_REF,
    ...over,
  };
}

/** A gate that always ALLOWs with the trusted route (models a compromised gate). */
function permissiveGate(route: RoutingRoute = trustedRoute()) {
  return async (_request: RoutingGateRequest): Promise<RoutingDecision> => ({
    allowed: true,
    route,
  });
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

function request(): RoutingGateRequest {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    environment: ENV,
    hubRoutingIdentity: ROUTING_IDENTITY,
    operation: OP,
    scope: SCOPE,
    contractVersion: CONTRACT_VERSION,
    apiVersion: API_VERSION,
  };
}

async function dispatch(
  signed: GovernedRequest,
  route: RoutingRoute = trustedRoute(),
): Promise<{
  result: Awaited<ReturnType<ReturnType<typeof createGovernedDispatcher>['dispatch']>>;
  calls: GovernedRequest[];
}> {
  const { transport, calls } = spyTransport();
  const dispatcher = createGovernedDispatcher({ gate: permissiveGate(route), transport });
  const result = await dispatcher.dispatch({ request: request(), signed, governedBody: '{}' });
  return { result, calls };
}

describe('route <-> envelope binding — control', () => {
  it('a fully-matching envelope is forwarded exactly once', async () => {
    const { result, calls } = await dispatch(signedEnvelope());
    expect(result.dispatched).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('route <-> envelope binding — every bound field is enforced', () => {
  it('productId mismatch fails closed (TERMINAL) and is never forwarded', async () => {
    const { result, calls } = await dispatch(signedEnvelope({ productId: 'other-product' }));
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(result.disposition).toBe('TERMINAL');
    expect(calls).toHaveLength(0);
  });

  it('tenantId mismatch fails closed (TERMINAL) and is never forwarded', async () => {
    const { result, calls } = await dispatch(signedEnvelope({ tenantId: 'SYNTH-TENANT-B' }));
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(result.disposition).toBe('TERMINAL');
    expect(calls).toHaveLength(0);
  });

  it('environment mismatch fails closed (TERMINAL) and is never forwarded', async () => {
    const { result, calls } = await dispatch(signedEnvelope({ environment: 'DEVELOPMENT' }));
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(result.disposition).toBe('TERMINAL');
    expect(calls).toHaveLength(0);
  });

  it('hubRoutingIdentity <-> serviceIdentityId mismatch fails closed (TERMINAL)', async () => {
    const { result, calls } = await dispatch(
      signedEnvelope({ serviceIdentityId: 'some-other-identity' }),
    );
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(result.disposition).toBe('TERMINAL');
    expect(calls).toHaveLength(0);
  });

  it('apiVersion mismatch fails closed (TERMINAL) and is never forwarded', async () => {
    const { result, calls } = await dispatch(signedEnvelope({ apiVersion: '1.0.0' }));
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(result.disposition).toBe('TERMINAL');
    expect(calls).toHaveLength(0);
  });

  it('operation <-> action mismatch fails closed (TERMINAL) and is never forwarded', async () => {
    const { result, calls } = await dispatch(
      signedEnvelope({ action: 'compliance.controls.read' }),
    );
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(result.disposition).toBe('TERMINAL');
    expect(calls).toHaveLength(0);
  });

  it('the mismatch check is symmetric: the route (not the envelope) is the authority', async () => {
    // The gate resolves a route for tenant B while the envelope is signed for
    // tenant A. The envelope is NOT silently rewritten to match the route; the
    // disagreement fails closed.
    const { result, calls } = await dispatch(
      signedEnvelope({ tenantId: TENANT }),
      trustedRoute({ tenantId: 'SYNTH-TENANT-B' }),
    );
    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('unreachable');
    expect(result.code).toBe('ROUTE_ENVELOPE_MISMATCH');
    expect(calls).toHaveLength(0);
  });
});

describe('route <-> envelope binding — documented non-bound fields', () => {
  // These fields have no signed-envelope counterpart and are intentionally not
  // bound. This test documents that a route differing ONLY on these fields still
  // forwards (they are durable-registry / Core-resource concepts, not wire
  // identity), so the binding surface is explicit and auditable.
  it('a route differing only on scope/contractVersion still forwards (no wire counterpart)', async () => {
    const { result, calls } = await dispatch(
      signedEnvelope(),
      trustedRoute({ scope: 'compliance.read.extended', contractVersion: '9.9.9' }),
    );
    expect(result.dispatched).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
