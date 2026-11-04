// ARMA API Hub — service-facing API application.
//
// Phase 0 scope: prove workspace wiring and expose the control-plane surface
// shape. This app validates signed service request envelopes and reports
// health. It does NOT connect to any production system and does NOT hold
// privileged credentials on behalf of browser or mobile clients.
//
// Phase 9 adds the production-operations surface:
//
//   * every governed request mints a Hub-authoritative trace identity and
//     emits bounded transport observations (REQUEST / RESPONSE / FAILURE);
//   * `/v1/health` reports the four-state operational vocabulary with an
//     explicit `complianceClaim: NONE` — a healthy transport is never a
//     compliance verdict;
//   * `/v1/metrics` exposes a bounded Prometheus exposition with closed-enum
//     labels only (no tenant, product, trace, or operation labels);
//   * `/readyz` fails closed (503) when a mandatory dependency is UNAVAILABLE
//     or UNKNOWN. `UNKNOWN != HEALTHY`.

import Fastify, { type FastifyInstance } from 'fastify';
import { serviceRequestEnvelopeSchema, validate } from '@arma/contracts';
import { verifyCanonicalRequestSignature } from '@arma/crypto';
import {
  SafeLogger,
  deriveOperationalState,
  type Environment,
  type FailureCode,
  type HealthCheck,
} from '@arma/observability';
import type { ApiHubConfig } from '@arma/config';
import {
  TransportTelemetryEmitter,
  buildOperationalHealth,
  renderMetrics,
  type EmitInput,
} from './telemetry.js';

/** A dependency probe used to derive operational state. */
export interface DependencyProbe {
  readonly name: string;
  readonly mandatory: boolean;
  readonly probe: () => { readonly ok: boolean; readonly observedAt: number };
}

export interface TelemetryOptions {
  /** Override the emitter (tests, custom sinks). */
  readonly emitter?: TransportTelemetryEmitter;
  /** Product identity used for trace minting on the control plane. */
  readonly productId?: string;
  /** Hub routing identity used for trace minting. */
  readonly hubRoutingIdentity?: string;
  /** Mandatory/optional dependency probes for health derivation. */
  readonly probes?: readonly DependencyProbe[];
  /** A check older than this cannot support AVAILABLE. */
  readonly freshnessWindowMs?: number;
  readonly now?: () => number;
}

export interface BuildAppOptions {
  readonly config: ApiHubConfig;
  /** Resolves the signing secret for a key id. Never logged. */
  readonly resolveSecret?: (keyId: string) => string | null;
  readonly logger?: SafeLogger;
  readonly telemetry?: TelemetryOptions;
}

const DEFAULT_FRESHNESS_WINDOW_MS = 60_000;

/** Map the runtime environment vocabulary onto the governed one. */
function toGovernedEnvironment(environment: ApiHubConfig['API_HUB_ENV']): Environment {
  switch (environment) {
    case 'production':
      return 'PRODUCTION';
    case 'preview':
      return 'PREVIEW';
    default:
      return 'DEVELOPMENT';
  }
}

/** Map a crypto/validation failure onto the governed 18-code taxonomy. */
function toGovernedFailureCode(rawCode: string): FailureCode {
  switch (rawCode) {
    case 'CREDENTIAL_UNKNOWN':
    case 'SIGNATURE_ALGORITHM_UNSUPPORTED':
    case 'SIGNATURE_INPUT_INVALID':
    case 'SIGNATURE_TIMESTAMP_INVALID':
    case 'SIGNATURE_CLOCK_SKEW_EXCEEDED':
    case 'SIGNATURE_NONCE_INVALID':
    case 'SIGNATURE_BODY_HASH_INVALID':
    case 'SIGNATURE_SIGNATURE_MISMATCH':
      return 'AUTHENTICATION_FAILED';
    case 'ENVELOPE_INVALID':
      return 'VALIDATION_FAILED';
    default:
      // Fail closed: an unrecognised failure is never retryable and never
      // silently mapped onto a benign code.
      return 'INTERNAL_FAILURE';
  }
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const log = options.logger ?? new SafeLogger({ level: options.config.API_HUB_LOG_LEVEL });
  const now = options.telemetry?.now ?? Date.now;
  const environment = toGovernedEnvironment(options.config.API_HUB_ENV);
  const productId = options.telemetry?.productId ?? 'arma-api-hub';
  const hubRoutingIdentity =
    options.telemetry?.hubRoutingIdentity ?? `hub:${options.config.API_HUB_ENV}`;
  const freshnessWindowMs = options.telemetry?.freshnessWindowMs ?? DEFAULT_FRESHNESS_WINDOW_MS;

  // Bounded metric counters: closed-enum label triples only.
  const counters = new Map<string, number>();
  const bump = (kind: string, outcome: string, errorCode?: string): void => {
    const key =
      errorCode === undefined
        ? `kind="${kind}",outcome="${outcome}"`
        : `kind="${kind}",outcome="${outcome}",errorCode="${errorCode}"`;
    counters.set(key, (counters.get(key) ?? 0) + 1);
  };

  const emitter =
    options.telemetry?.emitter ??
    new TransportTelemetryEmitter({
      environment,
      dataClassification: 'INTERNAL',
      retentionPolicyRef: 'phase9.api-hub.transport',
      now,
    });

  const emit = (input: EmitInput): void => {
    const result = emitter.emit(input);
    if (!result.ok) {
      // A rejected projection is never persisted. Log the field names only —
      // never the rejected values, which may contain sensitive input.
      log.warn('telemetry.projection_rejected', {
        fields: result.issues.map((issue) => issue.field).join(','),
      });
      bump(input.kind, 'UNKNOWN');
      return;
    }
    bump(input.kind, input.outcome ?? 'UNKNOWN', input.errorCode);
  };

  /** Derive the current operational state from probes + a self-check. */
  const evaluateHealth = (): ReturnType<typeof deriveOperationalState> => {
    const checkedAt = now();
    const checks: HealthCheck[] = [
      // The process can serve this request, so the self-check is legitimately
      // ok. It is mandatory: if it fails the boundary is UNAVAILABLE.
      { name: 'hub.self', mandatory: true, ok: true, observedAt: checkedAt },
    ];
    for (const probe of options.telemetry?.probes ?? []) {
      let observed: { ok: boolean; observedAt: number };
      try {
        observed = probe.probe();
      } catch {
        // A throwing probe is unverifiable, not healthy.
        observed = { ok: false, observedAt: 0 };
      }
      checks.push({
        name: probe.name,
        mandatory: probe.mandatory,
        ok: observed.ok,
        observedAt: observed.observedAt,
      });
    }
    return deriveOperationalState({
      checks,
      now: checkedAt,
      freshnessWindowMs,
    });
  };

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    const health = evaluateHealth();
    // Fail closed: UNKNOWN and UNAVAILABLE are not ready.
    const ready = health.state === 'AVAILABLE' || health.state === 'DEGRADED';
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ok' : 'not_ready',
      state: health.state,
      environment: options.config.API_HUB_ENV,
      outboundDeliveryDisabled: options.config.API_HUB_OUTBOUND_DELIVERY_DISABLED,
      reasons: health.reasons,
      complianceClaim: 'NONE',
      certificationClaim: 'NONE',
    });
  });

  // Operational health. Never a compliance or certification claim.
  app.get('/v1/health', async (_request, reply) => {
    const health = evaluateHealth();
    return reply.status(200).send(
      buildOperationalHealth({
        state: health.state,
        environment,
        reasons: health.reasons,
        checkedAt: now(),
      }),
    );
  });

  // Bounded metrics exposition. Text format, closed-enum labels only.
  app.get('/v1/metrics', async (_request, reply) => {
    const health = evaluateHealth();
    const counts: Record<string, number> = {};
    for (const [key, value] of counters) counts[key] = value;
    return reply
      .status(200)
      .header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(renderMetrics({ counts, state: health.state }));
  });

  // Validate a signed service request envelope. This is a control-plane
  // primitive, not a production connector.
  app.post('/v1/validate', async (request, reply) => {
    const startedAt = now();
    const parsed = validate(serviceRequestEnvelopeSchema, request.body);

    if (!parsed.ok) {
      log.warn('envelope.invalid', { errorCode: 'ENVELOPE_INVALID' });
      // No trace identity exists for an unparseable envelope, so no observation
      // is fabricated. Only the bounded counter moves.
      bump('REQUEST', 'DENIED', 'VALIDATION_FAILED');
      return reply.status(400).send({
        schemaVersion: '1.0.0',
        error: 'ENVELOPE_INVALID',
        errorClass: 'INPUT',
        retryable: false,
      });
    }
    const envelope = parsed.value;

    // Mint the Hub-authoritative trace identity. The caller's requestId is
    // preserved only as an untrusted interop reference.
    const tenantId = envelope.tenant?.tenantId ?? 'platform';
    const minted = emitter.mintTrace({
      productId,
      tenantId,
      environment,
      hubRoutingIdentity,
      serviceId: envelope.serviceId,
      callerCorrelationRef: envelope.requestId,
    });
    if (!minted.ok) {
      log.warn('trace.mint_failed', { code: minted.code });
      return reply.status(500).send({
        schemaVersion: '1.0.0',
        error: 'INTERNAL_FAILURE',
        errorClass: 'INTERNAL',
        retryable: false,
        requestId: envelope.requestId,
      });
    }
    const traceId = minted.traceId;

    const base: Omit<EmitInput, 'kind' | 'outcome' | 'errorCode' | 'failureClass' | 'httpStatus'> =
      {
        traceId,
        observedAt: startedAt,
        callerCorrelationRef: envelope.requestId,
        productId,
        tenantId,
        environment,
        serviceId: envelope.serviceId,
        hubRoutingIdentity,
        operation: envelope.operation,
        contractVersion: envelope.schemaVersion,
        direction: 'INBOUND',
      };

    emit({ ...base, kind: 'REQUEST', outcome: 'UNKNOWN' });

    const fail = (status: number, error: string, errorClass: string, retryable: boolean) => {
      const errorCode = toGovernedFailureCode(error);
      emit({
        ...base,
        kind: 'FAILURE',
        outcome: 'DENIED',
        errorCode,
        failureClass: 'TERMINAL',
        httpStatus: status,
        latencyMs: Math.max(0, now() - startedAt),
      });
      return reply.status(status).send({
        schemaVersion: '1.0.0',
        error,
        errorClass,
        retryable,
        requestId: envelope.requestId,
      });
    };

    const secret = options.resolveSecret?.(envelope.keyId) ?? null;
    if (!secret) {
      log.warn('envelope.unknown_key', { keyId: envelope.keyId, requestId: envelope.requestId });
      return fail(401, 'CREDENTIAL_UNKNOWN', 'AUTHENTICATION', false);
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
      return fail(401, verification.code, 'AUTHENTICATION', false);
    }

    log.info('envelope.accepted', {
      requestId: envelope.requestId,
      serviceId: envelope.serviceId,
      operation: envelope.operation,
    });
    emit({
      ...base,
      kind: 'RESPONSE',
      outcome: 'ALLOWED',
      httpStatus: 200,
      latencyMs: Math.max(0, now() - startedAt),
    });
    return reply.status(200).send({ accepted: true, requestId: envelope.requestId, traceId });
  });

  return app;
}
