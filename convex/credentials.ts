// Credential versions.
//
// Credential lifecycle (rotation, activation, retirement, revocation) is a
// privileged operation exposed only as internal mutations. Records hold key
// references and lifecycle state, never key material.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { credentialStateValidator } from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';

export const listByService = query({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('credentialVersions')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const getByKeyId = query({
  args: { keyId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('credentialVersions')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .order('desc')
      .first();
  },
});

export const createVersion = internalMutation({
  args: {
    serviceId: v.string(),
    keyId: v.string(),
    algorithm: v.string(),
  },
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

export const listByState = query({
  args: { state: credentialStateValidator, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('credentialVersions')
      .withIndex('by_state', (q) => q.eq('state', args.state))
      .take(limit);
  },
});
