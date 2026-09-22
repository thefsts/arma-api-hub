// Event records.
//
// Events carry correlation and causation identifiers for tracing. Recording an
// event is a privileged internal operation. Reads are public queries guarded by
// role.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { classificationValidator } from './lib/validators';
import { requireRole } from './lib/authz';
import { newId } from './lib/ids';

export const get = query({
  args: { eventId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('eventRecords')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .first();
  },
});

export const listByCorrelation = query({
  args: { correlationId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('eventRecords')
      .withIndex('by_correlationId', (q) => q.eq('correlationId', args.correlationId))
      .take(limit);
  },
});

export const listByType = query({
  args: { eventType: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('eventRecords')
      .withIndex('by_eventType', (q) => q.eq('eventType', args.eventType))
      .take(limit);
  },
});

export const record = internalMutation({
  args: {
    eventId: v.optional(v.string()),
    eventType: v.string(),
    source: v.string(),
    destination: v.string(),
    classification: classificationValidator,
    correlationId: v.string(),
    causationId: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    schemaVersion: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const eventId = args.eventId ?? newId('evt');
    await ctx.db.insert('eventRecords', {
      eventId,
      eventType: args.eventType,
      source: args.source,
      destination: args.destination,
      classification: args.classification,
      correlationId: args.correlationId,
      ...(args.causationId !== undefined ? { causationId: args.causationId } : {}),
      ...(args.idempotencyKey !== undefined ? { idempotencyKey: args.idempotencyKey } : {}),
      schemaVersion: args.schemaVersion,
      status: args.status,
      createdAt: Date.now(),
    });
    return eventId;
  },
});

export const setStatus = internalMutation({
  args: { eventId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('eventRecords')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .first();
    if (!record) return false;
    await ctx.db.patch(record._id, { status: args.status });
    return true;
  },
});
