// Cost & Usage Guard — usage records and authoritative cost events.
//
// API Hub is the AUTHORITATIVE source for external API / connector charges.
// Exactly one authoritative charge may exist per `costEventId`, and a repeated
// `idempotencyKey` must never produce a second charge.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Cost and usage data is
// the most sensitive cross-tenant surface in the platform, so every read
// enforces the caller's server-derived SERVICE scope AND, when the row carries
// them, its TENANT and CUSTOMER scope. A lookup by cost-event ID, correlation
// ID, connector, or vendor period can never cross an authorization boundary.
// Recording is a privileged internal operation.
//
// Every cost event carries the shared cross-hub identifiers (correlation ID,
// causation ID, idempotency key, cost-event ID, source-system ID, tenant /
// customer scope where authorized, contract + schema version) so the same
// external charge is never counted twice by AI Hub or REGIVANTA.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { costStatusValidator, sourceHubValidator, usageUnitValidator } from './lib/validators';
import {
  canAccessService,
  requireAuthorizationContext,
  type AuthorizationContext,
} from './lib/authz';
import { apiCostEventDoc, apiUsageRecordDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import { computeCostMinor } from './lib/cost';

type ScopedRow = { serviceId: string; tenantId?: string; customerRef?: string };

/**
 * True when the caller may see a cost/usage row. Requires service scope, and
 * additionally tenant and customer scope when the row carries those fields.
 */
function canAccessCostRow(authz: AuthorizationContext, row: ScopedRow): boolean {
  if (authz.global) return true;
  if (!canAccessService(authz, row.serviceId)) return false;
  if (row.tenantId !== undefined && !authz.tenantIds.has(row.tenantId)) return false;
  if (row.customerRef !== undefined && !authz.customerRefs.has(row.customerRef)) return false;
  return true;
}

export const getCostEvent = internalQuery({
  args: { costEventId: v.string() },
  returns: v.union(apiCostEventDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const record = await ctx.db
      .query('apiCostEvents')
      .withIndex('by_costEventId', (q) => q.eq('costEventId', args.costEventId))
      .first();
    if (record === null) return null;
    if (!canAccessCostRow(authz, record)) {
      fail('FORBIDDEN', 'The caller is not authorized for this cost event.', {
        costEventId: args.costEventId,
      });
    }
    return record;
  },
});

export const listByVendorPeriod = internalQuery({
  args: { vendorId: v.string(), billingPeriod: v.string(), limit: v.optional(v.number()) },
  returns: v.array(apiCostEventDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('apiCostEvents')
      .withIndex('by_vendorId_billingPeriod', (q) =>
        q.eq('vendorId', args.vendorId).eq('billingPeriod', args.billingPeriod),
      )
      .take(limit);
    return rows.filter((row) => canAccessCostRow(authz, row));
  },
});

export const listByConnectorPeriod = internalQuery({
  args: { connectorId: v.string(), billingPeriod: v.string(), limit: v.optional(v.number()) },
  returns: v.array(apiCostEventDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('apiCostEvents')
      .withIndex('by_connectorId_billingPeriod', (q) =>
        q.eq('connectorId', args.connectorId).eq('billingPeriod', args.billingPeriod),
      )
      .take(limit);
    return rows.filter((row) => canAccessCostRow(authz, row));
  },
});

export const listByCorrelation = internalQuery({
  args: { correlationId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(apiCostEventDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('apiCostEvents')
      .withIndex('by_correlationId', (q) => q.eq('correlationId', args.correlationId))
      .take(limit);
    return rows.filter((row) => canAccessCostRow(authz, row));
  },
});

export const listUsageByConnectorPeriod = internalQuery({
  args: { connectorId: v.string(), billingPeriod: v.string(), limit: v.optional(v.number()) },
  returns: v.array(apiUsageRecordDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('apiUsageRecords')
      .withIndex('by_connectorId_billingPeriod', (q) =>
        q.eq('connectorId', args.connectorId).eq('billingPeriod', args.billingPeriod),
      )
      .take(limit);
    return rows.filter((row) => canAccessCostRow(authz, row));
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
  returns: v.string(),
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
  returns: v.union(
    v.object({ status: v.literal('DUPLICATE'), costEventId: v.string() }),
    v.object({
      status: v.literal('RECORDED'),
      costEventId: v.string(),
      amountMinor: v.number(),
    }),
  ),
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
