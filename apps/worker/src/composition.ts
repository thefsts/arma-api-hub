// ARMA API Hub — governed worker composition root (Phase 8 hardening).
//
// This is the REAL, executable governed path — not a factory. It wires the
// complete chain the PM required:
//
//   durable queue/reservation
//     → governed worker handler
//       → trusted routing-gate adapter
//         → trusted server clock
//           → credential/reference resolution
//             → ComplianceCoreTransport
//               → Compliance Core boundary
//
// `createGovernedJobHandler` is only a factory; this module is what actually
// composes it into a runnable worker with a queue, a trusted clock, a trusted
// routing gate, credential resolution, and a transport.
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE.
// The Hub transports; the Core decides. A transport outcome is never a verdict.
//
// The in-memory queue is DEVELOPMENT/local-only (see the runtime ADR). The
// composition is deliberately structured so a durable broker can replace the
// queue without touching the governed path: the governed path depends only on
// the `Queue` contract, never on the concrete implementation.

import type { ComplianceCoreTransport, ResolvedCredential } from '@arma/compliance-core-client';
import { createGovernedJobHandler, type GovernedDispatchJobPayload } from './governedDispatch.js';
import { processJob, type ProcessResult } from './processor.js';
import type { Queue } from './queue.js';
import {
  createTrustedRoutingGate,
  type InternalRouteResolver,
  type TrustedClock,
} from './trustedRoutingGate.js';

/**
 * The Hub's runtime boundary: the existing internal Convex routing boundary and
 * the Compliance Core transport, plus Hub-side credential resolution. Injected so
 * the worker never imports Convex directly (the Hub must never reach the Core
 * database directly).
 */
export interface GovernedBoundary {
  /** The existing internal boundary: `internal.productOnboardings.route`. */
  readonly resolveRoute: InternalRouteResolver;
  /** Hub-side credential/reference resolution (reference -> signing material). */
  readonly resolveCredential: (reference: string) => Promise<ResolvedCredential>;
  /** The transport-only Compliance Core client. */
  readonly transport: ComplianceCoreTransport;
}

export interface GovernedWorkerDeps {
  readonly queue: Queue<GovernedDispatchJobPayload>;
  /** Trusted server clock; never caller-supplied. */
  readonly clock: TrustedClock;
  readonly boundary: GovernedBoundary;
}

export interface GovernedWorker {
  /** The governed job handler (gate-enforced; the only sanctioned Core path). */
  readonly handler: ReturnType<typeof createGovernedJobHandler>;
  /** Reserve and process at most one job; null when nothing is ready. */
  runOnce(now: number): Promise<ProcessResult | null>;
  /** Resume governance-held work after a control is released. */
  releaseHeld(now: number): Promise<number>;
}

/**
 * Compose the governed worker. The returned worker's ONLY path to the Compliance
 * Core is: reserve → governed handler → trusted gate → credential resolution →
 * transport. There is no alternate (ungoverned) dispatch path.
 */
export function createGovernedWorker(deps: GovernedWorkerDeps): GovernedWorker {
  // The trusted gate injects `now` from the trusted clock; the job supplies no
  // clock. The handler enforces the gate before any transport call.
  const gate = createTrustedRoutingGate({
    resolveRoute: deps.boundary.resolveRoute,
    clock: deps.clock,
  });
  const handler = createGovernedJobHandler({
    gate,
    transport: deps.boundary.transport,
    resolveCredential: deps.boundary.resolveCredential,
  });
  return {
    handler,
    async runOnce(now: number): Promise<ProcessResult | null> {
      const job = await deps.queue.reserve(now);
      if (!job) return null;
      return processJob(deps.queue, job, handler, now);
    },
    async releaseHeld(now: number): Promise<number> {
      return deps.queue.release(now);
    },
  };
}
