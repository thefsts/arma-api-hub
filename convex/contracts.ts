// Contract definitions and versions.
//
// Contracts are versioned and replaceable. Publishing, deprecating, and
// retiring versions are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import {
  classificationValidator,
  contractKindValidator,
  contractStatusValidator,
} from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const listDefinitions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('contractDefinitions').take(limit);
  },
});

export const getDefinition = query({
  args: { contractId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('contractDefinitions')
      .withIndex('by_contractId', (q) => q.eq('contractId', args.contractId))
      .first();
  },
});

export const listVersions = query({
  args: { contractId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('contractVersions')
      .withIndex('by_contractId', (q) => q.eq('contractId', args.contractId))
      .take(limit);
  },
});

export const define = internalMutation({
  args: {
    contractId: v.optional(v.string()),
    kind: contractKindValidator,
    name: v.string(),
    description: v.string(),
    owner: v.string(),
    dataClassification: classificationValidator,
  },
  handler: async (ctx, args) => {
    const contractId = args.contractId ?? newId('ctr');
    const existing = await ctx.db
      .query('contractDefinitions')
      .withIndex('by_contractId', (q) => q.eq('contractId', contractId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A contract with this identifier already exists.', { contractId });
    }
    const now = Date.now();
    await ctx.db.insert('contractDefinitions', {
      contractId,
      kind: args.kind,
      name: args.name,
      description: args.description,
      owner: args.owner,
      dataClassification: args.dataClassification,
      createdAt: now,
      updatedAt: now,
    });
    return contractId;
  },
});

export const publishVersion = internalMutation({
  args: {
    contractId: v.string(),
    version: v.string(),
    schemaVersion: v.string(),
    checksum: v.string(),
  },
  handler: async (ctx, args) => {
    const definition = await ctx.db
      .query('contractDefinitions')
      .withIndex('by_contractId', (q) => q.eq('contractId', args.contractId))
      .first();
    if (!definition) {
      fail('NOT_FOUND', 'Contract definition not found.', { contractId: args.contractId });
    }
    const existing = await ctx.db
      .query('contractVersions')
      .withIndex('by_contractId_version', (q) =>
        q.eq('contractId', args.contractId).eq('version', args.version),
      )
      .first();
    if (existing) {
      fail('CONFLICT', 'This contract version already exists.', {
        contractId: args.contractId,
        version: args.version,
      });
    }
    const now = Date.now();
    await ctx.db.insert('contractVersions', {
      contractId: args.contractId,
      version: args.version,
      schemaVersion: args.schemaVersion,
      status: 'PUBLISHED',
      checksum: args.checksum,
      publishedAt: now,
      createdAt: now,
    });
    return true;
  },
});

export const setVersionStatus = internalMutation({
  args: {
    contractId: v.string(),
    version: v.string(),
    status: contractStatusValidator,
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('contractVersions')
      .withIndex('by_contractId_version', (q) =>
        q.eq('contractId', args.contractId).eq('version', args.version),
      )
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Contract version not found.', {
        contractId: args.contractId,
        version: args.version,
      });
    }
    const now = Date.now();
    await ctx.db.patch(record._id, {
      status: args.status,
      ...(args.status === 'DEPRECATED' ? { deprecatedAt: now } : {}),
      ...(args.status === 'RETIRED' ? { retiredAt: now } : {}),
    });
    return true;
  },
});
