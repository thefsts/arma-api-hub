// ARMA API Hub — Core boundary adapters (Phase 9 re-baseline).
//
// The Phase 9 re-baseline against Compliance Core main @ 2c8574d found NO
// material contract conflict, but three boundary consequences must be encoded
// so the Hub cannot accidentally become a second compliance authority:
//
//   1. FAILURE CODES. The governed Core taxonomy is 18 codes (17 mandated).
//      Core's Phase 8 onboarding control plane added 8 *implementation* codes
//      (PRODUCT_UNKNOWN, HUB_ROUTE_INVALID, CONTRACT_VERSION_STALE,
//      ROLLOUT_BLOCKED, INTEGRATION_UNHEALTHY, HEALTH_TELEMETRY_INVALID,
//      MANIFEST_INVALID, OFFBOARDING_INVALID) that are NOT part of the governed
//      taxonomy. The Hub never invents a Hub code for them: an unrecognised
//      Core code projects fail-closed to INTERNAL_FAILURE.
//
//   2. HEALTH STATES. Core integration health is HEALTHY/DEGRADED/UNHEALTHY/
//      UNKNOWN. Hub operational state is AVAILABLE/DEGRADED/UNAVAILABLE/UNKNOWN.
//      These are DIFFERENT vocabularies describing DIFFERENT subjects. The
//      mapping is explicit and one-directional. The Hub never submits a derived
//      state to Core — Core requires raw counters only.
//
//   3. COST TELEMETRY. The Hub owns transport cost. A projection to the Core
//      `api-hub-usage-telemetry` handoff shape is a boundary adapter, not a
//      second cost authority.
//
// HONESTY: HEALTHY != COMPLIANT. READY != CERTIFIED. UNKNOWN != HEALTHY.

import {
  FAILURE_CODES,
  RETRYABLE_FAILURE_CODES,
  type FailureCode,
  type OperationalState,
} from './telemetry.js';

// --- 1. Failure-code projection ---------------------------------------------

/**
 * Core Phase 8 onboarding-control-plane implementation codes. These are NOT
 * members of the governed 18-code taxonomy. They are listed here only so the
 * projection can be explicit and auditable — never so the Hub can emit them.
 */
export const CORE_IMPLEMENTATION_ONLY_CODES = [
  'PRODUCT_UNKNOWN',
  'HUB_ROUTE_INVALID',
  'CONTRACT_VERSION_STALE',
  'ROLLOUT_BLOCKED',
  'INTEGRATION_UNHEALTHY',
  'HEALTH_TELEMETRY_INVALID',
  'MANIFEST_INVALID',
  'OFFBOARDING_INVALID',
] as const;

export type CoreImplementationOnlyCode = (typeof CORE_IMPLEMENTATION_ONLY_CODES)[number];

export interface FailureProjection {
  /** The bounded Hub code. Always a member of FAILURE_CODES. */
  readonly code: FailureCode;
  /** True when the inbound Core code was not a governed Hub code. */
  readonly projected: boolean;
  /** True when the inbound value was not a string at all. */
  readonly malformed: boolean;
  /** True when the projected code is retryable. */
  readonly retryable: boolean;
}

/**
 * Project an arbitrary inbound Core failure code onto the Hub's closed
 * 18-code taxonomy. Fail-closed: anything unrecognised becomes
 * INTERNAL_FAILURE. This function NEVER returns a code outside FAILURE_CODES.
 */
export function projectCoreFailureCode(inbound: unknown): FailureProjection {
  if (typeof inbound !== 'string' || inbound.length === 0) {
    return { code: 'INTERNAL_FAILURE', projected: true, malformed: true, retryable: true };
  }
  const upper = inbound.toUpperCase();
  if ((FAILURE_CODES as readonly string[]).includes(upper)) {
    const code = upper as FailureCode;
    return {
      code,
      projected: false,
      malformed: false,
      retryable: RETRYABLE_FAILURE_CODES.includes(code),
    };
  }
  // Includes the 8 Core implementation-only codes and any future Core addition.
  return { code: 'INTERNAL_FAILURE', projected: true, malformed: false, retryable: true };
}

/** True when a code is governed by the published 18-code taxonomy. */
export function isGovernedFailureCode(value: unknown): value is FailureCode {
  return typeof value === 'string' && (FAILURE_CODES as readonly string[]).includes(value);
}

// --- 2. Health-state mapping ------------------------------------------------

/** Core integration-health vocabulary (Core-owned, Phase 8). */
export const CORE_INTEGRATION_HEALTH_STATES = [
  'HEALTHY',
  'DEGRADED',
  'UNHEALTHY',
  'UNKNOWN',
] as const;

export type CoreIntegrationHealthState = (typeof CORE_INTEGRATION_HEALTH_STATES)[number];

/** Core admission decisions (Core-owned, Phase 8). */
export const CORE_HEALTH_ADMISSIONS = ['ALLOW', 'ALLOW_BOUNDED', 'BLOCK'] as const;
export type CoreHealthAdmission = (typeof CORE_HEALTH_ADMISSIONS)[number];

export interface HealthStateMapping {
  /** The Hub operational state for the Hub's own dependency view. */
  readonly hubState: OperationalState;
  /** The Core admission the Hub must assume when it cannot ask Core. */
  readonly assumedAdmission: CoreHealthAdmission;
  /** True when the mapping fails closed (no traffic). */
  readonly failClosed: boolean;
  /** True when the inbound value was not a recognised Core state. */
  readonly unknownInbound: boolean;
}

/**
 * Map a Core integration-health state to the Hub's operational vocabulary.
 *
 * The mapping is deliberately NOT an equality. Core `UNHEALTHY` means the
 * integration is blocked, so the Hub's dependency view is `UNAVAILABLE`. Core
 * `UNKNOWN` and any unrecognised value both map to Hub `UNKNOWN` — which fails
 * closed. `UNKNOWN` never becomes `AVAILABLE`.
 */
export function mapCoreHealthToHubState(inbound: unknown): HealthStateMapping {
  switch (inbound) {
    case 'HEALTHY':
      return {
        hubState: 'AVAILABLE',
        assumedAdmission: 'ALLOW',
        failClosed: false,
        unknownInbound: false,
      };
    case 'DEGRADED':
      return {
        hubState: 'DEGRADED',
        assumedAdmission: 'ALLOW_BOUNDED',
        failClosed: false,
        unknownInbound: false,
      };
    case 'UNHEALTHY':
      return {
        hubState: 'UNAVAILABLE',
        assumedAdmission: 'BLOCK',
        failClosed: true,
        unknownInbound: false,
      };
    case 'UNKNOWN':
      return {
        hubState: 'UNKNOWN',
        assumedAdmission: 'BLOCK',
        failClosed: true,
        unknownInbound: false,
      };
    default:
      return {
        hubState: 'UNKNOWN',
        assumedAdmission: 'BLOCK',
        failClosed: true,
        unknownInbound: true,
      };
  }
}

/**
 * The inverse direction is intentionally NOT provided as a general-purpose
 * function: the Hub must never assert a Core health state. It may only submit
 * RAW COUNTERS. This helper builds that raw-counter payload and refuses to
 * carry a state or source.
 */
export interface RawHealthCounters {
  readonly successCount: number;
  readonly failureCount: number;
  readonly consecutiveFailures: number;
}

export const CORE_HEALTH_WINDOW_SIZE = 20;
export const CORE_MIN_HEALTH_SAMPLES = 5;

export type RawCountersResult =
  | { readonly ok: true; readonly counters: RawHealthCounters }
  | { readonly ok: false; readonly code: 'HEALTH_TELEMETRY_INVALID'; readonly reason: string };

/**
 * Validate and build a raw-counter payload for Core. Rejects any caller-supplied
 * `state` or `source`, a window larger than Core's `HEALTH_WINDOW_SIZE`, and
 * negative counts — mirroring Core's `assertNoCallerAssertedState`.
 */
export function buildRawHealthCounters(input: Record<string, unknown>): RawCountersResult {
  if ('state' in input || 'source' in input) {
    return {
      ok: false,
      code: 'HEALTH_TELEMETRY_INVALID',
      reason: 'CALLER_ASSERTED_STATE_FORBIDDEN',
    };
  }
  const successCount = input['successCount'];
  const failureCount = input['failureCount'];
  const consecutiveFailures = input['consecutiveFailures'];
  for (const [name, value] of [
    ['successCount', successCount],
    ['failureCount', failureCount],
    ['consecutiveFailures', consecutiveFailures],
  ] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return { ok: false, code: 'HEALTH_TELEMETRY_INVALID', reason: `INVALID_${name}` };
    }
  }
  const success = successCount as number;
  const failure = failureCount as number;
  const consecutive = consecutiveFailures as number;
  if (success + failure > CORE_HEALTH_WINDOW_SIZE) {
    return { ok: false, code: 'HEALTH_TELEMETRY_INVALID', reason: 'WINDOW_EXCEEDED' };
  }
  if (consecutive > failure) {
    return { ok: false, code: 'HEALTH_TELEMETRY_INVALID', reason: 'CONSECUTIVE_EXCEEDS_FAILURES' };
  }
  return {
    ok: true,
    counters: { successCount: success, failureCount: failure, consecutiveFailures: consecutive },
  };
}

// --- 3. Usage/cost telemetry boundary projection ----------------------------

/**
 * The Core `api-hub-usage-telemetry` handoff shape (Phase 6, unchanged at
 * Core main @ 2c8574d). The Hub produces this projection at the governed
 * boundary; it does not become the cost authority for the values it forwards.
 */
export interface CoreUsageTelemetryProjection {
  readonly telemetryId: string;
  readonly correlationId: string;
  readonly requestId: string | null;
  readonly tenantId: string;
  readonly productId: string;
  readonly serviceIdentityId: string;
  readonly action: string;
  readonly apiVersion: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly units: ReadonlyArray<{
    readonly unit: 'REQUEST' | 'RESPONSE' | 'COMPUTE' | 'STORAGE';
    readonly quantity: number;
  }>;
  readonly costUnits: number;
  readonly currency: 'USD';
  readonly vendorRef: string | null;
  readonly occurredAt: number;
  readonly recordStatus: 'EXAMPLE' | 'REAL';
}

export interface UsageProjectionInput {
  readonly telemetryId: string;
  readonly correlationId: string;
  readonly requestId?: string | null;
  readonly tenantId: string;
  readonly productId: string;
  readonly serviceIdentityId: string;
  readonly action: string;
  readonly apiVersion: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly costUnits: number;
  readonly vendorRef?: string | null;
  readonly occurredAt: number;
  readonly recordStatus?: 'EXAMPLE' | 'REAL';
}

const CORRELATION_ID_PATTERN = /^[0-9a-f]{32}$/;
const API_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const TELEMETRY_ID_PATTERN = /^TEL-[A-Za-z0-9][A-Za-z0-9-]*$/;

export type UsageProjectionResult =
  | { readonly ok: true; readonly projection: CoreUsageTelemetryProjection }
  | { readonly ok: false; readonly reason: string };

/**
 * Project a Hub transport cost/usage fact into the Core handoff shape. Rejects
 * any value the Core schema would reject, and never emits a vendor secret —
 * `vendorRef` is a reference only.
 */
export function toCoreUsageTelemetry(input: UsageProjectionInput): UsageProjectionResult {
  if (!TELEMETRY_ID_PATTERN.test(input.telemetryId))
    return { ok: false, reason: 'TELEMETRY_ID_INVALID' };
  if (!CORRELATION_ID_PATTERN.test(input.correlationId))
    return { ok: false, reason: 'CORRELATION_ID_INVALID' };
  if (!API_VERSION_PATTERN.test(input.apiVersion))
    return { ok: false, reason: 'API_VERSION_INVALID' };
  if (!Number.isInteger(input.costUnits) || input.costUnits < 0)
    return { ok: false, reason: 'COST_UNITS_INVALID' };
  if (!Number.isInteger(input.occurredAt)) return { ok: false, reason: 'OCCURRED_AT_INVALID' };
  for (const [name, value] of [
    ['tenantId', input.tenantId],
    ['productId', input.productId],
    ['serviceIdentityId', input.serviceIdentityId],
    ['action', input.action],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0)
      return { ok: false, reason: `${name.toUpperCase()}_INVALID` };
  }
  return {
    ok: true,
    projection: {
      telemetryId: input.telemetryId,
      correlationId: input.correlationId,
      requestId: input.requestId ?? null,
      tenantId: input.tenantId,
      productId: input.productId,
      serviceIdentityId: input.serviceIdentityId,
      action: input.action,
      apiVersion: input.apiVersion,
      direction: input.direction,
      units: [
        { unit: 'REQUEST', quantity: 1 },
        { unit: 'RESPONSE', quantity: 1 },
      ],
      costUnits: input.costUnits,
      currency: 'USD',
      vendorRef: input.vendorRef ?? null,
      occurredAt: input.occurredAt,
      recordStatus: input.recordStatus ?? 'REAL',
    },
  };
}
