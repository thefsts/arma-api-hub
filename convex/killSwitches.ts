// Kill switches.
//
// A kill switch stops outbound delivery to a connector, a service, or the whole
// control plane. Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). A kill switch is visible
// only when the caller is authorized for its target: a SERVICE switch requires
// service scope, a CONNECTOR switch requires the owning service's scope, and a
// CONTROL_PLANE switch requires an explicit global grant. Engaging and
// releasing are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { killSwitchScopeValidator } from './lib/validators';
import {
  requireAuthorizationContext,
  requireConnectorScope,
  requireGlobal,
  requireServiceScope,
  type AuthorizationContext,
} from './lib/authz';
import { killSwitchDoc } from './lib/returns';
import type { QueryCtx, MutationCtx } from './_generated/server';

type KillSwitchRow = { scope: 'CONNECTOR' | 'SERVICE' | 'CONTROL_PLANE'; targetId: string };

async function requireKillSwitchScope(
  ctx: QueryCtx | MutationCtx,
  authz: AuthorizationContext,
  row: KillSwitchRow,
): Promise<void> {
  if (authz.global) return;
  if (row.scope === 'CONTROL_PLANE') {
    requireGlobal(authz);
    return;
  }
  if (row.scope === 'SERVICE') {
    requireServiceScope(authz, row.targetId);
    return;
  }
  await requireConnectorScope(ctx, authz, row.targetId);
}

export const get = internalQuery({
  args: { scope: killSwitchScopeValidator, targetId: v.string() },
  returns: v.union(killSwitchDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const record = await ctx.db
      .query('killSwitches')
      .withIndex('by_scope_target', (q) => q.eq('scope', args.scope).eq('targetId', args.targetId))
      .first();
    if (record === null) return null;
    await requireKillSwitchScope(ctx, authz, record);
    return record;
  },
});

export const listEngaged = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(killSwitchDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('killSwitches')
      .withIndex('by_engaged', (q) => q.eq('engaged', true))
      .take(limit);
    const result: typeof rows = [];
    for (const row of rows) {
      try {
        await requireKillSwitchScope(ctx, authz, row);
        result.push(row);
      } catch {
        // Not authorized for this switch's target: drop it (fail closed).
      }
    }
    return result;
  },
});

export const engage = internalMutation({
  args: {
    scope: killSwitchScopeValidator,
    targetId: v.string(),
    reason: v.string(),
    engagedBy: v.string(),
  },
  returns: v.id('killSwitches'),
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
  returns: v.id('killSwitches'),
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
