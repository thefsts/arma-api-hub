// ARMA API Hub — service-facing API application.
//
// Phase 0 scope: prove workspace wiring and expose the control-plane surface
// shape. This app validates signed service request envelopes and reports
// health. It does NOT connect to any production system and does NOT hold
// privileged credentials on behalf of browser or mobile clients.

import Fastify, { type FastifyInstance } from 'fastify';
import { serviceRequestEnvelopeSchema, validate } from '@arma/contracts';
import { verifyCanonicalRequestSignature } from '@arma/crypto';
import { SafeLogger } from '@arma/observability';
import type { ApiHubConfig } from '@arma/config';

export interface BuildAppOptions {
  readonly config: ApiHubConfig;
  /** Resolves the signing secret for a key id. Never logged. */
  readonly resolveSecret?: (keyId: string) => string | null;
  readonly logger?: SafeLogger;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const log = options.logger ?? new SafeLogger({ level: options.config.API_HUB_LOG_LEVEL });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async () => ({
    status: 'ok',
    environment: options.config.API_HUB_ENV,
    outboundDeliveryDisabled: options.config.API_HUB_OUTBOUND_DELIVERY_DISABLED,
  }));

  // Validate a signed service request envelope. This is a control-plane
  // primitive, not a production connector.
  app.post('/v1/validate', async (request, reply) => {
    const parsed = validate(serviceRequestEnvelopeSchema, request.body);
    if (!parsed.ok) {
      log.warn('envelope.invalid', { errorCode: 'ENVELOPE_INVALID' });
      return reply.status(400).send({
        schemaVersion: '1.0.0',
        error: 'ENVELOPE_INVALID',
        errorClass: 'INPUT',
        retryable: false,
      });
    }
    const envelope = parsed.value;

    const secret = options.resolveSecret?.(envelope.keyId) ?? null;
    if (!secret) {
      log.warn('envelope.unknown_key', { keyId: envelope.keyId, requestId: envelope.requestId });
      return reply.status(401).send({
        schemaVersion: '1.0.0',
        error: 'CREDENTIAL_UNKNOWN',
        errorClass: 'AUTHENTICATION',
        retryable: false,
        requestId: envelope.requestId,
      });
    }

    const verification = verifyCanonicalRequestSignature({
      secret,
      method: 'POST',
      path: '/v1/validate',
      timestamp: envelope.timestamp,
      nonce: envelope.nonce,
      bodyHash: envelope.bodyHash,
      providedSignature: envelope.signature.value,
      algorithm: envelope.signature.algorithm,
    });

    if (!verification.ok) {
      log.warn('envelope.signature_invalid', {
        requestId: envelope.requestId,
        errorCode: verification.code,
      });
      return reply.status(401).send({
        schemaVersion: '1.0.0',
        error: verification.code,
        errorClass: 'AUTHENTICATION',
        retryable: false,
        requestId: envelope.requestId,
      });
    }

    log.info('envelope.accepted', {
      requestId: envelope.requestId,
      serviceId: envelope.serviceId,
      operation: envelope.operation,
    });
    return reply.status(200).send({ accepted: true, requestId: envelope.requestId });
  });

  return app;
}
