// Idempotency registry.
//
// Records a request hash, never the request body. The registry distinguishes a
// fresh request, a duplicate of a completed request, and a conflict where the
// same key is reused with a different request hash.
//
// SERVICE-IDENTITY BINDING (Phase 0 correction): the read is an INTERNAL query
// that binds the caller to its server-derived service identity. A service
// caller may only inspect its OWN idempotency records; supplying another
// service's `serviceId` is rejected even when the caller holds the `service`
// role.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { idempotencyStatusValidator } from './lib/validators';
import { requireAuthorizationContext, requireServiceBinding } from './lib/authz';
import { idempotencyRecordDoc } from './lib/returns';

export const get = internalQuery({
  args: { serviceId: v.string(), idempotencyKey: v.string() },
  returns: v.union(idempotencyRecordDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceBinding(authz, args.serviceId);
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
  returns: v.object({
    status: idempotencyStatusValidator,
    responseRef: v.optional(v.string()),
  }),
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
  returns: v.boolean(),
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
  returns: v.number(),
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
