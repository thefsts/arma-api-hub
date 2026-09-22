// Signed receipt records.
//
// Receipts store hashes, algorithm metadata, and key references. They never
// store raw signatures, secrets, or protected payloads. Recording and verifying
// receipts are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { requireRole } from './lib/authz';
import { newId } from './lib/ids';

export const get = query({
  args: { receiptId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('receiptRecords')
      .withIndex('by_receiptId', (q) => q.eq('receiptId', args.receiptId))
      .first();
  },
});

export const listByEvent = query({
  args: { eventId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('receiptRecords')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .take(limit);
  },
});

export const record = internalMutation({
  args: {
    receiptId: v.optional(v.string()),
    eventId: v.string(),
    serviceId: v.string(),
    signatureAlgorithm: v.string(),
    keyId: v.string(),
    bodyHash: v.string(),
  },
  handler: async (ctx, args) => {
    const receiptId = args.receiptId ?? newId('rcp');
    await ctx.db.insert('receiptRecords', {
      receiptId,
      eventId: args.eventId,
      serviceId: args.serviceId,
      signatureAlgorithm: args.signatureAlgorithm,
      keyId: args.keyId,
      bodyHash: args.bodyHash,
      issuedAt: Date.now(),
    });
    return receiptId;
  },
});

export const markVerified = internalMutation({
  args: { receiptId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('receiptRecords')
      .withIndex('by_receiptId', (q) => q.eq('receiptId', args.receiptId))
      .first();
    if (!record) return false;
    await ctx.db.patch(record._id, { verifiedAt: Date.now() });
    return true;
  },
});
