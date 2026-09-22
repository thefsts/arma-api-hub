// Cost & Usage Guard — vendors, immutable price versions, and subscriptions.
//
// Reads are public queries guarded by role. Writes are privileged internal
// mutations. Vendor credentials are NEVER stored here — only vendor identity,
// pricing metadata, and subscription metadata.
//
// Price versions are immutable: a new price is always a new row. Historical
// usage keeps the pricingVersionId that applied when the request occurred.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import {
  classificationValidator,
  environmentValidator,
  lifecycleValidator,
  usageUnitValidator,
} from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import { resolveEffectivePriceVersion } from './lib/cost';

export const listVendors = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('apiVendors').take(limit);
  },
});

export const getVendor = query({
  args: { vendorId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('apiVendors')
      .withIndex('by_vendorId', (q) => q.eq('vendorId', args.vendorId))
      .first();
  },
});

export const listPriceVersions = query({
  args: { vendorId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('vendorPriceVersions')
      .withIndex('by_vendorId', (q) => q.eq('vendorId', args.vendorId))
      .take(limit);
  },
});

/**
 * Resolve the price version effective at a point in time. Returns null when no
 * version applies — callers must fail closed rather than guess a price.
 */
export const resolvePriceVersion = query({
  args: { vendorId: v.string(), at: v.number() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const versions = await ctx.db
      .query('vendorPriceVersions')
      .withIndex('by_vendorId_effectiveFrom', (q) => q.eq('vendorId', args.vendorId))
      .take(500);
    return resolveEffectivePriceVersion(versions, args.at);
  },
});

export const listSubscriptions = query({
  args: { connectorId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('connectorSubscriptions')
      .withIndex('by_connectorId', (q) => q.eq('connectorId', args.connectorId))
      .take(limit);
  },
});

export const registerVendor = internalMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    lifecycle: lifecycleValidator,
    environment: environmentValidator,
    owner: v.string(),
    dataClassification: classificationValidator,
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('apiVendors')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (existing) {
      fail('CONFLICT', 'A vendor with this slug already exists.', { slug: args.slug });
    }
    const now = Date.now();
    const vendorId = newId('vnd');
    await ctx.db.insert('apiVendors', {
      vendorId,
      name: args.name,
      slug: args.slug,
      lifecycle: args.lifecycle,
      environment: args.environment,
      owner: args.owner,
      dataClassification: args.dataClassification,
      createdAt: now,
      updatedAt: now,
    });
    return vendorId;
  },
});

/**
 * Add an immutable price version. A new price is always a new row; existing
 * rows are never mutated. When `effectiveTo` is omitted the version is open.
 */
export const addPriceVersion = internalMutation({
  args: {
    vendorId: v.string(),
    unitType: usageUnitValidator,
    unitPriceMinor: v.number(),
    currency: v.string(),
    pricingSource: v.string(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.unitPriceMinor) || args.unitPriceMinor < 0) {
      fail('VALIDATION_FAILED', 'unitPriceMinor must be a non-negative integer (minor units).');
    }
    if (args.effectiveTo !== undefined && args.effectiveTo <= args.effectiveFrom) {
      fail('VALIDATION_FAILED', 'effectiveTo must be after effectiveFrom.');
    }
    const vendor = await ctx.db
      .query('apiVendors')
      .withIndex('by_vendorId', (q) => q.eq('vendorId', args.vendorId))
      .first();
    if (!vendor) {
      fail('NOT_FOUND', 'Vendor not found.', { vendorId: args.vendorId });
    }
    const pricingVersionId = newId('prc');
    await ctx.db.insert('vendorPriceVersions', {
      pricingVersionId,
      vendorId: args.vendorId,
      unitType: args.unitType,
      unitPriceMinor: args.unitPriceMinor,
      currency: args.currency,
      pricingSource: args.pricingSource,
      effectiveFrom: args.effectiveFrom,
      ...(args.effectiveTo !== undefined ? { effectiveTo: args.effectiveTo } : {}),
      createdAt: Date.now(),
    });
    return pricingVersionId;
  },
});

export const registerSubscription = internalMutation({
  args: {
    connectorId: v.string(),
    vendorId: v.string(),
    serviceId: v.string(),
    plan: v.string(),
    lifecycle: lifecycleValidator,
    monthlyBaseMinor: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.monthlyBaseMinor) || args.monthlyBaseMinor < 0) {
      fail('VALIDATION_FAILED', 'monthlyBaseMinor must be a non-negative integer (minor units).');
    }
    const now = Date.now();
    const subscriptionId = newId('sub');
    await ctx.db.insert('connectorSubscriptions', {
      subscriptionId,
      connectorId: args.connectorId,
      vendorId: args.vendorId,
      serviceId: args.serviceId,
      plan: args.plan,
      lifecycle: args.lifecycle,
      monthlyBaseMinor: args.monthlyBaseMinor,
      currency: args.currency,
      createdAt: now,
      updatedAt: now,
    });
    return subscriptionId;
  },
});
