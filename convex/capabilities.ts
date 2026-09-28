// Capability grants.
//
// A service must hold the required scoped capability before it may send or
// receive protected events. Granting and revoking capabilities are privileged
// internal operations.
//
// DETERMINISM (Phase 0 correction): capability expiration is materialized into
// the stored `status` field by the scheduled internal mutation `expireGrants`.
// Reads therefore never evaluate wall-clock time inside a query handler — the
// query is deterministic and reactive, and no caller-supplied time is ever
// accepted for an authorization decision.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { requireAuthorizationContext, requireServiceScope } from './lib/authz';
import { capabilityGrantDoc } from './lib/returns';
import { fail } from './lib/errors';

export const listByService = internalQuery({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(capabilityGrantDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.serviceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

/**
 * Deterministic capability check. Reads the materialized `status` field only;
 * never evaluates `Date.now()` and never accepts caller-supplied time.
 */
export const hasCapability = internalQuery({
  args: { serviceId: v.string(), capability: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.serviceId);
    const grant = await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId_capability', (q) =>
        q.eq('serviceId', args.serviceId).eq('capability', args.capability),
      )
      .first();
    return grant !== null && grant.status === 'ACTIVE';
  },
});

export const grant = internalMutation({
  args: {
    serviceId: v.string(),
    capability: v.string(),
    scope: v.string(),
    grantedBy: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId_capability', (q) =>
        q.eq('serviceId', args.serviceId).eq('capability', args.capability),
      )
      .first();
    if (existing && existing.status === 'ACTIVE') {
      fail('CONFLICT', 'The capability is already granted.', {
        serviceId: args.serviceId,
        capability: args.capability,
      });
    }
    const now = Date.now();
    const status = args.expiresAt !== undefined && args.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
    await ctx.db.insert('capabilityGrants', {
      serviceId: args.serviceId,
      capability: args.capability,
      scope: args.scope,
      status,
      grantedAt: now,
      grantedBy: args.grantedBy,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
    return true;
  },
});

export const revoke = internalMutation({
  args: { serviceId: v.string(), capability: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId_capability', (q) =>
        q.eq('serviceId', args.serviceId).eq('capability', args.capability),
      )
      .first();
    if (!grant) {
      fail('NOT_FOUND', 'Capability grant not found.', {
        serviceId: args.serviceId,
        capability: args.capability,
      });
    }
    await ctx.db.patch(grant._id, { status: 'REVOKED', revokedAt: Date.now() });
    return true;
  },
});

/**
 * Scheduled maintenance: transition ACTIVE grants whose `expiresAt` has passed
 * into the EXPIRED state. This is the ONLY place capability expiration is
 * evaluated, and it runs as a mutation (never inside a query handler).
 */
export const expireGrants = internalMutation({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const due = await ctx.db
      .query('capabilityGrants')
      .withIndex('by_status_expiresAt', (q) => q.eq('status', 'ACTIVE').lte('expiresAt', args.now))
      .take(limit);
    for (const grant of due) {
      await ctx.db.patch(grant._id, { status: 'EXPIRED' });
    }
    return due.length;
  },
});
