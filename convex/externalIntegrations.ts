// External / client integrations.
//
// External and client systems are registered separately from FSTS-owned
// products. PlayRaise, when connected, is registered here as CLIENT_OWNED.
// Phase 0: reads are INTERNAL queries gated by a durable-record role check.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  classificationValidator,
  environmentValidator,
  lifecycleValidator,
  ownershipValidator,
} from './lib/validators';
import { requireAuthorizationContext, requireRole } from './lib/authz';
import { externalIntegrationDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const list = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(externalIntegrationDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('externalIntegrations').take(limit);
  },
});

export const get = internalQuery({
  args: { integrationId: v.string() },
  returns: v.union(externalIntegrationDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, ['admin', 'operator', 'viewer']);
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
  returns: v.string(),
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
  returns: v.string(),
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
