// ARMA API Hub — governed dispatch job handler (Phase 8 hardening).
//
// This is the worker's ACTUAL governed dispatch path. It is the only sanctioned
// way a durable job reaches the Compliance Core transport, and it enforces the
// Hub's onboarding routing gate BEFORE any transport call. A job whose routing
// decision is not an explicit ALLOW is refused and never forwarded.
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE.
// The Hub transports; the Core decides. A transport outcome is never a verdict.
//
// The routing gate is INJECTED (in production it is the Hub's Convex
// `productOnboardings.route` internal query, which loads the onboarding from
// durable server-side records and enforces the caller's service scope). The
// handler never re-implements the decision.

import type { ComplianceCoreTransport, RoutingGate } from '@arma/compliance-core-client';
import { createGovernedDispatcher } from '@arma/compliance-core-client';
import type { Job } from './queue.js';
import type { JobHandler, JobOutcome } from './processor.js';

/** The payload a governed-dispatch job carries. */
export interface GovernedDispatchJobPayload {
  readonly request: Parameters<RoutingGate>[0];
  readonly signed: Parameters<ComplianceCoreTransport['forward']>[0];
  readonly governedBody: string;
}

/**
 * Build the worker's governed dispatch handler. Routing denials are TERMINAL:
 * they are refused before dispatch and are never retried as transport failures.
 * A clean, retryable transport failure is retried; an ambiguous or terminal
 * transport failure is not (an accepted side effect must never be duplicated).
 */
export function createGovernedJobHandler(deps: {
  readonly gate: RoutingGate;
  readonly transport: ComplianceCoreTransport;
}): JobHandler<GovernedDispatchJobPayload> {
  const dispatcher = createGovernedDispatcher(deps);
  return async (job: Job<GovernedDispatchJobPayload>): Promise<JobOutcome> => {
    const result = await dispatcher.dispatch(job.payload);
    if (!result.dispatched) {
      // The request was refused by the routing gate before any transport call.
      // A denial is a decision, not a transient failure: never retried.
      return { ok: false, failureClass: 'TERMINAL', reason: `ROUTING_DENIED:${result.code}` };
    }
    if (result.transport.ok) {
      return { ok: true };
    }
    return {
      ok: false,
      failureClass: result.transport.retryable ? 'CLEAN_RETRYABLE' : 'TERMINAL',
      reason: `TRANSPORT_FAILED:${result.transport.error.error}`,
    };
  };
}
