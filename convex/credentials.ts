// Credential versions.
//
// Credential lifecycle (rotation, activation, retirement, revocation) is a
// privileged operation exposed only as internal mutations. Records hold key
// references and lifecycle state, never key material. Phase 0: reads are
// INTERNAL queries that enforce the caller's server-derived service scope.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { credentialStateValidator } from './lib/validators';
import {
  filterByServiceScope,
  requireAuthorizationContext,
  requireServiceScope,
} from './lib/authz';
import { credentialVersionDoc } from './lib/returns';
import { fail } from './lib/errors';

export const listByService = internalQuery({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(credentialVersionDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.serviceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('credentialVersions')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const getByKeyId = internalQuery({
  args: { keyId: v.string() },
  returns: v.union(credentialVersionDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const record = await ctx.db
      .query('credentialVersions')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .order('desc')
      .first();
    if (record === null) return null;
    requireServiceScope(authz, record.serviceId);
    return record;
  },
});

export const createVersion = internalMutation({
  args: {
    serviceId: v.string(),
    keyId: v.string(),
    algorithm: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query('credentialVersions')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .order('desc')
      .first();
    const version = latest ? latest.version + 1 : 1;
    await ctx.db.insert('credentialVersions', {
      serviceId: args.serviceId,
      keyId: args.keyId,
      version,
      state: 'PENDING',
      algorithm: args.algorithm,
      createdAt: Date.now(),
    });
    return version;
  },
});

export const activate = internalMutation({
  args: { keyId: v.string(), version: v.number() },
  returns: v.id('credentialVersions'),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('credentialVersions')
      .withIndex('by_keyId_version', (q) => q.eq('keyId', args.keyId).eq('version', args.version))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Credential version not found.', {
        keyId: args.keyId,
        version: args.version,
      });
    }
    await ctx.db.patch(record._id, { state: 'ACTIVE', activatedAt: Date.now() });
    return record._id;
  },
});

export const retire = internalMutation({
  args: { keyId: v.string(), version: v.number() },
  returns: v.id('credentialVersions'),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('credentialVersions')
      .withIndex('by_keyId_version', (q) => q.eq('keyId', args.keyId).eq('version', args.version))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Credential version not found.', {
        keyId: args.keyId,
        version: args.version,
      });
    }
    await ctx.db.patch(record._id, { state: 'RETIRED', retiredAt: Date.now() });
    return record._id;
  },
});

export const revoke = internalMutation({
  args: { keyId: v.string(), version: v.number(), reason: v.string() },
  returns: v.id('credentialVersions'),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('credentialVersions')
      .withIndex('by_keyId_version', (q) => q.eq('keyId', args.keyId).eq('version', args.version))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Credential version not found.', {
        keyId: args.keyId,
        version: args.version,
      });
    }
    await ctx.db.patch(record._id, {
      state: 'REVOKED',
      revokedAt: Date.now(),
      revokedReason: args.reason,
    });
    return record._id;
  },
});

export const listByState = internalQuery({
  args: { state: credentialStateValidator, limit: v.optional(v.number()) },
  returns: v.array(credentialVersionDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('credentialVersions')
      .withIndex('by_state', (q) => q.eq('state', args.state))
      .take(limit);
    return filterByServiceScope(authz, rows, (row) => row.serviceId);
  },
});
