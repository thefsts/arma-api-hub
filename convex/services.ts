// Services registry.
//
// A service may send or receive protected events only when it is registered,
// approved, active, and holds the required scoped capability. Phase 0: reads
// are INTERNAL queries that enforce the caller's server-derived service scope;
// writes are privileged internal mutations.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  classificationValidator,
  environmentValidator,
  lifecycleValidator,
} from './lib/validators';
import {
  filterByServiceScope,
  requireAuthorizationContext,
  requireServiceScope,
  requireSystemScope,
} from './lib/authz';
import { serviceDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const list = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(serviceDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db.query('services').take(limit);
    return filterByServiceScope(authz, rows, (row) => row.serviceId);
  },
});

export const get = internalQuery({
  args: { serviceId: v.string() },
  returns: v.union(serviceDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.serviceId);
    return await ctx.db
      .query('services')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .first();
  },
});

export const listBySystem = internalQuery({
  args: { systemId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(serviceDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireSystemScope(authz, args.systemId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('services')
      .withIndex('by_systemId', (q) => q.eq('systemId', args.systemId))
      .take(limit);
    return filterByServiceScope(authz, rows, (row) => row.serviceId);
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
  returns: v.string(),
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
  returns: v.string(),
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
  returns: v.string(),
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
