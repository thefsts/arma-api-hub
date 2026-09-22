// Nonce replay guard.
//
// A nonce is valid for a bounded window. Recording a nonce that is still within
// its window is a replay and is rejected.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireRole } from './lib/authz';

export const isReplay = query({
  args: { serviceId: v.string(), nonce: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'service']);
    const record = await ctx.db
      .query('nonceRecords')
      .withIndex('by_serviceId_nonce', (q) =>
        q.eq('serviceId', args.serviceId).eq('nonce', args.nonce),
      )
      .first();
    return record !== null && record.expiresAt > args.now;
  },
});

export const record = internalMutation({
  args: {
    serviceId: v.string(),
    keyId: v.string(),
    nonce: v.string(),
    validityMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('nonceRecords')
      .withIndex('by_serviceId_nonce', (q) =>
        q.eq('serviceId', args.serviceId).eq('nonce', args.nonce),
      )
      .first();
    if (existing && existing.expiresAt > now) {
      return { accepted: false as const };
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        keyId: args.keyId,
        seenAt: now,
        expiresAt: now + args.validityMs,
      });
      return { accepted: true as const };
    }
    await ctx.db.insert('nonceRecords', {
      nonce: args.nonce,
      serviceId: args.serviceId,
      keyId: args.keyId,
      seenAt: now,
      expiresAt: now + args.validityMs,
    });
    return { accepted: true as const };
  },
});

export const purgeExpired = internalMutation({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const expired = await ctx.db
      .query('nonceRecords')
      .withIndex('by_expiresAt', (q) => q.lte('expiresAt', args.now))
      .take(limit);
    for (const record of expired) {
      await ctx.db.delete(record._id);
    }
    return expired.length;
  },
});
