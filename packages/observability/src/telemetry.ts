// ARMA API Hub — canonical transport telemetry record.
//
// Phase 9: the Hub is an OBSERVABLE transport/governance layer. This module
// defines the single append-only observation record that every governed request
// produces. It is deliberately narrow:
//
//   * It records TRANSPORT facts only. It can never carry a compliance verdict,
//     certification, legal conclusion, or policy decision.
//   * Its field set is a closed allow-list. There is no `body`, `payload`,
//     `signature`, `secret`, `credentialValue`, or `evidence` field — not
//     filtered out, structurally absent.
//   * Every enumerated field is a closed union. No free-text status.
//   * All string values are bounded and control-character rejected, so a
//     crafted identifier cannot inject newlines/ANSI into a log line.
//
// HONESTY: a transport outcome is NEVER a compliance verdict.
// HEALTHY != COMPLIANT. READY != CERTIFIED. DELIVERED != APPLIED.

/** The published failure taxonomy (18 codes, 17 mandated + NOT_FOUND). */
export const FAILURE_CODES = [
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_DENIED',
  'TENANT_DENIED',
  'PRODUCT_DENIED',
  'ENVIRONMENT_DENIED',
  'SCOPE_DENIED',
  'INTEGRATION_INACTIVE',
  'REPLAY_DENIED',
  'STALE_REQUEST',
  'INTEGRITY_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'UNSUPPORTED_VERSION',
  'UNKNOWN_OPERATION',
  'VALIDATION_FAILED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_FAILURE',
  'NOT_FOUND',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

/** The 17 codes the Core mandates. `NOT_FOUND` is published but not mandated. */
export const MANDATED_FAILURE_CODES: readonly FailureCode[] = FAILURE_CODES.filter(
  (code) => code !== 'NOT_FOUND',
);

/**
 * Only these three codes are retryable. Everything else is terminal. This is
 * the single source of truth for retry eligibility in the telemetry layer.
 */
export const RETRYABLE_FAILURE_CODES: readonly FailureCode[] = [
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_FAILURE',
];

export type FailureClass = 'CLEAN_RETRYABLE' | 'AMBIGUOUS' | 'TERMINAL';

export function failureClassFor(code: FailureCode): FailureClass {
  if (RETRYABLE_FAILURE_CODES.includes(code)) return 'CLEAN_RETRYABLE';
  return 'TERMINAL';
}

export function isRetryableFailure(code: FailureCode): boolean {
  return RETRYABLE_FAILURE_CODES.includes(code);
}

/** Observation kinds. Closed set. */
export const OBSERVATION_KINDS = [
  'REQUEST',
  'RESPONSE',
  'HOP',
  'FAILURE',
  'RETRY',
  'REPLAY',
  'RATELIMIT',
  'HEALTH',
  'COST',
] as const;

export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

/** The four governed hops: PRODUCT -> HUB -> CORE -> HUB -> PRODUCT. */
export const HOPS = ['PRODUCT_TO_HUB', 'HUB_TO_CORE', 'CORE_TO_HUB', 'HUB_TO_PRODUCT'] as const;

export type Hop = (typeof HOPS)[number];

export const OUTCOMES = ['ALLOWED', 'DENIED', 'DELIVERED', 'FAILED', 'TIMEOUT', 'UNKNOWN'] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const ENVIRONMENTS = ['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Operational states. Exactly four, and never a compliance word. A service is
 * AVAILABLE or DEGRADED or UNAVAILABLE or UNKNOWN — never COMPLIANT, CERTIFIED,
 * or SECURE.
 */
export const OPERATIONAL_STATES = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type OperationalState = (typeof OPERATIONAL_STATES)[number];

/** Words that must never appear as an operational state. */
export const FORBIDDEN_STATE_WORDS = [
  'COMPLIANT',
  'CERTIFIED',
  'SECURE',
  'APPROVED',
  'RELEASED',
  'VERIFIED',
] as const;

/** Every observation carries an explicit non-claim. */
export const OBSERVATION_COMPLIANCE_CLAIM = 'NONE' as const;
export const OBSERVATION_CERTIFICATION_CLAIM = 'NONE' as const;

/**
 * The complete, closed field set of a transport observation. Anything not in
 * this list is dropped by `projectObservation`.
 */
export const SAFE_OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  'observationId',
  'observedAt',
  'kind',
  'traceId',
  'callerCorrelationRef',
  'causationId',
  'productId',
  'tenantId',
  'environment',
  'serviceId',
  'hubRoutingIdentity',
  'operation',
  'scope',
  'contractVersion',
  'apiVersion',
  'direction',
  'hop',
  'outcome',
  'errorCode',
  'failureClass',
  'httpStatus',
  'latencyMs',
  'attempt',
  'maxAttempts',
  'retryable',
  'killSwitchEngaged',
  'replayed',
  'idempotencyMatched',
  'nonceFresh',
  'dependencyId',
  'dependencyType',
  'operationalState',
  'complianceClaim',
  'certificationClaim',
]);

/**
 * Keys that must never appear. Defense in depth: even if a future caller adds
 * one of these to a metadata bag, projection drops it and records the drop.
 */
export const FORBIDDEN_OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  'body',
  'rawbody',
  'payload',
  'rawpayload',
  'requestbody',
  'responsebody',
  'signature',
  'signaturevalue',
  'secret',
  'secretvalue',
  'credential',
  'credentialvalue',
  'credentialmaterial',
  'token',
  'password',
  'privatekey',
  'apikey',
  'authorization',
  'evidence',
  'rawevidence',
  'verdict',
  'compliant',
  'certified',
  'approved',
  'released',
  'applied',
  'message',
  'stack',
  'errorMessage',
  'prompt',
  'completion',
]);

const MAX_STRING = 200;
const MAX_LATENCY_MS = 600_000;
const MIN_HTTP = 100;
const MAX_HTTP = 599;

/**
 * Fields whose value must be a JSON boolean. A string such as `"true"` is a
 * caller assertion, not a transport fact, and is rejected.
 */
const BOOLEAN_OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  'retryable',
  'killSwitchEngaged',
  'replayed',
  'idempotencyMatched',
  'nonceFresh',
]);

/** Fields whose value must be a JSON number. */
const NUMBER_OBSERVATION_FIELDS: ReadonlySet<string> = new Set([
  'observedAt',
  'httpStatus',
  'latencyMs',
  'attempt',
  'maxAttempts',
]);

/** Reject control characters, newlines, and ANSI escapes (log injection). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001B\[/;

export interface ProjectionIssue {
  readonly field: string;
  readonly reason:
    'FORBIDDEN_FIELD' | 'NOT_ALLOWED' | 'INVALID_TYPE' | 'OUT_OF_RANGE' | 'INJECTION';
}

export interface ProjectionResult {
  readonly ok: boolean;
  readonly observation: TransportObservation | null;
  readonly issues: readonly ProjectionIssue[];
}

/** The canonical, append-only transport observation. */
export interface TransportObservation {
  readonly observationId: string;
  readonly observedAt: number;
  readonly kind: ObservationKind;
  /** Hub-minted authoritative trace identity. Never client-supplied. */
  readonly traceId: string;
  /** Caller-supplied reference, preserved for interop, never authoritative. */
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
  readonly hop?: Hop;
  readonly outcome?: Outcome;
  readonly errorCode?: FailureCode;
  readonly failureClass?: FailureClass;
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
  readonly operationalState?: OperationalState;
  readonly complianceClaim: typeof OBSERVATION_COMPLIANCE_CLAIM;
  readonly certificationClaim: typeof OBSERVATION_CERTIFICATION_CLAIM;
}

function isPlainScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function sanitizeString(value: string): string | null {
  if (CONTROL_CHARS.test(value) || ANSI_ESCAPE.test(value)) return null;
  if (value.length === 0 || value.length > MAX_STRING) return null;
  return value;
}

/**
 * Project an arbitrary candidate into a safe `TransportObservation`.
 *
 * Fails closed: an unknown field, a forbidden field, a non-scalar, an
 * out-of-range number, or an injection attempt makes the whole projection
 * `ok: false` with `observation: null`. Callers must not persist a rejected
 * projection.
 */
export function projectObservation(candidate: Record<string, unknown>): ProjectionResult {
  const issues: ProjectionIssue[] = [];
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(candidate)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FORBIDDEN_OBSERVATION_FIELDS.has(normalized) || FORBIDDEN_OBSERVATION_FIELDS.has(key)) {
      issues.push({ field: key, reason: 'FORBIDDEN_FIELD' });
      continue;
    }
    if (!SAFE_OBSERVATION_FIELDS.has(key)) {
      issues.push({ field: key, reason: 'NOT_ALLOWED' });
      continue;
    }
    if (!isPlainScalar(value)) {
      issues.push({ field: key, reason: 'INVALID_TYPE' });
      continue;
    }
    if (BOOLEAN_OBSERVATION_FIELDS.has(key) && typeof value !== 'boolean') {
      issues.push({ field: key, reason: 'INVALID_TYPE' });
      continue;
    }
    if (NUMBER_OBSERVATION_FIELDS.has(key) && typeof value !== 'number') {
      issues.push({ field: key, reason: 'INVALID_TYPE' });
      continue;
    }
    if (typeof value === 'string') {
      const clean = sanitizeString(value);
      if (clean === null) {
        issues.push({ field: key, reason: 'INJECTION' });
        continue;
      }
      safe[key] = clean;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        issues.push({ field: key, reason: 'INVALID_TYPE' });
        continue;
      }
      safe[key] = value;
      continue;
    }
    safe[key] = value;
  }

  if (issues.length > 0) return { ok: false, observation: null, issues };

  // Range and vocabulary checks.
  const httpStatus = safe['httpStatus'];
  if (typeof httpStatus === 'number' && (httpStatus < MIN_HTTP || httpStatus > MAX_HTTP)) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'httpStatus', reason: 'OUT_OF_RANGE' }],
    };
  }
  const latencyMs = safe['latencyMs'];
  if (typeof latencyMs === 'number' && (latencyMs < 0 || latencyMs > MAX_LATENCY_MS)) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'latencyMs', reason: 'OUT_OF_RANGE' }],
    };
  }
  const attempt = safe['attempt'];
  if (typeof attempt === 'number' && (attempt < 1 || attempt > 20)) {
    return { ok: false, observation: null, issues: [{ field: 'attempt', reason: 'OUT_OF_RANGE' }] };
  }
  const maxAttempts = safe['maxAttempts'];
  if (typeof maxAttempts === 'number' && (maxAttempts < 1 || maxAttempts > 20)) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'maxAttempts', reason: 'OUT_OF_RANGE' }],
    };
  }

  const kind = safe['kind'];
  if (typeof kind !== 'string' || !(OBSERVATION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, observation: null, issues: [{ field: 'kind', reason: 'OUT_OF_RANGE' }] };
  }
  const traceId = safe['traceId'];
  if (typeof traceId !== 'string' || !TRACE_ID_PATTERN.test(traceId)) {
    return { ok: false, observation: null, issues: [{ field: 'traceId', reason: 'OUT_OF_RANGE' }] };
  }
  const observationId = safe['observationId'];
  if (typeof observationId !== 'string' || !OBSERVATION_ID_PATTERN.test(observationId)) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'observationId', reason: 'OUT_OF_RANGE' }],
    };
  }
  const observedAt = safe['observedAt'];
  if (typeof observedAt !== 'number' || observedAt <= 0) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'observedAt', reason: 'OUT_OF_RANGE' }],
    };
  }
  const errorCode = safe['errorCode'];
  if (
    errorCode !== undefined &&
    (typeof errorCode !== 'string' || !(FAILURE_CODES as readonly string[]).includes(errorCode))
  ) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'errorCode', reason: 'OUT_OF_RANGE' }],
    };
  }
  const operationalState = safe['operationalState'];
  if (
    operationalState !== undefined &&
    (typeof operationalState !== 'string' ||
      !(OPERATIONAL_STATES as readonly string[]).includes(operationalState))
  ) {
    return {
      ok: false,
      observation: null,
      issues: [{ field: 'operationalState', reason: 'OUT_OF_RANGE' }],
    };
  }

  const observation: TransportObservation = {
    observationId: observationId as string,
    observedAt: observedAt as number,
    kind: kind as ObservationKind,
    traceId: traceId as string,
    complianceClaim: OBSERVATION_COMPLIANCE_CLAIM,
    certificationClaim: OBSERVATION_CERTIFICATION_CLAIM,
    ...(safe as Omit<
      TransportObservation,
      'observationId' | 'observedAt' | 'kind' | 'traceId' | 'complianceClaim' | 'certificationClaim'
    >),
  };

  return { ok: true, observation, issues: [] };
}

/** Hub-minted trace identity shape. */
export const TRACE_ID_PATTERN = /^trc_[0-9a-f]{32}$/;
/** Observation identity shape. */
export const OBSERVATION_ID_PATTERN = /^obs_[0-9a-f]{32}$/;

/** Mint an opaque observation identifier. */
export function newObservationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `obs_${hex}`;
}

/**
 * Static guard: assert a vocabulary contains no compliance word. Used by tests
 * and by the health module so a future edit cannot quietly introduce
 * `COMPLIANT` as an operational state.
 */
export function assertNoComplianceVocabulary(words: readonly string[]): void {
  for (const word of words) {
    if ((FORBIDDEN_STATE_WORDS as readonly string[]).includes(word.toUpperCase())) {
      throw new Error(`FORBIDDEN_OPERATIONAL_VOCABULARY: ${word}`);
    }
  }
}

/** True when a value is a legitimate transport observation (shape check). */
export function isTransportObservation(value: unknown): value is TransportObservation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['observationId'] === 'string' &&
    typeof candidate['traceId'] === 'string' &&
    typeof candidate['observedAt'] === 'number' &&
    candidate['complianceClaim'] === OBSERVATION_COMPLIANCE_CLAIM &&
    candidate['certificationClaim'] === OBSERVATION_CERTIFICATION_CLAIM
  );
}
