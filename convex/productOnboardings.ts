// ARMA API Hub — product onboarding (Phase 8).
//
// The Hub-side registry that binds a real FSTS product (ARMA System 360 is the
// first) to the governed Core path. It records the governed product identity:
// product id, tenant, environment, Hub routing identity, allowed scopes,
// allowed operations, credential *reference*, and contract version.
//
// This is the Hub's ROUTING registry, not a compliance authority. The Hub
// transports; the Core decides. A routing ALLOW is an operational fact, never a
// compliance verdict.
//
// Reads are INTERNAL queries that enforce the caller's server-derived service
// scope (mirroring `convex/serviceIdentities.ts`). Writes are privileged
// internal mutations. Nothing here is client-callable.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { onboardingStateValidator } from './lib/validators';
import { requireAuthorizationContext, requireServiceScope } from './lib/authz';
import { fail } from './lib/errors';
import { newId } from './lib/ids';
import {
  decideRouting,
  isOnboardingState,
  isTerminal,
  canTransition,
  verifyTransitionHistory,
  type ProductOnboardingRecord,
} from './lib/productRouting';

/** The stored product onboarding document shape (returned to internal callers). */
const productOnboardingDoc = v.object({
  _id: v.id('productOnboardings'),
  _creationTime: v.number(),
  onboardingId: v.string(),
  productId: v.string(),
  tenantId: v.string(),
  environment: v.string(),
  hubRoutingIdentity: v.string(),
  allowedScopes: v.array(v.string()),
  allowedOperations: v.array(v.string()),
  credentialReference: v.string(),
  contractVersion: v.string(),
  state: onboardingStateValidator,
  history: v.array(v.string()),
  credentialExpiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Register a new product onboarding in PROPOSED state. Privileged internal
 * mutation: the caller (an FSTS operator surface) supplies the governed
 * identity. The onboarding is NOT consumable until it reaches ACTIVE.
 */
export const register = internalMutation({
  args: {
    onboardingId: v.optional(v.string()),
    productId: v.string(),
    tenantId: v.string(),
    environment: v.string(),
    hubRoutingIdentity: v.string(),
    allowedScopes: v.array(v.string()),
    allowedOperations: v.array(v.string()),
    credentialReference: v.string(),
    contractVersion: v.string(),
    credentialExpiresAt: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const onboardingId = args.onboardingId ?? newId('onb');
    const existing = await ctx.db
      .query('productOnboardings')
      .withIndex('by_onboardingId', (q) => q.eq('onboardingId', onboardingId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A product onboarding with this id already exists.', { onboardingId });
    }
    const now = Date.now();
    await ctx.db.insert('productOnboardings', {
      onboardingId,
      productId: args.productId,
      tenantId: args.tenantId,
      environment: args.environment,
      hubRoutingIdentity: args.hubRoutingIdentity,
      allowedScopes: args.allowedScopes,
      allowedOperations: args.allowedOperations,
      credentialReference: args.credentialReference,
      contractVersion: args.contractVersion,
      state: 'PROPOSED',
      history: ['PROPOSED'],
      ...(args.credentialExpiresAt !== undefined
        ? { credentialExpiresAt: args.credentialExpiresAt }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    return onboardingId;
  },
});

/**
 * Advance an onboarding along the closed transition table. The recorded history
 * is appended so a forged ACTIVE claim (a state with no legal walk) is rejected
 * by `decideRouting`. Privileged internal mutation.
 */
export const advanceState = internalMutation({
  args: { onboardingId: v.string(), to: onboardingStateValidator },
  returns: v.string(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('productOnboardings')
      .withIndex('by_onboardingId', (q) => q.eq('onboardingId', args.onboardingId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Product onboarding not found.', { onboardingId: args.onboardingId });
    }
    if (isTerminal(record.state)) {
      fail('CONFLICT', 'Product onboarding is in a terminal state.', { state: record.state });
    }
    if (!canTransition(record.state, args.to)) {
      fail('VALIDATION_FAILED', `Illegal onboarding transition ${record.state} -> ${args.to}.`, {
        from: record.state,
        to: args.to,
      });
    }
    const history = [...record.history, args.to];
    await ctx.db.patch(record._id, {
      state: args.to,
      history,
      updatedAt: Date.now(),
    });
    return record.onboardingId;
  },
});

/**
 * Suspend or revoke an onboarding. Both fail closed at the routing gate; REVOKED
 * is terminal (a new onboarding is required to recover). Privileged internal
 * mutation.
 */
export const setLifecycleState = internalMutation({
  args: {
    onboardingId: v.string(),
    state: v.union(v.literal('SUSPENDED'), v.literal('REVOKED')),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query('productOnboardings')
      .withIndex('by_onboardingId', (q) => q.eq('onboardingId', args.onboardingId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Product onboarding not found.', { onboardingId: args.onboardingId });
    }
    if (isTerminal(record.state)) {
      fail('CONFLICT', 'Product onboarding is already terminal.', { state: record.state });
    }
    const history = [...record.history, args.state];
    await ctx.db.patch(record._id, {
      state: args.state,
      history,
      updatedAt: Date.now(),
    });
    return record.onboardingId;
  },
});

/** Read a single onboarding by its product + tenant binding. */
export const getByProductTenant = internalQuery({
  args: { productId: v.string(), tenantId: v.string() },
  returns: v.union(productOnboardingDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.productId);
    return await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId', (q) =>
        q.eq('productId', args.productId).eq('tenantId', args.tenantId),
      )
      .first();
  },
});

/** List onboardings for a product. */
export const listByProduct = internalQuery({
  args: { productId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(productOnboardingDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.productId);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    return await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId', (q) => q.eq('productId', args.productId))
      .take(limit);
  },
});

/**
 * Compute the fail-closed routing decision for a product request. Loads the
 * onboarding bound to (productId, tenantId) and runs the pure decision. Returns
 * a bounded ALLOW/DENY. `now` is supplied by the caller so the query stays
 * deterministic (no wall-clock in a query handler).
 */
export const route = internalQuery({
  args: {
    productId: v.string(),
    tenantId: v.string(),
    environment: v.string(),
    hubRoutingIdentity: v.string(),
    operation: v.string(),
    scope: v.string(),
    contractVersion: v.string(),
    apiVersion: v.string(),
    now: v.number(),
  },
  returns: v.union(
    v.object({
      allowed: v.literal(true),
      route: v.object({
        productId: v.string(),
        tenantId: v.string(),
        environment: v.string(),
        hubRoutingIdentity: v.string(),
        operation: v.string(),
        scope: v.string(),
        contractVersion: v.string(),
        apiVersion: v.string(),
        credentialReference: v.string(),
      }),
    }),
    v.object({
      allowed: v.literal(false),
      code: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.hubRoutingIdentity);
    const record = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId', (q) =>
        q.eq('productId', args.productId).eq('tenantId', args.tenantId),
      )
      .first();
    const onboarding: ProductOnboardingRecord | null = record
      ? {
          productId: record.productId,
          tenantId: record.tenantId,
          environment: record.environment,
          hubRoutingIdentity: record.hubRoutingIdentity,
          allowedScopes: record.allowedScopes,
          allowedOperations: record.allowedOperations,
          credentialReference: record.credentialReference,
          contractVersion: record.contractVersion,
          state: record.state,
          history: record.history,
          ...(record.credentialExpiresAt !== undefined
            ? { credentialExpiresAt: record.credentialExpiresAt }
            : {}),
        }
      : null;
    const decision = decideRouting(
      {
        productId: args.productId,
        tenantId: args.tenantId,
        environment: args.environment,
        hubRoutingIdentity: args.hubRoutingIdentity,
        operation: args.operation,
        scope: args.scope,
        contractVersion: args.contractVersion,
        apiVersion: args.apiVersion,
      },
      onboarding,
      args.now,
    );
    if (decision.allowed) {
      return { allowed: true as const, route: decision.route };
    }
    return { allowed: false as const, code: decision.code };
  },
});

// Re-exported so the routing vocabulary has a single import surface.
export { isOnboardingState, verifyTransitionHistory };
