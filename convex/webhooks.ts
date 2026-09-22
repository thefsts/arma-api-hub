// Webhook endpoints, deliveries, and delivery attempts.
//
// Endpoints store a secret *reference*, never a secret value. Delivery
// scheduling, attempt recording, and dead-lettering are privileged internal
// operations. Reads are public queries guarded by role.

import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { deliveryStatusValidator, failureClassValidator } from './lib/validators';
import { requireRole } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';

export const listEndpoints = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db.query('webhookEndpoints').take(limit);
  },
});

export const listEndpointsByService = query({
  args: { serviceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('webhookEndpoints')
      .withIndex('by_serviceId', (q) => q.eq('serviceId', args.serviceId))
      .take(limit);
  },
});

export const listDeliveriesByEndpoint = query({
  args: { endpointId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_endpointId', (q) => q.eq('endpointId', args.endpointId))
      .take(limit);
  },
});

export const listAttempts = query({
  args: { deliveryId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'viewer']);
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

export const listDueDeliveries = query({
  args: { now: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ['admin', 'operator', 'service']);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db
      .query('webhookDeliveries')
      .withIndex('by_status_nextAttemptAt', (q) =>
        q.eq('status', 'PENDING').lte('nextAttemptAt', args.now),
      )
      .take(limit);
  },
});
