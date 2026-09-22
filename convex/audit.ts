// Audit events.
//
// Writing audit records is a privileged operation and is exposed only as an
// internal mutation. Reading recent audit records is a public query guarded by
// role. Metadata is redaction-safe: secrets, signatures, credentials, and
// protected payloads are dropped before storage.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { auditOutcomeValidator } from './lib/validators';
import { requireRole } from './lib/authz';
import { writeAuditEvent } from './lib/audit';

export const write = internalMutation({
  args: {
    actor: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    outcome: auditOutcomeValidator,
    correlationId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, args) => {
    return await writeAuditEvent(ctx, {
      actor: args.actor,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      outcome: args.outcome,
      ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    });
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db.query('auditEvents').withIndex('by_createdAt').order('desc').take(limit);
  },
});

export const listByTarget = query({
  args: { targetType: v.string(), targetId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db
      .query('auditEvents')
      .withIndex('by_targetType_targetId', (q) =>
        q.eq('targetType', args.targetType).eq('targetId', args.targetId),
      )
      .order('desc')
      .take(limit);
  },
});
