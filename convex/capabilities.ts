// Capability grants.
//
// A service must hold the required scoped capability before it may send or
// receive protected events. Granting and revoking capabilities are privileged
// internal operations.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';

export const listByService = query({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const hasCapability = query({
  args: { serviceId: v.string(), capability: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const grant = await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId_capability', (q) =>
        q.eq('serviceId', args.serviceId).eq('capability', args.capability),
      )
      .first();
    if (!grant) return false;
    if (grant.revokedAt !== undefined) return false;
    if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()) return false;
    return true;
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
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('capabilityGrants')
      .withIndex('by_serviceId_capability', (q) =>
        q.eq('serviceId', args.serviceId).eq('capability', args.capability),
      )
      .first();
    if (existing && existing.revokedAt === undefined) {
      fail('CONFLICT', 'The capability is already granted.', {
        serviceId: args.serviceId,
        capability: args.capability,
      });
    }
    await ctx.db.insert('capabilityGrants', {
      serviceId: args.serviceId,
      capability: args.capability,
      scope: args.scope,
      grantedAt: Date.now(),
      grantedBy: args.grantedBy,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
    return true;
  },
});

export const revoke = internalMutation({
  args: { serviceId: v.string(), capability: v.string() },
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
    await ctx.db.patch(grant._id, { revokedAt: Date.now() });
    return true;
  },
});
