// Nonce replay guard.
//
// A nonce is valid for a bounded window. Recording a nonce that is still within
// its window is a replay and is rejected.
//
// Phase 0: this is a SERVICE-FACING resource. Every function is internal and
// binds the caller to its server-derived service identity: a service may only
// inspect or record nonces for its own service. A caller that supplies another
// service's `serviceId` is rejected even when it holds the `service` role.
//
// The `now` argument is a trusted evaluation timestamp supplied by the internal
// service boundary (see docs/security/ADR-0005-authentication-decision.md).
// It is never accepted from an untrusted client, and no query handler reads
// `Date.now()`.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { requireAuthorizationContext, requireServiceBinding } from './lib/authz';

export const isReplay = internalQuery({
  args: { serviceId: v.string(), nonce: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceBinding(authz, args.serviceId);
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
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceBinding(authz, args.serviceId);
    const now = Date.now();
    const existing = await ctx.db
      .query('nonceRecords')
      .withIndex('by_serviceId_nonce', (q) =>
        q.eq('serviceId', args.serviceId).eq('nonce', args.nonce),
      )
      .first();
    if (existing && existing.expiresAt > now) {
      return { accepted: false };
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        keyId: args.keyId,
        seenAt: now,
        expiresAt: now + args.validityMs,
      });
      return { accepted: true };
    }
    await ctx.db.insert('nonceRecords', {
      nonce: args.nonce,
      serviceId: args.serviceId,
      keyId: args.keyId,
      seenAt: now,
      expiresAt: now + args.validityMs,
    });
    return { accepted: true };
  },
});

export const purgeExpired = internalMutation({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.number(),
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
