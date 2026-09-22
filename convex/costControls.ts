// Cost & Usage Guard — rate limits, quotas, budgets, spending limits, and
// emergency vendor shutdown controls.
//
// Reads are public queries guarded by role. All state changes are privileged
// internal mutations. Every warning, throttle, block, and shutdown writes an
// audit event in the same transaction.
//
// Money is integer minor units. Threshold evaluation is deterministic (see
// lib/cost.ts). Cost optimization never bypasses tenant isolation,
// authorization, data classification, legal retention, safety controls,
// emergency-event handling, contract compatibility, or audit requirements.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import { evaluateThreshold } from './lib/cost';
import { writeAuditEvent } from './lib/audit';

// --- Rate-limit windows ------------------------------------------------------

export const getRateLimitWindow = query({
  args: { connectorId: v.string(), windowStart: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('rateLimitWindows')
      .withIndex('by_connectorId_windowStart', (q) =>
        q.eq('connectorId', args.connectorId).eq('windowStart', args.windowStart),
      )
      .first();
  },
});

export const consumeRateLimit = internalMutation({
  args: {
    vendorId: v.string(),
    connectorId: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
    limit: v.number(),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.amount) || args.amount < 0) {
      fail('VALIDATION_FAILED', 'amount must be a non-negative integer.');
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('rateLimitWindows')
      .withIndex('by_connectorId_windowStart', (q) =>
        q.eq('connectorId', args.connectorId).eq('windowStart', args.windowStart),
      )
      .first();
    if (existing) {
      const consumed = existing.consumed + args.amount;
      await ctx.db.patch(existing._id, { consumed, updatedAt: now });
      return { consumed, limit: existing.limit, exceeded: consumed > existing.limit };
    }
    const windowId = newId('rlw');
    await ctx.db.insert('rateLimitWindows', {
      windowId,
      vendorId: args.vendorId,
      connectorId: args.connectorId,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      limit: args.limit,
      consumed: args.amount,
      updatedAt: now,
    });
    return { consumed: args.amount, limit: args.limit, exceeded: args.amount > args.limit };
  },
});

// --- Quota allocations -------------------------------------------------------

export const getQuota = query({
  args: { scope: v.string(), scopeId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('quotaAllocations')
      .withIndex('by_scope_scopeId', (q) => q.eq('scope', args.scope).eq('scopeId', args.scopeId))
      .first();
  },
});

export const allocateQuota = internalMutation({
  args: {
    scope: v.string(),
    scopeId: v.string(),
    tenantId: v.optional(v.string()),
    customerRef: v.optional(v.string()),
    connectorId: v.optional(v.string()),
    billingPeriod: v.string(),
    limitQuantity: v.number(),
    unitType: v.union(
      v.literal('REQUEST'),
      v.literal('TOKEN'),
      v.literal('BYTE'),
      v.literal('SECOND'),
      v.literal('CALL'),
      v.literal('DELIVERY'),
      v.literal('RETRY'),
      v.literal('STORAGE_BYTE_MONTH'),
    ),
  },
  handler: async (ctx, args) => {
    const quotaId = newId('qta');
    await ctx.db.insert('quotaAllocations', {
      quotaId,
      scope: args.scope,
      scopeId: args.scopeId,
      ...(args.tenantId !== undefined ? { tenantId: args.tenantId } : {}),
      ...(args.customerRef !== undefined ? { customerRef: args.customerRef } : {}),
      ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
      billingPeriod: args.billingPeriod,
      limitQuantity: args.limitQuantity,
      consumedQuantity: 0,
      unitType: args.unitType,
      thresholdStatus: 'OK',
      updatedAt: Date.now(),
    });
    return quotaId;
  },
});

/**
 * Consume quota and evaluate the threshold. Emits an audit event when the
 * threshold reaches WARNING or BLOCKED.
 */
export const consumeQuota = internalMutation({
  args: {
    quotaId: v.string(),
    amount: v.number(),
    warningPct: v.number(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const quota = await ctx.db
      .query('quotaAllocations')
      .withIndex('by_quotaId', (q) => q.eq('quotaId', args.quotaId))
      .first();
    if (!quota) {
      fail('NOT_FOUND', 'Quota allocation not found.', { quotaId: args.quotaId });
    }
    const consumedQuantity = quota.consumedQuantity + args.amount;
    const evaluation = evaluateThreshold(consumedQuantity, quota.limitQuantity, args.warningPct);
    await ctx.db.patch(quota._id, {
      consumedQuantity,
      thresholdStatus: evaluation.status,
      updatedAt: Date.now(),
    });
    if (evaluation.status !== 'OK') {
      await writeAuditEvent(ctx, {
        actor: args.actor,
        action: 'cost.quota.threshold',
        targetType: 'quotaAllocation',
        targetId: quota.quotaId,
        outcome: 'SUCCESS',
        metadata: {
          quotaId: quota.quotaId,
          scope: quota.scope,
          thresholdStatus: evaluation.status,
          quantity: consumedQuantity,
          limitMinor: quota.limitQuantity,
        },
      });
    }
    return {
      status: evaluation.status,
      consumedQuantity,
      limitQuantity: quota.limitQuantity,
      consumedPct: evaluation.consumedPct,
    };
  },
});

// --- Usage budgets -----------------------------------------------------------

export const getBudget = query({
  args: { scope: v.string(), scopeId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('usageBudgets')
      .withIndex('by_scope_scopeId', (q) => q.eq('scope', args.scope).eq('scopeId', args.scopeId))
      .first();
  },
});

export const createBudget = internalMutation({
  args: {
    scope: v.string(),
    scopeId: v.string(),
    billingPeriod: v.string(),
    limitMinor: v.number(),
    currency: v.string(),
    warningThresholdPct: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limitMinor) || args.limitMinor < 0) {
      fail('VALIDATION_FAILED', 'limitMinor must be a non-negative integer (minor units).');
    }
    const budgetId = newId('bdg');
    await ctx.db.insert('usageBudgets', {
      budgetId,
      scope: args.scope,
      scopeId: args.scopeId,
      billingPeriod: args.billingPeriod,
      limitMinor: args.limitMinor,
      consumedMinor: 0,
      currency: args.currency,
      warningThresholdPct: args.warningThresholdPct,
      thresholdStatus: 'OK',
      updatedAt: Date.now(),
    });
    return budgetId;
  },
});

export const recordBudgetSpend = internalMutation({
  args: { budgetId: v.string(), amountMinor: v.number(), actor: v.string() },
  handler: async (ctx, args) => {
    const budget = await ctx.db
      .query('usageBudgets')
      .withIndex('by_budgetId', (q) => q.eq('budgetId', args.budgetId))
      .first();
    if (!budget) {
      fail('NOT_FOUND', 'Budget not found.', { budgetId: args.budgetId });
    }
    const consumedMinor = budget.consumedMinor + args.amountMinor;
    const evaluation = evaluateThreshold(
      consumedMinor,
      budget.limitMinor,
      budget.warningThresholdPct,
    );
    await ctx.db.patch(budget._id, {
      consumedMinor,
      thresholdStatus: evaluation.status,
      updatedAt: Date.now(),
    });
    if (evaluation.status !== 'OK') {
      await writeAuditEvent(ctx, {
        actor: args.actor,
        action: 'cost.budget.threshold',
        targetType: 'usageBudget',
        targetId: budget.budgetId,
        outcome: 'SUCCESS',
        metadata: {
          budgetId: budget.budgetId,
          scope: budget.scope,
          thresholdStatus: evaluation.status,
          consumedMinor,
          limitMinor: budget.limitMinor,
          currency: budget.currency,
        },
      });
    }
    return {
      status: evaluation.status,
      consumedMinor,
      limitMinor: budget.limitMinor,
      consumedPct: evaluation.consumedPct,
    };
  },
});

// --- Connector spending limits ----------------------------------------------

export const getSpendingLimit = query({
  args: { connectorId: v.string(), billingPeriod: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('spendingLimits')
      .withIndex('by_connectorId_billingPeriod', (q) =>
        q.eq('connectorId', args.connectorId).eq('billingPeriod', args.billingPeriod),
      )
      .first();
  },
});

export const createSpendingLimit = internalMutation({
  args: {
    connectorId: v.string(),
    vendorId: v.string(),
    billingPeriod: v.string(),
    limitMinor: v.number(),
    currency: v.string(),
    action: v.union(v.literal('WARN'), v.literal('THROTTLE'), v.literal('BLOCK')),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.limitMinor) || args.limitMinor < 0) {
      fail('VALIDATION_FAILED', 'limitMinor must be a non-negative integer (minor units).');
    }
    const limitId = newId('spl');
    await ctx.db.insert('spendingLimits', {
      limitId,
      connectorId: args.connectorId,
      vendorId: args.vendorId,
      billingPeriod: args.billingPeriod,
      limitMinor: args.limitMinor,
      consumedMinor: 0,
      currency: args.currency,
      action: args.action,
      thresholdStatus: 'OK',
      updatedAt: Date.now(),
    });
    return limitId;
  },
});

/**
 * Evaluate a connector spending limit against an incremental charge.
 *
 * Returns a decision the caller enforces:
 *   * WARN     -> allowed, status WARNING once the warning threshold is reached
 *   * THROTTLE -> allowed=false, status THROTTLED once the limit is reached
 *   * BLOCK    -> allowed=false, status BLOCKED once the limit is reached
 *
 * Every non-OK outcome writes an audit event.
 */
export const evaluateSpendingLimit = internalMutation({
  args: {
    connectorId: v.string(),
    billingPeriod: v.string(),
    incrementalMinor: v.number(),
    warningPct: v.number(),
    actor: v.string(),
  },
  handler: async (ctx, args) => {
    const limit = await ctx.db
      .query('spendingLimits')
      .withIndex('by_connectorId_billingPeriod', (q) =>
        q.eq('connectorId', args.connectorId).eq('billingPeriod', args.billingPeriod),
      )
      .first();
    if (!limit) {
      return {
        status: 'OK' as const,
        allowed: true,
        action: 'WARN' as const,
        consumedMinor: 0,
        limitMinor: 0,
      };
    }
    const consumedMinor = limit.consumedMinor + args.incrementalMinor;
    const evaluation = evaluateThreshold(consumedMinor, limit.limitMinor, args.warningPct);

    let status: 'OK' | 'WARNING' | 'THROTTLED' | 'BLOCKED' = evaluation.status;
    let allowed = true;
    if (evaluation.status === 'BLOCKED') {
      if (limit.action === 'BLOCK') {
        status = 'BLOCKED';
        allowed = false;
      } else if (limit.action === 'THROTTLE') {
        status = 'THROTTLED';
        allowed = false;
      } else {
        status = 'WARNING';
        allowed = true;
      }
    }

    await ctx.db.patch(limit._id, {
      consumedMinor,
      thresholdStatus: status,
      updatedAt: Date.now(),
    });

    if (status !== 'OK') {
      await writeAuditEvent(ctx, {
        actor: args.actor,
        action: `cost.spendLimit.${status.toLowerCase()}`,
        targetType: 'spendingLimit',
        targetId: limit.limitId,
        outcome: allowed ? 'SUCCESS' : 'DENIED',
        metadata: {
          limitId: limit.limitId,
          connectorId: limit.connectorId,
          vendorId: limit.vendorId,
          thresholdStatus: status,
          action: limit.action,
          consumedMinor,
          limitMinor: limit.limitMinor,
          currency: limit.currency,
        },
      });
    }

    return {
      status,
      allowed,
      action: limit.action,
      consumedMinor,
      limitMinor: limit.limitMinor,
      consumedPct: evaluation.consumedPct,
    };
  },
});

// --- Emergency vendor shutdown controls --------------------------------------

export const getShutdown = query({
  args: { vendorId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('vendorShutdownControls')
      .withIndex('by_vendorId', (q) => q.eq('vendorId', args.vendorId))
      .first();
  },
});

export const listActiveShutdowns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('vendorShutdownControls')
      .withIndex('by_status', (q) => q.eq('status', 'ACTIVE'))
      .take(limit);
  },
});

/** True when the vendor (or a specific connector) is under an active shutdown. */
export const isVendorShutdown = query({
  args: { vendorId: v.string(), connectorId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const active = await ctx.db
      .query('vendorShutdownControls')
      .withIndex('by_vendorId', (q) => q.eq('vendorId', args.vendorId))
      .take(50);
    return active.some(
      (row) =>
        row.status === 'ACTIVE' &&
        (row.connectorId === undefined ||
          args.connectorId === undefined ||
          row.connectorId === args.connectorId),
    );
  },
});

export const activateShutdown = internalMutation({
  args: {
    vendorId: v.string(),
    connectorId: v.optional(v.string()),
    reason: v.string(),
    activatedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const shutdownId = newId('shd');
    await ctx.db.insert('vendorShutdownControls', {
      shutdownId,
      vendorId: args.vendorId,
      ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
      status: 'ACTIVE',
      reason: args.reason,
      activatedBy: args.activatedBy,
      activatedAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: args.activatedBy,
      action: 'cost.vendorShutdown.activate',
      targetType: 'vendorShutdownControl',
      targetId: shutdownId,
      outcome: 'SUCCESS',
      metadata: {
        shutdownId,
        vendorId: args.vendorId,
        ...(args.connectorId !== undefined ? { connectorId: args.connectorId } : {}),
        status: 'ACTIVE',
        reason: args.reason,
      },
    });
    return shutdownId;
  },
});

export const releaseShutdown = internalMutation({
  args: { shutdownId: v.string(), releasedBy: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('vendorShutdownControls')
      .withIndex('by_shutdownId', (q) => q.eq('shutdownId', args.shutdownId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Shutdown control not found.', { shutdownId: args.shutdownId });
    }
    const now = Date.now();
    await ctx.db.patch(record._id, { status: 'RELEASED', releasedAt: now, updatedAt: now });
    await writeAuditEvent(ctx, {
      actor: args.releasedBy,
      action: 'cost.vendorShutdown.release',
      targetType: 'vendorShutdownControl',
      targetId: record.shutdownId,
      outcome: 'SUCCESS',
      metadata: {
        shutdownId: record.shutdownId,
        vendorId: record.vendorId,
        status: 'RELEASED',
      },
    });
    return record.shutdownId;
  },
});
