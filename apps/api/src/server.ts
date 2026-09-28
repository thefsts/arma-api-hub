// ARMA API Hub — service-facing API entrypoint.

import { loadConfig } from '@arma/config';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildApp({ config });
  await app.listen({ port: config.API_HUB_API_PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error('api: fatal startup error', error instanceof Error ? error.message : 'unknown');
  process.exitCode = 1;
});
