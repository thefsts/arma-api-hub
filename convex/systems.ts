// Systems registry: FSTS-owned products, client systems, and partners.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Reads enforce the
// caller's server-derived system scope; writes are privileged internal
// mutations. PlayRaise is registered as CLIENT_OWNED, never FSTS_OWNED.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  classificationValidator,
  environmentValidator,
  lifecycleValidator,
  ownershipValidator,
} from './lib/validators';
import { filterBySystemScope, requireAuthorizationContext, requireSystemScope } from './lib/authz';
import { systemDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const list = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(systemDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db.query('systems').take(limit);
    return filterBySystemScope(authz, rows, (row) => row.systemId);
  },
});

export const get = internalQuery({
  args: { systemId: v.string() },
  returns: v.union(systemDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireSystemScope(authz, args.systemId);
    return await ctx.db
      .query('systems')
      .withIndex('by_systemId', (q) => q.eq('systemId', args.systemId))
      .first();
  },
});

export const listByOwnership = internalQuery({
  args: { ownership: ownershipValidator, limit: v.optional(v.number()) },
  returns: v.array(systemDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('systems')
      .withIndex('by_ownership', (q) => q.eq('ownership', args.ownership))
      .take(limit);
    return filterBySystemScope(authz, rows, (row) => row.systemId);
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
  returns: v.string(),
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
  returns: v.string(),
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
