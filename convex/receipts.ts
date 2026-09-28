// Signed receipt records.
//
// Receipts store hashes, algorithm metadata, and key references. They never
// store raw signatures, secrets, or protected payloads.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Receipts are scoped to a
// service, so reads require the caller's server-derived service scope.
// Recording and verifying receipts are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  filterByServiceScope,
  requireAuthorizationContext,
  requireServiceScope,
} from './lib/authz';
import { receiptRecordDoc } from './lib/returns';
import { newId } from './lib/ids';

export const get = internalQuery({
  args: { receiptId: v.string() },
  returns: v.union(receiptRecordDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const record = await ctx.db
      .query('receiptRecords')
      .withIndex('by_receiptId', (q) => q.eq('receiptId', args.receiptId))
      .first();
    if (record === null) return null;
    requireServiceScope(authz, record.serviceId);
    return record;
  },
});

export const listByEvent = internalQuery({
  args: { eventId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(receiptRecordDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('receiptRecords')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .take(limit);
    return filterByServiceScope(authz, rows, (row) => row.serviceId);
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
  returns: v.string(),
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
  returns: v.boolean(),
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
