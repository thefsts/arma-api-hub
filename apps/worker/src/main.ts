// ARMA API Hub — durable worker entrypoint.
//
// The worker runs the GOVERNED dispatch path: every job it processes is routed
// through the trusted routing gate before any Compliance Core transport call. The
// governed path is composed in `composition.ts`; this entrypoint wires the queue,
// the trusted server clock, and the runtime boundary, then drives the loop.
//
// In Phase 0 / DEVELOPMENT no live boundary is configured and outbound delivery
// is disabled by default, so the loop idles: it proves the governed wiring
// without performing any delivery and without inventing production
// infrastructure.

import { loadConfig } from '@arma/config';
import { SafeLogger } from '@arma/observability';
import { loadGovernedBoundary } from './boundary.js';
import { createGovernedWorker } from './composition.js';
import { InMemoryQueue } from './queue.js';
import type { GovernedDispatchJobPayload } from './governedDispatch.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = new SafeLogger({ level: config.API_HUB_LOG_LEVEL });
  // DEVELOPMENT/local queue. A durable broker replaces this without touching the
  // governed path (the governed path depends only on the `Queue` contract).
  const queue = new InMemoryQueue<GovernedDispatchJobPayload>();

  log.info('worker.started', {
    environment: config.API_HUB_ENV,
    outboundDeliveryDisabled: config.API_HUB_OUTBOUND_DELIVERY_DISABLED,
  });

  const boundary = loadGovernedBoundary(config);
  if (boundary === null) {
    // Fail-closed: no live boundary means no governed dispatch. The loop idles.
    log.info('worker.governed-boundary.unconfigured', {
      note: 'no live internal routing boundary / Core transport configured; idling',
    });
  }

  const worker =
    boundary === null
      ? null
      : createGovernedWorker({
          queue,
          // Trusted server clock; never caller-supplied.
          clock: () => Date.now(),
          boundary,
        });

  const tick = async (): Promise<void> => {
    const now = Date.now();
    if (worker === null) {
      // No boundary: reserve-and-hold nothing; simply idle.
      await queue.reserve(now);
      return;
    }
    await worker.runOnce(now);
  };

  const timer = setInterval(() => {
    void tick();
  }, config.API_HUB_WORKER_POLL_INTERVAL_MS);

  const shutdown = (): void => {
    clearInterval(timer);
    log.info('worker.stopped', {});
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('worker: fatal startup error', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
