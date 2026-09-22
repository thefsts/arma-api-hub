// Event records.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Events carry correlation
// and causation identifiers for tracing. An event is visible only when the
// caller is authorized for the service that produced it (`source`) or the
// service that consumes it (`destination`). Recording an event is a privileged
// internal operation.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { classificationValidator } from './lib/validators';
import { requireAuthorizationContext, requireRole } from './lib/authz';
import { eventRecordDoc } from './lib/returns';
import { newId } from './lib/ids';

type EventRow = { source: string; destination: string };

function canSeeEvent(
  authz: { global: boolean; serviceIds: ReadonlySet<string> },
  row: EventRow,
): boolean {
  if (authz.global) return true;
  return authz.serviceIds.has(row.source) || authz.serviceIds.has(row.destination);
}

export const get = internalQuery({
  args: { eventId: v.string() },
  returns: v.union(eventRecordDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, ['admin', 'operator', 'viewer']);
    const record = await ctx.db
      .query('eventRecords')
      .withIndex('by_eventId', (q) => q.eq('eventId', args.eventId))
      .first();
    if (record === null) return null;
    if (!canSeeEvent(authz, record)) return null;
    return record;
  },
});

export const listByCorrelation = internalQuery({
  args: { correlationId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(eventRecordDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('eventRecords')
      .withIndex('by_correlationId', (q) => q.eq('correlationId', args.correlationId))
      .take(limit);
    return rows.filter((row) => canSeeEvent(authz, row));
  },
});

export const listByType = internalQuery({
  args: { eventType: v.string(), limit: v.optional(v.number()) },
  returns: v.array(eventRecordDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('eventRecords')
      .withIndex('by_eventType', (q) => q.eq('eventType', args.eventType))
      .take(limit);
    return rows.filter((row) => canSeeEvent(authz, row));
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
  returns: v.string(),
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
  returns: v.boolean(),
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
