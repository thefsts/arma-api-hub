// ARMA API Hub — observability contracts.
//
// Runtime-validated shapes for the Phase 9 production operations layer. These
// are the wire/database contracts; `@arma/observability` holds the pure
// behaviour (trace minting, health derivation, SLO computation, retention).
//
// HONESTY: every observation contract carries complianceClaim=NONE and
// certificationClaim=NONE. A transport observation is never a verdict.

import { z } from 'zod';
import { dataClassificationSchema, environmentSchema, opaqueIdSchema } from './primitives.js';

// Re-exported so observability consumers get the canonical primitives from this
// module without duplicating the definitions (a duplicate export would create
// an ambiguous `export *` surface in `index.ts`).
export { dataClassificationSchema, environmentSchema };

/** The published 18-code failure taxonomy. */
export const failureCodeSchema = z.enum([
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
]);

export const failureClassSchema = z.enum(['CLEAN_RETRYABLE', 'AMBIGUOUS', 'TERMINAL']);

export const observationKindSchema = z.enum([
  'REQUEST',
  'RESPONSE',
  'HOP',
  'FAILURE',
  'RETRY',
  'REPLAY',
  'RATELIMIT',
  'HEALTH',
  'COST',
]);

export const hopSchema = z.enum(['PRODUCT_TO_HUB', 'HUB_TO_CORE', 'CORE_TO_HUB', 'HUB_TO_PRODUCT']);

export const outcomeSchema = z.enum([
  'ALLOWED',
  'DENIED',
  'DELIVERED',
  'FAILED',
  'TIMEOUT',
  'UNKNOWN',
]);

/** Exactly four operational states. Never COMPLIANT/CERTIFIED/SECURE. */
export const operationalStateSchema = z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN']);

export const dependencyTypeSchema = z.enum(['CORE', 'PRODUCT', 'CONNECTOR', 'WEBHOOK']);

export const traceIdSchema = z
  .string()
  .regex(/^trc_[0-9a-f]{32}$/, 'traceId must be a Hub-minted trace identifier');

export const observationIdSchema = z
  .string()
  .regex(/^obs_[0-9a-f]{32}$/, 'observationId must be an observation identifier');

/** The canonical transport observation contract. Strict: unknown keys reject. */
export const transportObservationSchema = z
  .object({
    observationId: observationIdSchema,
    observedAt: z.number().int().positive(),
    kind: observationKindSchema,
    traceId: traceIdSchema,
    callerCorrelationRef: opaqueIdSchema.optional(),
    causationId: opaqueIdSchema.optional(),
    productId: opaqueIdSchema.optional(),
    tenantId: opaqueIdSchema.optional(),
    environment: environmentSchema.optional(),
    serviceId: opaqueIdSchema.optional(),
    hubRoutingIdentity: opaqueIdSchema.optional(),
    operation: z.string().min(1).max(200).optional(),
    scope: z.string().min(1).max(200).optional(),
    contractVersion: z.string().min(1).max(40).optional(),
    apiVersion: z.string().min(1).max(40).optional(),
    direction: z.enum(['INBOUND', 'OUTBOUND']).optional(),
    hop: hopSchema.optional(),
    outcome: outcomeSchema.optional(),
    errorCode: failureCodeSchema.optional(),
    failureClass: failureClassSchema.optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    latencyMs: z.number().int().min(0).max(600_000).optional(),
    attempt: z.number().int().min(1).max(20).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional(),
    retryable: z.boolean().optional(),
    killSwitchEngaged: z.boolean().optional(),
    replayed: z.boolean().optional(),
    idempotencyMatched: z.boolean().optional(),
    nonceFresh: z.boolean().optional(),
    dependencyId: opaqueIdSchema.optional(),
    dependencyType: dependencyTypeSchema.optional(),
    operationalState: operationalStateSchema.optional(),
    complianceClaim: z.literal('NONE'),
    certificationClaim: z.literal('NONE'),
  })
  .strict();

export type TransportObservationContract = z.infer<typeof transportObservationSchema>;

/** Dependency health snapshot contract. */
export const dependencyHealthSnapshotSchema = z
  .object({
    snapshotId: z.string().min(1).max(128),
    dependencyId: z.string().min(1).max(128),
    dependencyType: dependencyTypeSchema,
    environment: environmentSchema,
    state: operationalStateSchema,
    observedAt: z.number().int().positive(),
    latencyMs: z.number().int().min(0).max(600_000).optional(),
    reason: z.string().min(1).max(200).optional(),
    complianceClaim: z.literal('NONE'),
    certificationClaim: z.literal('NONE'),
  })
  .strict();

/** Internal SLO window contract. */
export const sloWindowSchema = z
  .object({
    windowId: z.string().min(1).max(128),
    windowStart: z.number().int().nonnegative(),
    windowEnd: z.number().int().nonnegative(),
    totalRequests: z.number().int().nonnegative(),
    successRatio: z.number().min(0).max(1),
    latencyP50Ms: z.number().nonnegative(),
    latencyP95Ms: z.number().nonnegative(),
    latencyP99Ms: z.number().nonnegative(),
    availabilityRatio: z.number().min(0).max(1),
    retryRate: z.number().min(0).max(1),
    rateLimitEventRate: z.number().min(0).max(1),
    deadLetterRate: z.number().min(0).max(1),
    targetClass: z.literal('INTERNAL_OPERATIONAL_TARGET'),
    complianceClaim: z.literal('NONE'),
    breaches: z.array(z.string().max(120)),
  })
  .strict();

/** Transport cost reference contract. */
export const transportCostRecordSchema = z
  .object({
    costEventId: z.string().min(1).max(128),
    traceId: traceIdSchema,
    costOwner: z.literal('API_HUB'),
    costCategory: z.enum([
      'EXTERNAL_API',
      'CONNECTOR',
      'WEBHOOK',
      'MESSAGING',
      'TRANSPORT',
      'STORAGE',
    ]),
    amountMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    vendorId: z.string().min(1).max(128).optional(),
    connectorId: z.string().min(1).max(128).optional(),
    billingPeriod: z.string().min(1).max(20),
    recordedAt: z.number().int().positive(),
  })
  .strict();

/** The honesty constants every observability contract must carry. */
export const OBSERVABILITY_HONESTY = {
  complianceClaim: 'NONE',
  certificationClaim: 'NONE',
  targetClass: 'INTERNAL_OPERATIONAL_TARGET',
} as const;
