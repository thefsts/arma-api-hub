// ARMA API Hub — transport telemetry emitter (Phase 9).
//
// A thin, in-process emission layer that turns governed request handling into
// bounded `TransportObservation` records. It is deliberately NOT a second
// authority:
//
//   * It mints the Hub-authoritative `traceId` from the canonical routing
//     context (PM correction C2). A caller-supplied correlation id is preserved
//     only as an untrusted `callerCorrelationRef`.
//   * Every record passes through `projectObservation()`, which fails closed on
//     forbidden fields, non-allow-listed fields, control characters, ANSI
//     escapes, and out-of-range numerics.
//   * It computes governed retention from environment + data classification
//     (PM correction C4). There is no hardcoded universal retention.
//   * It never records a body, signature, secret, credential, or evidence.
//
// HONESTY: a transport outcome is NEVER a compliance verdict.

import {
  InMemoryTraceBindingRegistry,
  assertTraceBinding,
  mintTraceIdentity,
  newObservationId,
  projectObservation,
  resolveRetention,
  type DataClassification,
  type Environment,
  type FailureCode,
  type ObservationKind,
  type Outcome,
  type ProjectionIssue,
  type TransportObservation,
} from '@arma/observability';

export interface EmitInput {
  readonly kind: ObservationKind;
  readonly traceId: string;
  readonly observedAt: number;
  readonly callerCorrelationRef?: string;
  readonly causationId?: string;
  readonly productId?: string;
  readonly tenantId?: string;
  readonly environment?: Environment;
  readonly serviceId?: string;
  readonly hubRoutingIdentity?: string;
  readonly operation?: string;
  readonly scope?: string;
  readonly contractVersion?: string;
  readonly apiVersion?: string;
  readonly direction?: 'INBOUND' | 'OUTBOUND';
  readonly hop?: 'PRODUCT_TO_HUB' | 'HUB_TO_CORE' | 'CORE_TO_HUB' | 'HUB_TO_PRODUCT';
  readonly outcome?: Outcome;
  readonly errorCode?: FailureCode;
  readonly failureClass?: 'CLEAN_RETRYABLE' | 'AMBIGUOUS' | 'TERMINAL';
  readonly httpStatus?: number;
  readonly latencyMs?: number;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly retryable?: boolean;
  readonly killSwitchEngaged?: boolean;
  readonly replayed?: boolean;
  readonly idempotencyMatched?: boolean;
  readonly nonceFresh?: boolean;
  readonly dependencyId?: string;
  readonly dependencyType?: 'CORE' | 'PRODUCT' | 'CONNECTOR' | 'WEBHOOK';
  readonly operationalState?: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
}

export interface EmittedObservation {
  readonly observation: TransportObservation;
  readonly retentionDays: number;
  readonly retentionPolicyRef: string;
  readonly expiresAt: number;
}

export interface EmitResult {
  readonly ok: boolean;
  readonly emitted: EmittedObservation | null;
  readonly issues: readonly ProjectionIssue[];
}

/** Governed retention inputs for the emitter. */
export interface EmitterOptions {
  readonly environment: Environment;
  readonly dataClassification: DataClassification;
  readonly retentionPolicyRef?: string;
  readonly retentionMaxDays?: number;
  readonly sink?: (observation: TransportObservation) => void;
  readonly now?: () => number;
}

const DAY_MS = 86_400_000;

/**
 * The transport telemetry emitter. One instance per process. Holds the
 * in-memory trace binding registry used to detect trace forgery.
 */
export class TransportTelemetryEmitter {
  readonly #registry = new InMemoryTraceBindingRegistry();
  readonly #options: EmitterOptions;
  readonly #now: () => number;
  readonly #sink: (observation: TransportObservation) => void;

  constructor(options: EmitterOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#sink = options.sink ?? (() => undefined);
  }

  /** Mint the Hub-authoritative trace identity for an inbound governed request. */
  mintTrace(input: {
    readonly productId: string;
    readonly tenantId: string;
    readonly environment: Environment;
    readonly hubRoutingIdentity: string;
    readonly serviceId?: string;
    readonly callerCorrelationRef?: string;
  }):
    | { readonly ok: true; readonly traceId: string; readonly callerCorrelationRef: string | null }
    | { readonly ok: false; readonly code: string; readonly reason: string } {
    const decision = mintTraceIdentity({
      routingContext: {
        productId: input.productId,
        tenantId: input.tenantId,
        environment: input.environment,
        hubRoutingIdentity: input.hubRoutingIdentity,
        ...(input.serviceId !== undefined ? { serviceId: input.serviceId } : {}),
      },
      ...(input.callerCorrelationRef !== undefined
        ? { callerCorrelationRef: input.callerCorrelationRef }
        : {}),
      now: this.#now(),
      registry: this.#registry,
    });
    if (!decision.ok || decision.binding === null) {
      return {
        ok: false,
        code: decision.code ?? 'INTEGRITY_FAILED',
        reason: decision.reason ?? 'TRACE_MINT_FAILED',
      };
    }
    return {
      ok: true,
      traceId: decision.binding.traceId,
      callerCorrelationRef: decision.binding.callerCorrelationRef,
    };
  }

  /** Verify that a presented trace id is genuinely Hub-minted for this context. */
  verifyTrace(input: {
    readonly traceId: string;
    readonly productId: string;
    readonly tenantId: string;
    readonly environment: Environment;
    readonly hubRoutingIdentity: string;
    readonly serviceId?: string;
    readonly callerCorrelationRef?: string;
  }): { readonly ok: boolean; readonly code: string | null } {
    const result = assertTraceBinding({
      traceId: input.traceId,
      routingContext: {
        productId: input.productId,
        tenantId: input.tenantId,
        environment: input.environment,
        hubRoutingIdentity: input.hubRoutingIdentity,
        ...(input.serviceId !== undefined ? { serviceId: input.serviceId } : {}),
      },
      registry: this.#registry,
      ...(input.callerCorrelationRef !== undefined
        ? { callerCorrelationRef: input.callerCorrelationRef }
        : {}),
    });
    return { ok: result.ok, code: result.code };
  }

  /** Project, retention-resolve, and emit one observation. Fails closed. */
  emit(input: EmitInput): EmitResult {
    const candidate: Record<string, unknown> = {
      observationId: newObservationId(),
      observedAt: input.observedAt,
      kind: input.kind,
      traceId: input.traceId,
      complianceClaim: 'NONE',
      certificationClaim: 'NONE',
    };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) candidate[key] = value;
    }

    const projection = projectObservation(candidate);
    if (!projection.ok || projection.observation === null) {
      return { ok: false, emitted: null, issues: projection.issues };
    }

    const retention = resolveRetention({
      environment: this.#options.environment,
      dataClassification: this.#options.dataClassification,
      ...(this.#options.retentionPolicyRef !== undefined ||
      this.#options.retentionMaxDays !== undefined
        ? {
            policy: {
              policyRef: this.#options.retentionPolicyRef ?? 'phase9.default',
              ...(this.#options.retentionMaxDays !== undefined
                ? { maxDays: this.#options.retentionMaxDays }
                : {}),
            },
          }
        : {}),
    });

    const expiresAt = input.observedAt + retention.retentionDays * DAY_MS;
    this.#sink(projection.observation);
    return {
      ok: true,
      emitted: {
        observation: projection.observation,
        retentionDays: retention.retentionDays,
        retentionPolicyRef: retention.policyRef,
        expiresAt,
      },
      issues: [],
    };
  }
}

/** Build a fail-closed operational health payload. Never a compliance claim. */
export function buildOperationalHealth(input: {
  readonly state: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly environment: string;
  readonly reasons?: readonly string[];
  readonly checkedAt: number;
}): {
  readonly state: string;
  readonly environment: string;
  readonly reasons: readonly string[];
  readonly checkedAt: number;
  readonly complianceClaim: 'NONE';
  readonly certificationClaim: 'NONE';
} {
  return {
    state: input.state,
    environment: input.environment,
    reasons: input.reasons ?? [],
    checkedAt: input.checkedAt,
    complianceClaim: 'NONE',
    certificationClaim: 'NONE',
  };
}

/**
 * Bounded Prometheus-style exposition. Labels are a closed set with bounded
 * cardinality: no tenant, product, trace, or operation label — those would be
 * unbounded. Only kind/outcome/errorCode, all closed enums.
 */
export function renderMetrics(input: {
  readonly counts: Readonly<Record<string, number>>;
  readonly state: string;
}): string {
  const lines: string[] = [];
  lines.push('# HELP arma_hub_transport_observations_total Bounded transport observations.');
  lines.push('# TYPE arma_hub_transport_observations_total counter');
  for (const [key, value] of Object.entries(input.counts).sort(([a], [b]) => a.localeCompare(b))) {
    if (!Number.isFinite(value) || value < 0) continue;
    // Key must be a bounded enum triple; reject anything with a newline.
    if (/[\r\n]/.test(key)) continue;
    lines.push(`arma_hub_transport_observations_total{${key}} ${Math.floor(value)}`);
  }
  lines.push('# HELP arma_hub_operational_state Hub operational state (1 = current).');
  lines.push('# TYPE arma_hub_operational_state gauge');
  for (const state of ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']) {
    lines.push(`arma_hub_operational_state{state="${state}"} ${state === input.state ? 1 : 0}`);
  }
  return `${lines.join('\n')}\n`;
}
