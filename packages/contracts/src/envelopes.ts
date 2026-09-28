// ARMA API Hub — shared envelope contracts.
//
// These are the versioned, runtime-validated envelopes that every service
// request, event, webhook delivery, and signed receipt travels inside. They
// are the single source of truth for cross-service interoperability.
//
// DESIGN RULES
//  - Every envelope carries an explicit `schemaVersion` so contracts can
//    evolve without breaking consumers.
//  - Every signed service request carries the full signing context: service
//    ID, key ID, timestamp, nonce, body hash, signature metadata, schema
//    version, correlation ID, optional idempotency key, source, destination,
//    and tenant/organization scope.
//  - Envelopes are strict objects: unknown fields are rejected. This prevents
//    silent contract drift and accidental leakage of unexpected fields.
//  - No envelope field may contain raw secret material. Signatures are opaque
//    encoded values; key IDs are references only.

import { z } from 'zod';
import {
  correlationIdSchema,
  dataClassificationSchema,
  idempotencyKeySchema,
  keyIdSchema,
  nonceSchema,
  opaqueIdSchema,
  schemaVersionSchema,
  serviceIdSchema,
  sha256HexSchema,
  signatureMetadataSchema,
  tenantScopeSchema,
  timestampSchema,
} from './primitives.js';

/** Correlation and causation identifiers carried by every envelope. */
export const correlationContextSchema = z.strictObject({
  correlationId: correlationIdSchema,
  causationId: correlationIdSchema.optional(),
});

/** Idempotency metadata. `key` is required for mutating operations. */
export const idempotencyMetadataSchema = z.strictObject({
  key: idempotencyKeySchema,
  /** Hash of the request body the key was first bound to. */
  requestHash: sha256HexSchema,
  /** Optional expiry (epoch ms as decimal string). */
  expiresAt: timestampSchema.optional(),
});

/** Source/destination routing pair. */
export const routingSchema = z.strictObject({
  source: serviceIdSchema,
  destination: serviceIdSchema,
});

/**
 * Service request envelope — the signed envelope for service-to-service calls.
 * A request is only accepted when it is registered, approved, active, and
 * assigned the required scoped capability (enforced by policy, not here).
 */
export const serviceRequestEnvelopeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  /** Unique request identifier. */
  requestId: correlationIdSchema,
  /** Service identity of the caller. */
  serviceId: serviceIdSchema,
  /** Key identifier used to sign (reference only). */
  keyId: keyIdSchema,
  /** Epoch ms the request was signed. */
  timestamp: timestampSchema,
  /** Anti-replay nonce. */
  nonce: nonceSchema,
  /** SHA-256 of the exact raw request body bytes. */
  bodyHash: sha256HexSchema,
  /** Signature metadata (algorithm + key + opaque value). */
  signature: signatureMetadataSchema,
  /** Correlation/causation context. */
  correlation: correlationContextSchema,
  /** Idempotency metadata for mutating operations. */
  idempotency: idempotencyMetadataSchema.optional(),
  /** Routing pair. */
  routing: routingSchema,
  /** Tenant/organization scope where applicable. */
  tenant: tenantScopeSchema.optional(),
  /** Declared data classification of the payload. */
  classification: dataClassificationSchema,
  /** Operation name, e.g. `apiHub.service.register`. */
  operation: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/, 'operation must be dotted'),
});

/**
 * Event envelope — the durable, routable envelope for published events.
 * Events are append-only facts; consumers must be idempotent.
 */
export const eventEnvelopeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  eventId: correlationIdSchema,
  eventType: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/, 'eventType must be dotted'),
  /** Monotonic per-stream sequence number for ordering. */
  sequence: z.number().int().nonnegative(),
  /** Stream identifier (e.g. `tenant:acme:orders`). */
  stream: z.string().min(3).max(200),
  occurredAt: timestampSchema,
  producer: serviceIdSchema,
  correlation: correlationContextSchema,
  tenant: tenantScopeSchema.optional(),
  classification: dataClassificationSchema,
  /** SHA-256 of the canonical event payload. */
  payloadHash: sha256HexSchema,
  /** Optional idempotency key for at-least-once delivery. */
  idempotency: idempotencyMetadataSchema.optional(),
});

/**
 * Webhook delivery envelope — what a subscriber receives. Delivery is
 * at-least-once; subscribers must dedupe on `deliveryId` and `eventId`.
 */
export const webhookDeliveryEnvelopeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  deliveryId: correlationIdSchema,
  eventId: correlationIdSchema,
  eventType: z.string().min(3).max(200),
  /** Attempt number, 1-based. */
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  /** Destination service the webhook is delivered to. */
  destination: serviceIdSchema,
  /** Destination endpoint reference (allow-listed; never a credential). */
  destinationRef: opaqueIdSchema,
  deliveredAt: timestampSchema,
  correlation: correlationContextSchema,
  classification: dataClassificationSchema,
  /** SHA-256 of the exact delivery body bytes. */
  bodyHash: sha256HexSchema,
  signature: signatureMetadataSchema,
});

/**
 * Signed receipt — the verifiable acknowledgement of a delivered request or
 * event. Receipts bind a delivery to its outcome without exposing payloads.
 */
export const signedReceiptSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  receiptId: correlationIdSchema,
  /** The request/event/delivery this receipt acknowledges. */
  subjectId: correlationIdSchema,
  subjectType: z.enum(['SERVICE_REQUEST', 'EVENT', 'WEBHOOK_DELIVERY']),
  /** Terminal outcome. */
  status: z.enum(['ACCEPTED', 'REJECTED', 'DUPLICATE', 'DEAD_LETTERED']),
  accepted: z.boolean(),
  /** SHA-256 of the received body bytes. */
  receivedBodyHash: sha256HexSchema,
  /** SHA-256 of the canonical receipt body (what was signed). */
  receiptHash: sha256HexSchema,
  acceptedAt: timestampSchema,
  /** Issuing service identity. */
  issuer: serviceIdSchema,
  signature: signatureMetadataSchema,
  correlation: correlationContextSchema,
  /** Optional machine-readable reason code when not accepted. */
  reasonCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{2,63}$/)
    .optional(),
});

/**
 * Standard API error — the only error shape returned to callers. Safe context
 * is an allow-listed, scalar-only map; payload content and secrets cannot
 * appear here.
 */
export const apiErrorSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  error: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'error must be an uppercase machine code'),
  errorClass: z.enum([
    'AUTHENTICATION',
    'AUTHORIZATION',
    'VERSION',
    'INPUT',
    'NOT_FOUND',
    'STATE',
    'IDEMPOTENCY',
    'REPLAY',
    'RATE_LIMIT',
    'DOWNSTREAM',
    'PERSISTENCE',
    'TRANSPORT',
    'UNAVAILABLE',
    'POLICY',
  ]),
  message: z.string().max(256).optional(),
  requestId: correlationIdSchema.optional(),
  retryable: z.boolean(),
  /** Allow-listed scalar context only. */
  context: z
    .record(z.string(), z.union([z.string().max(256), z.number(), z.boolean(), z.null()]))
    .optional(),
});

/** Connector health report — per-dependency readiness with fail-closed aggregation. */
export const connectorHealthReportSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  connectorId: serviceIdSchema,
  status: z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']),
  checkedAt: timestampSchema,
  /** Kill-switch state at report time. */
  killSwitchEngaged: z.boolean(),
  dependencies: z.array(
    z.strictObject({
      name: z.string().min(1).max(128),
      criticality: z.enum(['REQUIRED', 'OPTIONAL']),
      status: z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']),
      reasonCode: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]{2,63}$/)
        .optional(),
      latencyMs: z.number().nonnegative().optional(),
    }),
  ),
  correlation: correlationContextSchema.optional(),
});

export type CorrelationContext = z.infer<typeof correlationContextSchema>;
export type IdempotencyMetadata = z.infer<typeof idempotencyMetadataSchema>;
export type Routing = z.infer<typeof routingSchema>;
export type ServiceRequestEnvelope = z.infer<typeof serviceRequestEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type WebhookDeliveryEnvelope = z.infer<typeof webhookDeliveryEnvelopeSchema>;
export type SignedReceipt = z.infer<typeof signedReceiptSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ConnectorHealthReport = z.infer<typeof connectorHealthReportSchema>;
