// External / client integrations.
//
// External and client systems are registered separately from FSTS-owned
// products. PlayRaise, when connected, is registered here as CLIENT_OWNED.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import {
  classificationValidator,
  environmentValidator,
  lifecycleValidator,
  ownershipValidator,
} from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('externalIntegrations').take(limit);
  },
});

export const get = query({
  args: { integrationId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('externalIntegrations')
      .withIndex('by_integrationId', (q) => q.eq('integrationId', args.integrationId))
      .first();
  },
});

export const register = internalMutation({
  args: {
    integrationId: v.optional(v.string()),
    name: v.string(),
    ownership: ownershipValidator,
    lifecycle: lifecycleValidator,
    environment: environmentValidator,
    owner: v.string(),
    dataClassification: classificationValidator,
    destinationAllowList: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const integrationId = args.integrationId ?? newId('ext');
    const existing = await ctx.db
      .query('externalIntegrations')
      .withIndex('by_integrationId', (q) => q.eq('integrationId', integrationId))
      .first();
    if (existing) {
      fail('CONFLICT', 'An integration with this identifier already exists.', { integrationId });
    }
    const now = Date.now();
    await ctx.db.insert('externalIntegrations', {
      integrationId,
      name: args.name,
      ownership: args.ownership,
      lifecycle: args.lifecycle,
      environment: args.environment,
      owner: args.owner,
      dataClassification: args.dataClassification,
      destinationAllowList: args.destinationAllowList,
      createdAt: now,
      updatedAt: now,
    });
    return integrationId;
  },
});

export const updateLifecycle = internalMutation({
  args: { integrationId: v.string(), lifecycle: lifecycleValidator },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('externalIntegrations')
      .withIndex('by_integrationId', (q) => q.eq('integrationId', args.integrationId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Integration not found.', { integrationId: args.integrationId });
    }
    await ctx.db.patch(record._id, { lifecycle: args.lifecycle, updatedAt: Date.now() });
    return record.integrationId;
  },
});
