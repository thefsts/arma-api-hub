// ARMA API Hub — Cost & Usage Guard contracts.
//
// These contracts define the normalized cost-event surface shared across hubs.
// They are the ONLY sanctioned way for API Hub to describe external API /
// connector usage and cost to FSTS AI Hub and REGIVANTA.
//
// OWNERSHIP BOUNDARY (locked):
//   * API Hub is the AUTHORITATIVE source for external API / connector charges.
//   * AI Hub references an API Hub cost event; it never emits a second
//     authoritative vendor charge and never recalculates the vendor amount.
//   * REGIVANTA owns allocation, margin, profitability, and company-wide
//     budgets. API Hub never emits profit, margin, MRR, ARR, or company-wide
//     operating-cost fields.
//
// MONEY: amounts are INTEGER MINOR CURRENCY UNITS. Floating point is never used
// for money. Every amount records currency, quantity, unit type, pricing source
// version, effective date, calculation version, and estimated/finalized status.
//
// SECURITY: these contracts never carry vendor credentials, raw private keys,
// plaintext secrets, full protected payloads, or AI prompts / model reasoning.

import { z } from 'zod';
import {
  correlationIdSchema,
  idempotencyKeySchema,
  opaqueIdSchema,
  schemaVersionSchema,
  serviceIdSchema,
  timestampSchema,
} from './primitives.js';

/** Integer minor currency units (e.g. cents). Never a float. */
export const minorUnitsSchema = z
  .number()
  .int('monetary amounts must be integer minor units')
  .nonnegative('monetary amounts must be non-negative');

/** ISO-4217 currency code. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO-4217 code');

/** Usage unit vocabulary. */
export const usageUnitSchema = z.enum([
  'REQUEST',
  'TOKEN',
  'BYTE',
  'SECOND',
  'CALL',
  'DELIVERY',
  'RETRY',
  'STORAGE_BYTE_MONTH',
]);

/** Whether a cost amount is an estimate or finalized. */
export const costStatusSchema = z.enum(['ESTIMATED', 'FINALIZED']);

/** The hub that authored a cost event. */
export const sourceHubSchema = z.enum(['ARMA_API_HUB', 'FSTS_AI_HUB', 'REGIVANTA']);

/** Billing period, `YYYY-MM`. */
export const billingPeriodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'billingPeriod must be YYYY-MM');

/** Opaque cost-event identifier. */
export const costEventIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/, 'costEventId must be opaque');

/** Threshold status vocabulary. */
export const thresholdStatusSchema = z.enum(['OK', 'WARNING', 'THROTTLED', 'BLOCKED']);

/**
 * Shared cost-event envelope. Every normalized cost event carries these fields
 * so the same external charge is never counted twice across hubs.
 */
export const costEventEnvelopeSchema = z.strictObject({
  costEventId: costEventIdSchema,
  sourceHub: sourceHubSchema,
  eventVersion: schemaVersionSchema,
  schemaVersion: schemaVersionSchema,
  vendorId: opaqueIdSchema,
  connectorId: opaqueIdSchema,
  systemId: opaqueIdSchema,
  serviceId: serviceIdSchema,
  tenantId: opaqueIdSchema.optional(),
  customerRef: opaqueIdSchema.optional(),
  correlationId: correlationIdSchema,
  causationId: correlationIdSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  requestId: opaqueIdSchema,
  quantity: z.number().int().nonnegative(),
  unitType: usageUnitSchema,
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  pricingVersionId: opaqueIdSchema,
  costStatus: costStatusSchema,
  calculationVersion: schemaVersionSchema,
  effectiveDate: timestampSchema,
  auditRef: opaqueIdSchema,
  billingPeriod: billingPeriodSchema,
  eventTimestamp: timestampSchema,
});

// --- 1. apiHub.apiUsageRecorded ---------------------------------------------

export const apiUsageRecordedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.apiUsageRecorded'),
});

// --- 2. apiHub.apiCostRecorded ----------------------------------------------

export const apiCostRecordedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.apiCostRecorded'),
  pricingSource: z.string().min(1).max(128),
});

// --- 3. apiHub.retryWasteRecorded -------------------------------------------

export const retryWasteRecordedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.retryWasteRecorded'),
  attempts: z.number().int().positive(),
  failedAttempts: z.number().int().nonnegative(),
  failureClass: z.enum(['TRANSIENT', 'PERMANENT', 'TIMEOUT', 'RATE_LIMITED', 'UNKNOWN']),
});

// --- 4. apiHub.cacheSavingsRecorded -----------------------------------------

export const cacheSavingsRecordedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.cacheSavingsRecorded'),
  cacheHits: z.number().int().nonnegative(),
  tenantScoped: z.boolean(),
});

// --- 5. apiHub.batchSavingsRecorded -----------------------------------------

export const batchSavingsRecordedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.batchSavingsRecorded'),
  batchSize: z.number().int().positive(),
  realtimeEquivalentMinor: minorUnitsSchema,
});

// --- 6. apiHub.quotaThresholdReached ----------------------------------------

export const quotaThresholdReachedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.quotaThresholdReached'),
  quotaId: opaqueIdSchema,
  scope: z.string().min(1).max(64),
  limitQuantity: z.number().int().nonnegative(),
  consumedQuantity: z.number().int().nonnegative(),
  thresholdStatus: thresholdStatusSchema,
});

// --- 7. apiHub.budgetThresholdReached ---------------------------------------

export const budgetThresholdReachedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.budgetThresholdReached'),
  budgetId: opaqueIdSchema,
  scope: z.string().min(1).max(64),
  limitMinor: minorUnitsSchema,
  consumedMinor: minorUnitsSchema,
  thresholdStatus: thresholdStatusSchema,
});

// --- 8. apiHub.costAnomalyDetected ------------------------------------------

export const costAnomalyDetectedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.costAnomalyDetected'),
  anomalyId: opaqueIdSchema,
  expectedMinor: minorUnitsSchema,
  observedMinor: minorUnitsSchema,
  deviationPct: z.number(),
});

// --- 9. apiHub.connectorSpendBlocked ----------------------------------------

export const connectorSpendBlockedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.connectorSpendBlocked'),
  limitId: opaqueIdSchema,
  limitMinor: minorUnitsSchema,
  consumedMinor: minorUnitsSchema,
  action: z.enum(['WARN', 'THROTTLE', 'BLOCK']),
  thresholdStatus: thresholdStatusSchema,
});

// --- 10. apiHub.vendorShutdownActivated -------------------------------------

export const vendorShutdownActivatedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.vendorShutdownActivated'),
  shutdownId: opaqueIdSchema,
  reason: z.string().min(3).max(256),
  activatedBy: opaqueIdSchema,
});

// --- 11. apiHub.costExported ------------------------------------------------

export const costExportedSchema = costEventEnvelopeSchema.extend({
  eventType: z.literal('apiHub.costExported'),
  exportReceiptId: opaqueIdSchema,
  target: z.enum(['REGIVANTA', 'AI_HUB']),
  recordCount: z.number().int().nonnegative(),
  contractVersion: schemaVersionSchema,
});

/** All 11 normalized cost-event schemas, keyed by event type. */
export const COST_EVENT_SCHEMAS = {
  'apiHub.apiUsageRecorded': apiUsageRecordedSchema,
  'apiHub.apiCostRecorded': apiCostRecordedSchema,
  'apiHub.retryWasteRecorded': retryWasteRecordedSchema,
  'apiHub.cacheSavingsRecorded': cacheSavingsRecordedSchema,
  'apiHub.batchSavingsRecorded': batchSavingsRecordedSchema,
  'apiHub.quotaThresholdReached': quotaThresholdReachedSchema,
  'apiHub.budgetThresholdReached': budgetThresholdReachedSchema,
  'apiHub.costAnomalyDetected': costAnomalyDetectedSchema,
  'apiHub.connectorSpendBlocked': connectorSpendBlockedSchema,
  'apiHub.vendorShutdownActivated': vendorShutdownActivatedSchema,
  'apiHub.costExported': costExportedSchema,
} as const;

export type CostEventType = keyof typeof COST_EVENT_SCHEMAS;

// --- AI Hub handoff contract -------------------------------------------------

/**
 * AI Hub -> API Hub cost reference.
 *
 * AI Hub associates an API Hub cost event with an AI execution. It REFERENCES
 * the authoritative API Hub cost event and MUST NOT duplicate or recalculate
 * the vendor charge — therefore this contract carries NO monetary amount.
 *
 * API Hub never requires access to prompts, model reasoning, raw RAG content,
 * or AI conversation content; none of those fields exist here.
 */
export const aiExecutionCostReferenceSchema = z.strictObject({
  referenceId: opaqueIdSchema,
  /** Authoritative API Hub cost event being referenced. */
  apiHubCostEventId: costEventIdSchema,
  aiExecutionId: opaqueIdSchema,
  agentId: opaqueIdSchema.optional(),
  workflowId: opaqueIdSchema.optional(),
  toolInvocationId: opaqueIdSchema.optional(),
  correlationId: correlationIdSchema,
  causationId: correlationIdSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  sourceHub: z.literal('FSTS_AI_HUB'),
  schemaVersion: schemaVersionSchema,
  referencedAt: timestampSchema,
});

// --- REGIVANTA export contract ----------------------------------------------

/**
 * A single normalized cost record exported to REGIVANTA. It carries measured
 * API/vendor usage and cost only. It never carries allocation rules, margin,
 * profitability, or company-wide budget fields — those belong to REGIVANTA.
 */
export const costExportRecordSchema = z.strictObject({
  costEventId: costEventIdSchema,
  sourceHub: sourceHubSchema,
  vendorId: opaqueIdSchema,
  connectorId: opaqueIdSchema,
  systemId: opaqueIdSchema,
  serviceId: serviceIdSchema,
  tenantId: opaqueIdSchema.optional(),
  customerRef: opaqueIdSchema.optional(),
  correlationId: correlationIdSchema,
  causationId: correlationIdSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
  quantity: z.number().int().nonnegative(),
  unitType: usageUnitSchema,
  amountMinor: minorUnitsSchema,
  currency: currencySchema,
  pricingVersionId: opaqueIdSchema,
  costStatus: costStatusSchema,
  billingPeriod: billingPeriodSchema,
  effectiveDate: timestampSchema,
  auditRef: opaqueIdSchema,
  schemaVersion: schemaVersionSchema,
});

/** Normalized cost-export envelope delivered to REGIVANTA. */
export const costExportEnvelopeSchema = z.strictObject({
  exportId: opaqueIdSchema,
  target: z.literal('REGIVANTA'),
  contractVersion: schemaVersionSchema,
  schemaVersion: schemaVersionSchema,
  billingPeriod: billingPeriodSchema,
  generatedAt: timestampSchema,
  correlationId: correlationIdSchema,
  records: z.array(costExportRecordSchema),
  totalMinor: minorUnitsSchema,
  currency: currencySchema,
});

export type CostEventEnvelope = z.infer<typeof costEventEnvelopeSchema>;
export type ApiUsageRecorded = z.infer<typeof apiUsageRecordedSchema>;
export type ApiCostRecorded = z.infer<typeof apiCostRecordedSchema>;
export type RetryWasteRecorded = z.infer<typeof retryWasteRecordedSchema>;
export type CacheSavingsRecorded = z.infer<typeof cacheSavingsRecordedSchema>;
export type BatchSavingsRecorded = z.infer<typeof batchSavingsRecordedSchema>;
export type QuotaThresholdReached = z.infer<typeof quotaThresholdReachedSchema>;
export type BudgetThresholdReached = z.infer<typeof budgetThresholdReachedSchema>;
export type CostAnomalyDetected = z.infer<typeof costAnomalyDetectedSchema>;
export type ConnectorSpendBlocked = z.infer<typeof connectorSpendBlockedSchema>;
export type VendorShutdownActivated = z.infer<typeof vendorShutdownActivatedSchema>;
export type CostExported = z.infer<typeof costExportedSchema>;
export type AiExecutionCostReference = z.infer<typeof aiExecutionCostReferenceSchema>;
export type CostExportRecord = z.infer<typeof costExportRecordSchema>;
export type CostExportEnvelope = z.infer<typeof costExportEnvelopeSchema>;
