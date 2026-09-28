// Connector health and incidents.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Reads enforce the
// caller's server-derived service scope. Connectors are sub-resources of a
// service, so a connector-scoped row is authorized only when the caller is
// authorized for the owning service. Health reporting and incident lifecycle
// are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  connectorStatusValidator,
  incidentSeverityValidator,
  incidentStatusValidator,
} from './lib/validators';
import {
  filterByConnectorScope,
  filterByServiceScope,
  requireAuthorizationContext,
  requireServiceScope,
} from './lib/authz';
import { connectorHealthDoc, connectorIncidentDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const listHealth = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(connectorHealthDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db.query('connectorHealth').take(limit);
    return filterByServiceScope(authz, rows, (row) => row.serviceId);
  },
});

export const getHealth = internalQuery({
  args: { connectorId: v.string() },
  returns: v.union(connectorHealthDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const record = await ctx.db
      .query('connectorHealth')
      .withIndex('by_connectorId', (q) => q.eq('connectorId', args.connectorId))
      .first();
    if (record === null) return null;
    requireServiceScope(authz, record.serviceId);
    return record;
  },
});

export const listIncidents = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(connectorIncidentDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db.query('connectorIncidents').take(limit);
    return await filterByConnectorScope(ctx, authz, rows, (row) => row.connectorId);
  },
});

export const listOpenIncidents = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(connectorIncidentDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('connectorIncidents')
      .withIndex('by_status', (q) => q.eq('status', 'OPEN'))
      .take(limit);
    return await filterByConnectorScope(ctx, authz, rows, (row) => row.connectorId);
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
  returns: v.string(),
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
  returns: v.string(),
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
  returns: v.string(),
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
