// ARMA API Hub — durable worker entrypoint.
//
// Phase 0 scope: prove the durable worker runtime wiring. No production
// connectors are registered. The worker loop is intentionally minimal and
// fail-closed: when outbound delivery is disabled it does not deliver.

import { loadConfig } from '@arma/config';
import { SafeLogger } from '@arma/observability';
import { InMemoryQueue } from './queue.js';
import { processJob } from './processor.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = new SafeLogger({ level: config.API_HUB_LOG_LEVEL });
  const queue = new InMemoryQueue();

  log.info('worker.started', {
    environment: config.API_HUB_ENV,
    outboundDeliveryDisabled: config.API_HUB_OUTBOUND_DELIVERY_DISABLED,
  });

  // Phase 0: no connectors are registered, so the loop simply idles. This
  // proves the runtime wiring without performing any delivery.
  const tick = async (): Promise<void> => {
    const job = await queue.reserve(Date.now());
    if (!job) return;
    await processJob(queue, job, async () => ({ ok: true }), Date.now());
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
