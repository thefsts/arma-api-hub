// Connection policies.
//
// A connection policy binds a service to a destination with an allow decision,
// a classification ceiling, and a rate limit. Policies are fail-closed: a
// destination with no policy is not allowed.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { classificationValidator } from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const listByService = query({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('connectionPolicies')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const getForDestination = query({
  args: { serviceId: v.string(), destination: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('connectionPolicies')
      .withIndex('by_serviceId_destination', (q) =>
        q.eq('serviceId', args.serviceId).eq('destination', args.destination),
      )
      .first();
  },
});

export const upsert = internalMutation({
  args: {
    serviceId: v.string(),
    destination: v.string(),
    allowed: v.boolean(),
    classificationCeiling: classificationValidator,
    rateLimitPerMinute: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.rateLimitPerMinute < 0) {
      fail('VALIDATION_FAILED', 'Rate limit must not be negative.');
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('connectionPolicies')
      .withIndex('by_serviceId_destination', (q) =>
        q.eq('serviceId', args.serviceId).eq('destination', args.destination),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        allowed: args.allowed,
        classificationCeiling: args.classificationCeiling,
        rateLimitPerMinute: args.rateLimitPerMinute,
        updatedAt: now,
      });
      return existing.policyId;
    }
    const policyId = newId('pol');
    await ctx.db.insert('connectionPolicies', {
      policyId,
      serviceId: args.serviceId,
      destination: args.destination,
      allowed: args.allowed,
      classificationCeiling: args.classificationCeiling,
      rateLimitPerMinute: args.rateLimitPerMinute,
      createdAt: now,
      updatedAt: now,
    });
    return policyId;
  },
});
