// Service identities.
//
// A service identity is a key *reference*. Key material is never stored here;
// it lives in a secrets manager. Phase 0: reads are INTERNAL queries that
// enforce the caller's server-derived service scope; creating and revoking
// identities are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { credentialStateValidator } from './lib/validators';
import { requireAuthorizationContext, requireServiceScope } from './lib/authz';
import { serviceIdentityDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const listByService = internalQuery({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(serviceIdentityDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.serviceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('serviceIdentities')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const getByKeyId = internalQuery({
  args: { keyId: v.string() },
  returns: v.union(serviceIdentityDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const record = await ctx.db
      .query('serviceIdentities')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .first();
    if (record === null) return null;
    requireServiceScope(authz, record.serviceId);
    return record;
  },
});

export const create = internalMutation({
  args: {
    serviceId: v.string(),
    keyId: v.optional(v.string()),
    algorithm: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const keyId = args.keyId ?? newId('key');
    const existing = await ctx.db
      .query('serviceIdentities')
      .withIndex('by_keyId', (q) => q.eq('keyId', keyId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A service identity with this key reference already exists.', { keyId });
    }
    await ctx.db.insert('serviceIdentities', {
      serviceId: args.serviceId,
      keyId,
      state: 'PENDING',
      algorithm: args.algorithm,
      createdAt: Date.now(),
    });
    return keyId;
  },
});

export const setState = internalMutation({
  args: { keyId: v.string(), state: credentialStateValidator },
  returns: v.string(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('serviceIdentities')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Service identity not found.', { keyId: args.keyId });
    }
    const now = Date.now();
    await ctx.db.patch(record._id, {
      state: args.state,
      ...(args.state === 'ROTATING' ? { rotatedAt: now } : {}),
    });
    return record.keyId;
  },
});

export const revoke = internalMutation({
  args: { keyId: v.string(), reason: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('serviceIdentities')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Service identity not found.', { keyId: args.keyId });
    }
    await ctx.db.patch(record._id, {
      state: 'REVOKED',
      revokedAt: Date.now(),
      revokedReason: args.reason,
    });
    return record.keyId;
  },
});
