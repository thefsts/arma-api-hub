// Webhook endpoints, deliveries, and delivery attempts.
//
// Endpoints store a secret *reference*, never a secret value.
//
// Phase 0: every read is an INTERNAL query (see
// docs/security/ADR-0005-authentication-decision.md). Webhook configuration,
// deliveries, and attempts are scoped to a service. A caller may only see
// endpoints, deliveries, and attempts belonging to a service it is authorized
// for; a delivery or attempt is resolved to its owning service through durable
// records and fails closed when unbound. Delivery scheduling, attempt
// recording, and dead-lettering are privileged internal operations.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { deliveryStatusValidator, failureClassValidator } from './lib/validators';
import {
  filterByServiceScope,
  requireAuthorizationContext,
  requireServiceScope,
} from './lib/authz';
import { deliveryAttemptDoc, webhookDeliveryDoc, webhookEndpointDoc } from './lib/returns';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import type { QueryCtx, MutationCtx } from './_generated/server';

async function resolveEndpointServiceId(
  ctx: QueryCtx | MutationCtx,
  endpointId: string,
): Promise<string | null> {
  const endpoint = await ctx.db
    .query('webhookEndpoints')
    .withIndex('by_endpointId', (q) => q.eq('endpointId', endpointId))
    .first();
  return endpoint ? endpoint.serviceId : null;
}

async function resolveDeliveryServiceId(
  ctx: QueryCtx | MutationCtx,
  deliveryId: string,
): Promise<string | null> {
  const delivery = await ctx.db
    .query('webhookDeliveries')
    .withIndex('by_deliveryId', (q) => q.eq('deliveryId', deliveryId))
    .first();
  if (!delivery) return null;
  return await resolveEndpointServiceId(ctx, delivery.endpointId);
}

export const listEndpoints = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(webhookEndpointDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db.query('webhookEndpoints').take(limit);
    return filterByServiceScope(authz, rows, (row) => row.serviceId);
  },
});

export const listEndpointsByService = internalQuery({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(webhookEndpointDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.serviceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const listDeliveriesByEndpoint = internalQuery({
  args: { endpointId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(webhookDeliveryDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const serviceId = await resolveEndpointServiceId(ctx, args.endpointId);
    if (serviceId === null) {
      fail('FORBIDDEN', 'The endpoint is not bound to an authorized service.', {
        endpointId: args.endpointId,
      });
    }
    requireServiceScope(authz, serviceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_endpointId', (q) => q.eq('endpointId', args.endpointId))
      .take(limit);
  },
});

export const listAttempts = internalQuery({
  args: { deliveryId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(deliveryAttemptDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const serviceId = await resolveDeliveryServiceId(ctx, args.deliveryId);
    if (serviceId === null) {
      fail('FORBIDDEN', 'The delivery is not bound to an authorized service.', {
        deliveryId: args.deliveryId,
      });
    }
    requireServiceScope(authz, serviceId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('deliveryAttempts')
      .withIndex('by_deliveryId', (q) => q.eq('deliveryId', args.deliveryId))
      .take(limit);
  },
});

export const registerEndpoint = internalMutation({
  args: {
    serviceId: v.string(),
    url: v.string(),
    secretRef: v.string(),
    allowListed: v.boolean(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const endpointId = newId('whk');
    const now = Date.now();
    await ctx.db.insert('webhookEndpoints', {
      endpointId,
      serviceId: args.serviceId,
      url: args.url,
      secretRef: args.secretRef,
      allowListed: args.allowListed,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    return endpointId;
  },
});

export const setEndpointActive = internalMutation({
  args: { endpointId: v.string(), active: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_endpointId', (q) => q.eq('endpointId', args.endpointId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Webhook endpoint not found.', { endpointId: args.endpointId });
    }
    await ctx.db.patch(record._id, { active: args.active, updatedAt: Date.now() });
    return record.endpointId;
  },
});

export const enqueueDelivery = internalMutation({
  args: {
    endpointId: v.string(),
    eventId: v.string(),
    nextAttemptAt: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const endpoint = await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_endpointId', (q) => q.eq('endpointId', args.endpointId))
      .first();
    if (!endpoint) {
      fail('NOT_FOUND', 'Webhook endpoint not found.', { endpointId: args.endpointId });
    }
    if (!endpoint.active || !endpoint.allowListed) {
      fail('POLICY_DENIED', 'The endpoint is not active or not allow-listed.', {
        endpointId: args.endpointId,
      });
    }
    const now = Date.now();
    const deliveryId = newId('dlv');
    await ctx.db.insert('webhookDeliveries', {
      deliveryId,
      endpointId: args.endpointId,
      eventId: args.eventId,
      status: 'PENDING',
      attemptCount: 0,
      ...(args.nextAttemptAt !== undefined ? { nextAttemptAt: args.nextAttemptAt } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return deliveryId;
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.string(),
    status: deliveryStatusValidator,
    failureClass: v.optional(failureClassValidator),
    responseStatus: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_deliveryId', (q) => q.eq('deliveryId', args.deliveryId))
      .first();
    if (!delivery) {
      fail('NOT_FOUND', 'Delivery not found.', { deliveryId: args.deliveryId });
    }
    const now = Date.now();
    const attempt = delivery.attemptCount + 1;
    await ctx.db.insert('deliveryAttempts', {
      deliveryId: args.deliveryId,
      attempt,
      status: args.status,
      ...(args.failureClass !== undefined ? { failureClass: args.failureClass } : {}),
      ...(args.responseStatus !== undefined ? { responseStatus: args.responseStatus } : {}),
      startedAt: now,
      finishedAt: now,
    });
    await ctx.db.patch(delivery._id, {
      status: args.status,
      attemptCount: attempt,
      ...(args.nextAttemptAt !== undefined ? { nextAttemptAt: args.nextAttemptAt } : {}),
      ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
      updatedAt: now,
    });
    return attempt;
  },
});

export const deadLetter = internalMutation({
  args: { deliveryId: v.string(), lastError: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_deliveryId', (q) => q.eq('deliveryId', args.deliveryId))
      .first();
    if (!delivery) {
      fail('NOT_FOUND', 'Delivery not found.', { deliveryId: args.deliveryId });
    }
    await ctx.db.patch(delivery._id, {
      status: 'DEAD_LETTERED',
      ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
      updatedAt: Date.now(),
    });
    return delivery.deliveryId;
  },
});

export const listDueDeliveries = internalQuery({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.array(webhookDeliveryDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_status_nextAttemptAt', (q) =>
        q.eq('status', 'PENDING').lte('nextAttemptAt', args.now),
      )
      .take(limit);
    const result: typeof rows = [];
    for (const row of rows) {
      const serviceId = await resolveEndpointServiceId(ctx, row.endpointId);
      if (serviceId !== null && (authz.global || authz.serviceIds.has(serviceId))) {
        result.push(row);
      }
    }
    return result;
  },
});
