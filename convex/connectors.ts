// Connector health and incidents.
//
// Health reporting and incident lifecycle are privileged internal operations.
// Reads are public queries guarded by role.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import {
  connectorStatusValidator,
  incidentSeverityValidator,
  incidentStatusValidator,
} from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const listHealth = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('connectorHealth').take(limit);
  },
});

export const getHealth = query({
  args: { connectorId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    return await ctx.db
      .query('connectorHealth')
      .withIndex('by_connectorId', (q) => q.eq('connectorId', args.connectorId))
      .first();
  },
});

export const listIncidents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('connectorIncidents').take(limit);
  },
});

export const listOpenIncidents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('connectorIncidents')
      .withIndex('by_status', (q) => q.eq('status', 'OPEN'))
      .take(limit);
  },
});

export const reportHealth = internalMutation({
  args: {
    connectorId: v.string(),
    serviceId: v.string(),
    status: connectorStatusValidator,
    latencyMs: v.optional(v.number()),
    errorRate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('connectorHealth')
      .withIndex('by_connectorId', (q) => q.eq('connectorId', args.connectorId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        lastCheckedAt: now,
        ...(args.latencyMs !== undefined ? { latencyMs: args.latencyMs } : {}),
        ...(args.errorRate !== undefined ? { errorRate: args.errorRate } : {}),
        updatedAt: now,
      });
      return existing.connectorId;
    }
    await ctx.db.insert('connectorHealth', {
      connectorId: args.connectorId,
      serviceId: args.serviceId,
      status: args.status,
      lastCheckedAt: now,
      ...(args.latencyMs !== undefined ? { latencyMs: args.latencyMs } : {}),
      ...(args.errorRate !== undefined ? { errorRate: args.errorRate } : {}),
      updatedAt: now,
    });
    return args.connectorId;
  },
});

export const openIncident = internalMutation({
  args: {
    connectorId: v.string(),
    severity: incidentSeverityValidator,
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const incidentId = newId('inc');
    await ctx.db.insert('connectorIncidents', {
      incidentId,
      connectorId: args.connectorId,
      severity: args.severity,
      status: 'OPEN',
      summary: args.summary,
      openedAt: Date.now(),
    });
    return incidentId;
  },
});

export const setIncidentStatus = internalMutation({
  args: { incidentId: v.string(), status: incidentStatusValidator },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('connectorIncidents')
      .withIndex('by_incidentId', (q) => q.eq('incidentId', args.incidentId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Incident not found.', { incidentId: args.incidentId });
    }
    await ctx.db.patch(record._id, {
      status: args.status,
      ...(args.status === 'RESOLVED' ? { closedAt: Date.now() } : {}),
    });
    return record.incidentId;
  },
});
