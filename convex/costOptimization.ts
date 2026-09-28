// Cost & Usage Guard — anomalies, optimization decisions, cache/batch/retry
// savings, and cost-export receipts.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Reads enforce the
// caller's server-derived scope: a row bound to a connector is authorized
// through the owning service, a row bound to a system is authorized through
// system scope, and a row bound to neither is visible only under an explicit
// global grant. All writes are privileged internal mutations. Money is integer
// minor units. Protected/regulated responses are never cached unless the cache
// is tenant-scoped.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  anomalyStatusValidator,
  classificationValidator,
  costExportTargetValidator,
  costFailureClassValidator,
  optimizationKindValidator,
} from './lib/validators';
import {
  requireAuthorizationContext,
  requireConnectorScope,
  requireGlobal,
  requireRole,
  requireSystemScope,
  type AuthorizationContext,
} from './lib/authz';
import { costAnomalyDoc, costExportReceiptDoc, optimizationDecisionDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import {
  computeBatchSavingsMinor,
  computeCacheSavingsMinor,
  computeDeviationPct,
  computeRetryWasteMinor,
} from './lib/cost';
import { writeAuditEvent } from './lib/audit';
import type { QueryCtx, MutationCtx } from './_generated/server';

type ScopedRow = { connectorId?: string; systemId?: string };

/**
 * Enforce scope for a cost-optimization row. A connector-bound row is
 * authorized through the owning service; a system-bound row through system
 * scope; a row bound to neither requires an explicit global grant.
 */
async function requireOptimizationScope(
  ctx: QueryCtx | MutationCtx,
  authz: AuthorizationContext,
  row: ScopedRow,
): Promise<void> {
  if (authz.global) return;
  if (row.connectorId !== undefined) {
    await requireConnectorScope(ctx, authz, row.connectorId);
    return;
  }
  if (row.systemId !== undefined) {
    requireSystemScope(authz, row.systemId);
    return;
  }
  requireGlobal(authz);
}

async function filterByOptimizationScope<T extends ScopedRow>(
  ctx: QueryCtx | MutationCtx,
  authz: AuthorizationContext,
  rows: readonly T[],
): Promise<T[]> {
  if (authz.global) return [...rows];
  const result: T[] = [];
  for (const row of rows) {
    try {
      await requireOptimizationScope(ctx, authz, row);
      result.push(row);
    } catch {
      // Not authorized for this row's scope: drop it (fail closed).
    }
  }
  return result;
}

// --- Cost anomalies ----------------------------------------------------------

export const listAnomalies = internalQuery({
  args: { status: anomalyStatusValidator, limit: v.optional(v.number()) },
  returns: v.array(costAnomalyDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('costAnomalies')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .take(limit);
    return await filterByOptimizationScope(ctx, authz, rows);
  },
});

export const detectAnomaly = internalMutation({
  args: {
    vendorId: v.string(),
    connectorId: v.optional(v.string()),
    systemId: v.optional(v.string()),
    billingPeriod: v.string(),
    expectedMinor: v.number(),
    observedMinor: v.number(),
    currency: v.string(),
    thresholdPct: v.number(),
    actor: v.string(),
  },
  returns: v.union(
    v.object({ detected: v.literal(false), deviationPct: v.number() }),
    v.object({ detected: v.literal(true), anomalyId: v.string(), deviationPct: v.number() }),
  ),
  handler: async (ctx, args) => {
    const deviationPct = computeDeviationPct(args.expectedMinor, args.observedMinor);
    if (Math.abs(deviationPct) < args.thresholdPct) {
      return { detected: false as const, deviationPct };
    }
    const anomalyId = newId('anm');
    await ctx.db.insert('costAnomalies', {
      anomalyId,
      vendorId: args.vendorId,
      ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
      ...(args.systemId !== undefined ? { systemId: args.systemId } : {}),
      billingPeriod: args.billingPeriod,
      expectedMinor: args.expectedMinor,
      observedMinor: args.observedMinor,
      currency: args.currency,
      deviationPct,
      status: 'OPEN',
      detectedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: args.actor,
      action: 'cost.anomaly.detected',
      targetType: 'costAnomaly',
      targetId: anomalyId,
      outcome: 'SUCCESS',
      metadata: {
        anomalyId,
        vendorId: args.vendorId,
        ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
        billingPeriod: args.billingPeriod,
        status: 'OPEN',
      },
    });
    return { detected: true as const, anomalyId, deviationPct };
  },
});

// --- Optimization decisions --------------------------------------------------

export const listOptimizationDecisions = internalQuery({
  args: { kind: optimizationKindValidator, limit: v.optional(v.number()) },
  returns: v.array(optimizationDecisionDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('optimizationDecisions')
      .withIndex('by_kind', (q) => q.eq('kind', args.kind))
      .take(limit);
    return await filterByOptimizationScope(ctx, authz, rows);
  },
});

export const recordOptimizationDecision = internalMutation({
  args: {
    kind: optimizationKindValidator,
    connectorId: v.optional(v.string()),
    vendorId: v.optional(v.string()),
    systemId: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    estimatedSavingsMinor: v.number(),
    currency: v.string(),
    applied: v.boolean(),
    reason: v.string(),
    actor: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.estimatedSavingsMinor) || args.estimatedSavingsMinor < 0) {
      fail('VALIDATION_FAILED', 'estimatedSavingsMinor must be a non-negative integer.');
    }
    const decisionId = newId('opt');
    await ctx.db.insert('optimizationDecisions', {
      decisionId,
      kind: args.kind,
      ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
      ...(args.vendorId !== undefined ? { vendorId: args.vendorId } : {}),
      ...(args.systemId !== undefined ? { systemId: args.systemId } : {}),
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      estimatedSavingsMinor: args.estimatedSavingsMinor,
      currency: args.currency,
      applied: args.applied,
      reason: args.reason,
      createdAt: Date.now(),
    });
    if (args.applied) {
      await writeAuditEvent(ctx, {
        actor: args.actor,
        action: 'cost.optimization.applied',
        targetType: 'optimizationDecision',
        targetId: decisionId,
        outcome: 'SUCCESS',
        metadata: {
          decisionId,
          action: args.kind,
          savingsMinor: args.estimatedSavingsMinor,
          currency: args.currency,
          ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
          ...(args.vendorId !== undefined ? { vendorId: args.vendorId } : {}),
        },
      });
    }
    return decisionId;
  },
});

// --- Cache usage / savings ---------------------------------------------------

export const recordCacheUsage = internalMutation({
  args: {
    connectorId: v.string(),
    vendorId: v.string(),
    tenantId: v.optional(v.string()),
    cacheKey: v.string(),
    hit: v.boolean(),
    classification: classificationValidator,
    tenantScoped: v.boolean(),
    unitPriceMinor: v.number(),
    correlationId: v.optional(v.string()),
  },
  returns: v.object({ cacheRecordId: v.string(), savingsMinor: v.number() }),
  handler: async (ctx, args) => {
    // Protected/regulated responses may only be cached when the cache is
    // tenant-scoped. Otherwise the cache write is denied.
    if (
      (args.classification === 'PROTECTED' || args.classification === 'REGULATED') &&
      !args.tenantScoped
    ) {
      fail(
        'POLICY_DENIED',
        'Protected/regulated responses may not be cached without tenant scoping.',
        {
          classification: args.classification,
        },
      );
    }
    const savingsMinor = args.hit ? computeCacheSavingsMinor(1, args.unitPriceMinor) : 0;
    const cacheRecordId = newId('cch');
    await ctx.db.insert('cacheUsageRecords', {
      cacheRecordId,
      connectorId: args.connectorId,
      vendorId: args.vendorId,
      ...(args.tenantId !== undefined ? { tenantId: args.tenantId } : {}),
      cacheKey: args.cacheKey,
      hit: args.hit,
      classification: args.classification,
      tenantScoped: args.tenantScoped,
      savingsMinor,
      currency: 'USD',
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      createdAt: Date.now(),
    });
    return { cacheRecordId, savingsMinor };
  },
});

// --- Batch usage / savings ---------------------------------------------------

export const recordBatchUsage = internalMutation({
  args: {
    connectorId: v.string(),
    vendorId: v.string(),
    batchSize: v.number(),
    realtimeEquivalentMinor: v.number(),
    batchedMinor: v.number(),
    currency: v.string(),
    correlationId: v.optional(v.string()),
  },
  returns: v.object({ batchRecordId: v.string(), savingsMinor: v.number() }),
  handler: async (ctx, args) => {
    const savingsMinor = computeBatchSavingsMinor(args.realtimeEquivalentMinor, args.batchedMinor);
    const batchRecordId = newId('bch');
    await ctx.db.insert('batchUsageRecords', {
      batchRecordId,
      connectorId: args.connectorId,
      vendorId: args.vendorId,
      batchSize: args.batchSize,
      realtimeEquivalentMinor: args.realtimeEquivalentMinor,
      batchedMinor: args.batchedMinor,
      savingsMinor,
      currency: args.currency,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      createdAt: Date.now(),
    });
    return { batchRecordId, savingsMinor };
  },
});

// --- Retry waste -------------------------------------------------------------

export const recordRetryWaste = internalMutation({
  args: {
    connectorId: v.string(),
    vendorId: v.string(),
    requestId: v.string(),
    attempts: v.number(),
    failedAttempts: v.number(),
    unitPriceMinor: v.number(),
    currency: v.string(),
    failureClass: costFailureClassValidator,
    correlationId: v.optional(v.string()),
  },
  returns: v.object({ retryRecordId: v.string(), wastedMinor: v.number() }),
  handler: async (ctx, args) => {
    const wastedMinor = computeRetryWasteMinor(args.failedAttempts, args.unitPriceMinor);
    const retryRecordId = newId('rty');
    await ctx.db.insert('retryWasteRecords', {
      retryRecordId,
      connectorId: args.connectorId,
      vendorId: args.vendorId,
      requestId: args.requestId,
      attempts: args.attempts,
      wastedMinor,
      currency: args.currency,
      failureClass: args.failureClass,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      createdAt: Date.now(),
    });
    return { retryRecordId, wastedMinor };
  },
});

// --- Cost export receipts ----------------------------------------------------

export const listExportReceipts = internalQuery({
  args: { target: costExportTargetValidator, limit: v.optional(v.number()) },
  returns: v.array(costExportReceiptDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('costExportReceipts')
      .withIndex('by_target', (q) => q.eq('target', args.target))
      .take(limit);
  },
});

export const recordExportReceipt = internalMutation({
  args: {
    target: costExportTargetValidator,
    billingPeriod: v.string(),
    recordCount: v.number(),
    totalMinor: v.number(),
    currency: v.string(),
    contractVersion: v.string(),
    schemaVersion: v.string(),
    correlationId: v.string(),
    actor: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const exportReceiptId = newId('exp');
    await ctx.db.insert('costExportReceipts', {
      exportReceiptId,
      target: args.target,
      billingPeriod: args.billingPeriod,
      recordCount: args.recordCount,
      totalMinor: args.totalMinor,
      currency: args.currency,
      contractVersion: args.contractVersion,
      schemaVersion: args.schemaVersion,
      correlationId: args.correlationId,
      exportedAt: Date.now(),
    });
    await writeAuditEvent(ctx, {
      actor: args.actor,
      action: 'cost.export.recorded',
      targetType: 'costExportReceipt',
      targetId: exportReceiptId,
      outcome: 'SUCCESS',
      correlationId: args.correlationId,
      metadata: {
        exportReceiptId,
        billingPeriod: args.billingPeriod,
        amountMinor: args.totalMinor,
        currency: args.currency,
        contractVersion: args.contractVersion,
        schemaVersion: args.schemaVersion,
      },
    });
    return exportReceiptId;
  },
});
