// Systems registry: FSTS-owned products, client systems, and partners.
//
// Reads are public queries guarded by role. Writes are privileged internal
// mutations. PlayRaise is registered as CLIENT_OWNED, never FSTS_OWNED.

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
    return await ctx.db.query('systems').take(limit);
  },
});

export const get = query({
  args: { systemId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('systems')
      .withIndex('by_systemId', (q) => q.eq('systemId', args.systemId))
      .first();
  },
});

export const listByOwnership = query({
  args: { ownership: ownershipValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('systems')
      .withIndex('by_ownership', (q) => q.eq('ownership', args.ownership))
      .take(limit);
  },
});

export const create = internalMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    ownership: ownershipValidator,
    lifecycle: lifecycleValidator,
    environment: environmentValidator,
    description: v.optional(v.string()),
    owner: v.string(),
    dataClassification: classificationValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('systems')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (existing) {
      fail('CONFLICT', 'A system with this slug already exists.', { slug: args.slug });
    }
    const now = Date.now();
    const systemId = newId('sys');
    await ctx.db.insert('systems', {
      systemId,
      name: args.name,
      slug: args.slug,
      ownership: args.ownership,
      lifecycle: args.lifecycle,
      environment: args.environment,
      ...(args.description !== undefined ? { description: args.description } : {}),
      owner: args.owner,
      dataClassification: args.dataClassification,
      createdAt: now,
      updatedAt: now,
    });
    return systemId;
  },
});

export const updateLifecycle = internalMutation({
  args: { systemId: v.string(), lifecycle: lifecycleValidator },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('systems')
      .withIndex('by_systemId', (q) => q.eq('systemId', args.systemId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'System not found.', { systemId: args.systemId });
    }
    await ctx.db.patch(record._id, { lifecycle: args.lifecycle, updatedAt: Date.now() });
    return record.systemId;
  },
});
