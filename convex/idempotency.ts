// Idempotency registry.
//
// Records a request hash, never the request body. The registry distinguishes a
// fresh request, a duplicate of a completed request, and a conflict where the
// same key is reused with a different request hash.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireRole } from './lib/authz';

export const get = query({
  args: { serviceId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'service']);
    return await ctx.db
      .query('idempotencyRecords')
      .withIndex('by_serviceId_key', (q) =>
        q.eq('serviceId', args.serviceId).eq('idempotencyKey', args.idempotencyKey),
      )
      .first();
  },
});

export const begin = internalMutation({
  args: {
    serviceId: v.string(),
    idempotencyKey: v.string(),
    requestHash: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('idempotencyRecords')
      .withIndex('by_serviceId_key', (q) =>
        q.eq('serviceId', args.serviceId).eq('idempotencyKey', args.idempotencyKey),
      )
      .first();

    if (existing && existing.expiresAt > now) {
      if (existing.requestHash === args.requestHash) {
        return { status: 'DUPLICATE' as const, responseRef: existing.responseRef };
      }
      return { status: 'CONFLICT' as const, responseRef: undefined };
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        requestHash: args.requestHash,
        status: 'FRESH',
        responseRef: undefined,
        createdAt: now,
        expiresAt: now + args.ttlMs,
      });
      return { status: 'FRESH' as const, responseRef: undefined };
    }

    await ctx.db.insert('idempotencyRecords', {
      idempotencyKey: args.idempotencyKey,
      serviceId: args.serviceId,
      requestHash: args.requestHash,
      status: 'FRESH',
      createdAt: now,
      expiresAt: now + args.ttlMs,
    });
    return { status: 'FRESH' as const, responseRef: undefined };
  },
});

export const complete = internalMutation({
  args: {
    serviceId: v.string(),
    idempotencyKey: v.string(),
    responseRef: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('idempotencyRecords')
      .withIndex('by_serviceId_key', (q) =>
        q.eq('serviceId', args.serviceId).eq('idempotencyKey', args.idempotencyKey),
      )
      .first();
    if (!existing) return false;
    await ctx.db.patch(existing._id, { status: 'DUPLICATE', responseRef: args.responseRef });
    return true;
  },
});

export const purgeExpired = internalMutation({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const expired = await ctx.db
      .query('idempotencyRecords')
      .withIndex('by_expiresAt', (q) => q.lte('expiresAt', args.now))
      .take(limit);
    for (const record of expired) {
      await ctx.db.delete(record._id);
    }
    return expired.length;
  },
});
