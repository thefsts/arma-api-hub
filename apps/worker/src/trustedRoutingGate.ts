// ARMA API Hub — trusted routing-gate adapter (Phase 8 hardening).
//
// The governed dispatch boundary consumes a `RoutingGate`, which receives only
// the routing request. The Hub's Convex `internal.productOnboardings.route`
// query additionally requires `now` — the credential-expiry evaluation clock.
//
// This adapter is the ONLY place that supplies `now`, and it takes it from a
// TRUSTED SERVER CLOCK, never from the product/job caller. A durable job payload
// carries a `RoutingGateRequest` with no clock field, so a caller cannot move the
// credential-expiry comparison, and a caller cannot supply a `now` that would
// silently admit an expired credential.
//
// The adapter calls the EXISTING internal Convex boundary through an injected
// resolver. It introduces NO new public Convex function and NO direct Convex
// import (the Hub must never reach the Core database directly — see
// `assertNoDirectCoreDatabaseAccess`).

import type {
  RoutingDecision,
  RoutingGate,
  RoutingGateRequest,
} from '@arma/compliance-core-client';

/**
 * A trusted, server-owned clock. It is never derived from caller input. In
 * production this is the worker runtime's wall clock; in tests it is a fixed
 * server-supplied instant.
 */
export type TrustedClock = () => number;

/**
 * The existing internal Convex boundary caller. It is the Hub's
 * `internal.productOnboardings.route` query, invoked through the internal
 * boundary with the trusted `now` injected by the adapter.
 */
export type InternalRouteResolver = (
  request: RoutingGateRequest,
  now: number,
) => Promise<RoutingDecision>;

/**
 * Build the trusted routing gate. The returned gate injects `now` from the
 * trusted clock and delegates the decision to the internal boundary. The caller
 * (a durable job) supplies NO clock.
 */
export function createTrustedRoutingGate(deps: {
  readonly resolveRoute: InternalRouteResolver;
  readonly clock: TrustedClock;
}): RoutingGate {
  return async (request: RoutingGateRequest): Promise<RoutingDecision> => {
    // `now` is server-authoritative. The caller supplies no clock and cannot
    // influence the credential-expiry evaluation.
    const now = deps.clock();
    return deps.resolveRoute(request, now);
  };
}
