// Cost & Usage Guard — anomalies, optimization decisions, cache/batch/retry
// savings, and cost-export receipts.
//
// Reads are public queries guarded by role. All writes are privileged internal
// mutations. Money is integer minor units. Protected/regulated responses are
// never cached unless the cache is tenant-scoped.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import {
  anomalyStatusValidator,
  classificationValidator,
  costExportTargetValidator,
  costFailureClassValidator,
  optimizationKindValidator,
} from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import {
  computeBatchSavingsMinor,
  computeCacheSavingsMinor,
  computeDeviationPct,
  computeRetryWasteMinor,
} from './lib/cost';
import { writeAuditEvent } from './lib/audit';

// --- Cost anomalies ----------------------------------------------------------

export const listAnomalies = query({
  args: { status: anomalyStatusValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('costAnomalies')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .take(limit);
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

export const listOptimizationDecisions = query({
  args: { kind: optimizationKindValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('optimizationDecisions')
      .withIndex('by_kind', (q) => q.eq('kind', args.kind))
      .take(limit);
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

export const listExportReceipts = query({
  args: { target: costExportTargetValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
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
