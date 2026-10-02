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

import type {
  ComplianceCoreTransport,
  ResolvedCredential,
  RoutingGate,
} from '@arma/compliance-core-client';
import { createGovernedDispatcher } from '@arma/compliance-core-client';
import type { Job } from './queue.js';
import type { JobHandler, JobOutcome } from './processor.js';
import type { FailureClass } from './retry.js';

/** The payload a governed-dispatch job carries. */
export interface GovernedDispatchJobPayload {
  readonly request: Parameters<RoutingGate>[0];
  readonly signed: Parameters<ComplianceCoreTransport['forward']>[0];
  readonly governedBody: string;
}

/**
 * Build the worker's governed dispatch handler. A routing refusal is a DECISION,
 * not a transient transport failure: it is never forwarded and never retried as
 * a transport failure. But a refusal is NOT blanket-classified as terminal — its
 * disposition comes from the routing authority:
 *
 *   * TERMINAL        → dead-lettered (REVOKED/REJECTED, impersonation, forged
 *                       history, unsupported version, disallowed op/scope).
 *   * HELD            → held (SUSPENDED onboarding, not-yet-ACTIVE, temporary
 *                       gate/dependency failure); no retry budget consumed.
 *   * CLEAN_RETRYABLE → retried (transport failed before a side effect).
 *   * AMBIGUOUS       → quarantined for reconciliation (remote may have
 *                       accepted); never blindly retried.
 *
 * An accepted side effect must never be duplicated.
 */
export function createGovernedJobHandler(deps: {
  readonly gate: RoutingGate;
  readonly transport: ComplianceCoreTransport;
  readonly resolveCredential?: (reference: string) => Promise<ResolvedCredential>;
}): JobHandler<GovernedDispatchJobPayload> {
  const dispatcher = createGovernedDispatcher(deps);
  return async (job: Job<GovernedDispatchJobPayload>): Promise<JobOutcome> => {
    const result = await dispatcher.dispatch(job.payload);
    if (!result.dispatched) {
      // The request was refused by the routing gate before any transport call.
      // Carry the routing authority's disposition; default to TERMINAL only when
      // the authority did not supply one.
      const failureClass: FailureClass = result.disposition ?? 'TERMINAL';
      return { ok: false, failureClass, reason: `ROUTING_DENIED:${result.code}` };
    }
    if (result.transport.ok) {
      return { ok: true };
    }
    // A transport outcome is never a compliance verdict. An AMBIGUOUS outcome
    // (remote may have accepted) is quarantined for reconciliation; a clean
    // retryable failure is retried; anything else is terminal.
    const failureClass: FailureClass = result.transport.ambiguous
      ? 'AMBIGUOUS'
      : result.transport.retryable
        ? 'CLEAN_RETRYABLE'
        : 'TERMINAL';
    return {
      ok: false,
      failureClass,
      reason: `TRANSPORT_FAILED:${result.transport.error.error}`,
    };
  };
}
