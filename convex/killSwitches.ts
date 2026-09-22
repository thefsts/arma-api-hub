// Kill switches.
//
// A kill switch stops outbound delivery to a connector, a service, or the whole
// control plane. Engaging and releasing are privileged internal operations.
// Reads are public queries guarded by role.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { killSwitchScopeValidator } from './lib/validators';
import { requireRole } from './lib/authz';

export const get = query({
  args: { scope: killSwitchScopeValidator, targetId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('killSwitches')
      .withIndex('by_scope_target', (q) => q.eq('scope', args.scope).eq('targetId', args.targetId))
      .first();
  },
});

export const listEngaged = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('killSwitches')
      .withIndex('by_engaged', (q) => q.eq('engaged', true))
      .take(limit);
  },
});

export const engage = internalMutation({
  args: {
    scope: killSwitchScopeValidator,
    targetId: v.string(),
    reason: v.string(),
    engagedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('killSwitches')
      .withIndex('by_scope_target', (q) => q.eq('scope', args.scope).eq('targetId', args.targetId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        engaged: true,
        reason: args.reason,
        engagedBy: args.engagedBy,
        engagedAt: now,
        releasedAt: undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('killSwitches', {
      scope: args.scope,
      targetId: args.targetId,
      engaged: true,
      reason: args.reason,
      engagedBy: args.engagedBy,
      engagedAt: now,
      updatedAt: now,
    });
  },
});

export const release = internalMutation({
  args: { scope: killSwitchScopeValidator, targetId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('killSwitches')
      .withIndex('by_scope_target', (q) => q.eq('scope', args.scope).eq('targetId', args.targetId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        engaged: false,
        releasedAt: now,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert('killSwitches', {
      scope: args.scope,
      targetId: args.targetId,
      engaged: false,
      releasedAt: now,
      updatedAt: now,
    });
  },
});
