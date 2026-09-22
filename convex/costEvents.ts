// Cost & Usage Guard — usage records and authoritative cost events.
//
// API Hub is the AUTHORITATIVE source for external API / connector charges.
// Exactly one authoritative charge may exist per `costEventId`, and a repeated
// `idempotencyKey` must never produce a second charge. Recording is a
// privileged internal operation; reads are public queries guarded by role.
//
// Every cost event carries the shared cross-hub identifiers (correlation ID,
// causation ID, idempotency key, cost-event ID, source-system ID, tenant /
// customer scope where authorized, contract + schema version) so the same
// external charge is never counted twice by AI Hub or REGIVANTA.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { costStatusValidator, sourceHubValidator, usageUnitValidator } from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import { computeCostMinor } from './lib/cost';

export const getCostEvent = query({
  args: { costEventId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('apiCostEvents')
      .withIndex('by_costEventId', (q) => q.eq('costEventId', args.costEventId))
      .first();
  },
});

export const listByVendorPeriod = query({
  args: { vendorId: v.string(), billingPeriod: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('apiCostEvents')
      .withIndex('by_vendorId_billingPeriod', (q) =>
        q.eq('vendorId', args.vendorId).eq('billingPeriod', args.billingPeriod),
      )
      .take(limit);
  },
});

export const listByConnectorPeriod = query({
  args: { connectorId: v.string(), billingPeriod: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('apiCostEvents')
      .withIndex('by_connectorId_billingPeriod', (q) =>
        q.eq('connectorId', args.connectorId).eq('billingPeriod', args.billingPeriod),
      )
      .take(limit);
  },
});

export const listByCorrelation = query({
  args: { correlationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('apiCostEvents')
      .withIndex('by_correlationId', (q) => q.eq('correlationId', args.correlationId))
      .take(limit);
  },
});

export const listUsageByConnectorPeriod = query({
  args: { connectorId: v.string(), billingPeriod: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('apiUsageRecords')
      .withIndex('by_connectorId_billingPeriod', (q) =>
        q.eq('connectorId', args.connectorId).eq('billingPeriod', args.billingPeriod),
      )
      .take(limit);
  },
});

/** Record a raw usage measurement (quantity only, no money). */
export const recordUsage = internalMutation({
  args: {
    requestId: v.string(),
    vendorId: v.string(),
    connectorId: v.string(),
    systemId: v.string(),
    serviceId: v.string(),
    tenantId: v.optional(v.string()),
    customerRef: v.optional(v.string()),
    quantity: v.number(),
    unitType: usageUnitValidator,
    correlationId: v.string(),
    causationId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    billingPeriod: v.string(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.quantity) || args.quantity < 0) {
      fail('VALIDATION_FAILED', 'quantity must be a non-negative integer.');
    }
    const usageId = newId('usg');
    await ctx.db.insert('apiUsageRecords', {
      usageId,
      requestId: args.requestId,
      vendorId: args.vendorId,
      connectorId: args.connectorId,
      systemId: args.systemId,
      serviceId: args.serviceId,
      ...(args.tenantId !== undefined ? { tenantId: args.tenantId } : {}),
      ...(args.customerRef !== undefined ? { customerRef: args.customerRef } : {}),
      quantity: args.quantity,
      unitType: args.unitType,
      correlationId: args.correlationId,
      ...(args.causationId !== undefined ? { causationId: args.causationId } : {}),
      ...(args.idempotencyKey !== undefined ? { idempotencyKey: args.idempotencyKey } : {}),
      billingPeriod: args.billingPeriod,
      recordedAt: Date.now(),
    });
    return usageId;
  },
});

/**
 * Record an authoritative cost event.
 *
 * Deduplication is enforced on BOTH `costEventId` and `idempotencyKey`:
 *   * A repeated `costEventId` is rejected as a duplicate (one authoritative
 *     charge per cost-event ID).
 *   * A repeated `idempotencyKey` with the same cost-event ID is an idempotent
 *     replay (returns DUPLICATE, no second charge).
 *   * A repeated `idempotencyKey` bound to a different cost-event ID is a
 *     conflict and is rejected.
 *
 * The amount is computed from the effective vendor price version and stored as
 * integer minor units. The caller supplies the pricingVersionId that applied
 * when the request occurred; historical usage is never recomputed.
 */
export const recordCostEvent = internalMutation({
  args: {
    costEventId: v.string(),
    sourceHub: sourceHubValidator,
    eventVersion: v.string(),
    schemaVersion: v.string(),
    vendorId: v.string(),
    connectorId: v.string(),
    systemId: v.string(),
    serviceId: v.string(),
    tenantId: v.optional(v.string()),
    customerRef: v.optional(v.string()),
    correlationId: v.string(),
    causationId: v.optional(v.string()),
    idempotencyKey: v.string(),
    requestId: v.string(),
    quantity: v.number(),
    unitType: usageUnitValidator,
    unitPriceMinor: v.number(),
    currency: v.string(),
    pricingVersionId: v.string(),
    costStatus: costStatusValidator,
    calculationVersion: v.string(),
    effectiveDate: v.number(),
    auditRef: v.string(),
    billingPeriod: v.string(),
  },
  handler: async (ctx, args) => {
    // One authoritative charge per cost-event ID.
    const byCostEvent = await ctx.db
      .query('apiCostEvents')
      .withIndex('by_costEventId', (q) => q.eq('costEventId', args.costEventId))
      .first();
    if (byCostEvent) {
      return { status: 'DUPLICATE' as const, costEventId: byCostEvent.costEventId };
    }

    // Idempotency: same key + same cost-event ID is a replay; different ID is a conflict.
    const byIdempotency = await ctx.db
      .query('apiCostEvents')
      .withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', args.idempotencyKey))
      .first();
    if (byIdempotency) {
      if (byIdempotency.costEventId === args.costEventId) {
        return { status: 'DUPLICATE' as const, costEventId: byIdempotency.costEventId };
      }
      fail('IDEMPOTENCY_CONFLICT', 'Idempotency key is bound to a different cost event.', {
        idempotencyKey: args.idempotencyKey,
      });
    }

    const amountMinor = computeCostMinor(args.quantity, args.unitPriceMinor);

    await ctx.db.insert('apiCostEvents', {
      costEventId: args.costEventId,
      sourceHub: args.sourceHub,
      eventVersion: args.eventVersion,
      schemaVersion: args.schemaVersion,
      vendorId: args.vendorId,
      connectorId: args.connectorId,
      systemId: args.systemId,
      serviceId: args.serviceId,
      ...(args.tenantId !== undefined ? { tenantId: args.tenantId } : {}),
      ...(args.customerRef !== undefined ? { customerRef: args.customerRef } : {}),
      correlationId: args.correlationId,
      ...(args.causationId !== undefined ? { causationId: args.causationId } : {}),
      idempotencyKey: args.idempotencyKey,
      requestId: args.requestId,
      quantity: args.quantity,
      unitType: args.unitType,
      amountMinor,
      currency: args.currency,
      pricingVersionId: args.pricingVersionId,
      costStatus: args.costStatus,
      calculationVersion: args.calculationVersion,
      effectiveDate: args.effectiveDate,
      auditRef: args.auditRef,
      billingPeriod: args.billingPeriod,
      createdAt: Date.now(),
    });
    return { status: 'RECORDED' as const, costEventId: args.costEventId, amountMinor };
  },
});
