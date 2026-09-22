// ARMA API Hub — configuration loading.
//
// Loads and validates environment configuration. Secrets are referenced by
// name only; this module never logs or returns secret values. Kill switches
// default to the fail-closed state.

import { z } from 'zod';

export const environmentSchema = z.enum(['development', 'preview', 'production']);
export type RuntimeEnvironment = z.infer<typeof environmentSchema>;

export const configSchema = z.object({
  API_HUB_ENV: environmentSchema.default('development'),
  API_HUB_API_PORT: z.coerce.number().int().positive().default(8080),
  API_HUB_CONSOLE_PORT: z.coerce.number().int().positive().default(3000),
  API_HUB_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  API_HUB_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  API_HUB_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  API_HUB_SIGNING_KEY_ID: z.string().min(1).default('local-dev-key-0001'),
  API_HUB_SIGNING_ALGORITHM: z
    .enum(['HMAC-SHA256', 'ED25519', 'ECDSA-P256-SHA256'])
    .default('HMAC-SHA256'),
  // Fail-closed defaults: outbound delivery is disabled unless explicitly enabled.
  API_HUB_OUTBOUND_DELIVERY_DISABLED: z.coerce.boolean().default(true),
  API_HUB_CONNECTOR_DELIVERY_DISABLED: z.coerce.boolean().default(true),
});

export type ApiHubConfig = z.infer<typeof configSchema>;

/** Parse configuration from an environment map. Throws on invalid input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiHubConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const summary = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`CONFIG_INVALID: ${summary}`);
  }
  return parsed.data;
}

/** True when outbound delivery is permitted (fail-closed when disabled). */
export function isOutboundDeliveryEnabled(config: ApiHubConfig): boolean {
  return config.API_HUB_OUTBOUND_DELIVERY_DISABLED === false;
}
