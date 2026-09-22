// Services registry.
//
// A service may send or receive protected events only when it is registered,
// approved, active, and holds the required scoped capability. Reads are public
// queries guarded by role; writes are privileged internal mutations.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import {
  classificationValidator,
  environmentValidator,
  lifecycleValidator,
} from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('services').take(limit);
  },
});

export const get = query({
  args: { serviceId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('services')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .first();
  },
});

export const listBySystem = query({
  args: { systemId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('services')
      .withIndex('by_systemId', (q) => q.eq('systemId', args.systemId))
      .take(limit);
  },
});

export const register = internalMutation({
  args: {
    serviceId: v.optional(v.string()),
    systemId: v.string(),
    name: v.string(),
    lifecycle: lifecycleValidator,
    environment: environmentValidator,
    audience: v.string(),
    capabilities: v.array(v.string()),
    authorizedTenantIds: v.array(v.string()),
    owner: v.string(),
    dataClassification: classificationValidator,
  },
  handler: async (ctx, args) => {
    const serviceId = args.serviceId ?? newId('svc');
    const existing = await ctx.db
      .query('services')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', serviceId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A service with this identifier already exists.', { serviceId });
    }
    const now = Date.now();
    await ctx.db.insert('services', {
      serviceId,
      systemId: args.systemId,
      name: args.name,
      lifecycle: args.lifecycle,
      environment: args.environment,
      audience: args.audience,
      capabilities: args.capabilities,
      authorizedTenantIds: args.authorizedTenantIds,
      owner: args.owner,
      dataClassification: args.dataClassification,
      killSwitchEngaged: false,
      createdAt: now,
      updatedAt: now,
    });
    return serviceId;
  },
});

export const updateLifecycle = internalMutation({
  args: { serviceId: v.string(), lifecycle: lifecycleValidator },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('services')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Service not found.', { serviceId: args.serviceId });
    }
    await ctx.db.patch(record._id, { lifecycle: args.lifecycle, updatedAt: Date.now() });
    return record.serviceId;
  },
});

export const setKillSwitchEngaged = internalMutation({
  args: { serviceId: v.string(), engaged: v.boolean() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('services')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Service not found.', { serviceId: args.serviceId });
    }
    await ctx.db.patch(record._id, {
      killSwitchEngaged: args.engaged,
      updatedAt: Date.now(),
    });
    return record.serviceId;
  },
});
