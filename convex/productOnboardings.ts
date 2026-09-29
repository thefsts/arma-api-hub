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
import {
  requireAuthorizationContext,
  requireServiceScope,
  filterByServiceScope,
} from './lib/authz';
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
 * True when an existing onboarding carries exactly the governed fields a
 * re-registration supplies. Used to make `register` idempotent: a replay of the
 * same request returns the existing id, while a different payload under the
 * same id is a conflict.
 */
function sameGovernedContent(
  existing: {
    productId: string;
    tenantId: string;
    environment: string;
    hubRoutingIdentity: string;
    allowedScopes: string[];
    allowedOperations: string[];
    credentialReference: string;
    contractVersion: string;
    credentialExpiresAt?: number;
  },
  args: {
    productId: string;
    tenantId: string;
    environment: string;
    hubRoutingIdentity: string;
    allowedScopes: string[];
    allowedOperations: string[];
    credentialReference: string;
    contractVersion: string;
    credentialExpiresAt?: number;
  },
): boolean {
  const sameList = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((value, i) => value === b[i]);
  return (
    existing.productId === args.productId &&
    existing.tenantId === args.tenantId &&
    existing.environment === args.environment &&
    existing.hubRoutingIdentity === args.hubRoutingIdentity &&
    sameList(existing.allowedScopes, args.allowedScopes) &&
    sameList(existing.allowedOperations, args.allowedOperations) &&
    existing.credentialReference === args.credentialReference &&
    existing.contractVersion === args.contractVersion &&
    existing.credentialExpiresAt === args.credentialExpiresAt
  );
}

/**
 * Register a new product onboarding in PROPOSED state. Privileged internal
 * mutation: the caller (an FSTS operator surface) supplies the governed
 * identity. The onboarding is NOT consumable until it reaches ACTIVE.
 *
 * Idempotent by `onboardingId`: replaying the identical governed payload
 * returns the existing id; a different payload under the same id is a
 * conflict. At most one onboarding may bind a given
 * (productId, tenantId, environment); a second, different onboarding for the
 * same binding fails closed rather than creating ambiguous routing authority.
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
      // Idempotent replay: an identical governed payload returns the same id.
      if (sameGovernedContent(existing, args)) return existing.onboardingId;
      fail('CONFLICT', 'A product onboarding with this id already exists with different content.', {
        onboardingId,
      });
    }
    // Conflicting authorization: at most one onboarding may bind a given
    // (product, tenant, environment). A second, different onboarding for the
    // same binding fails closed instead of creating ambiguous routing.
    const siblings = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId', (q) =>
        q.eq('productId', args.productId).eq('tenantId', args.tenantId),
      )
      .take(10);
    const conflict = siblings.find((row) => row.environment === args.environment);
    if (conflict) {
      fail(
        'CONFLICT',
        'A product onboarding already binds this product, tenant, and environment.',
        { onboardingId: conflict.onboardingId },
      );
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
    const record = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId', (q) =>
        q.eq('productId', args.productId).eq('tenantId', args.tenantId),
      )
      .first();
    if (record === null) return null;
    // Scope on the onboarding's Hub routing identity (the service identity the
    // product calls as), never on the product id. The product id is not a
    // service identity and must not be used as an authorization key.
    requireServiceScope(authz, record.hubRoutingIdentity);
    return record;
  },
});

/** List onboardings for a product, filtered to the caller's service scope. */
export const listByProduct = internalQuery({
  args: { productId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(productOnboardingDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId', (q) => q.eq('productId', args.productId))
      .take(limit);
    // Only onboardings whose Hub routing identity the caller may access.
    return filterByServiceScope(authz, rows, (row) => row.hubRoutingIdentity);
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
    const rows = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId', (q) =>
        q.eq('productId', args.productId).eq('tenantId', args.tenantId),
      )
      .take(10);
    // Conflicting authorization: more than one onboarding claims the same
    // (product, tenant, environment) binding. Fail closed rather than pick one.
    const matching = rows.filter((row) => row.environment === args.environment);
    if (matching.length > 1) {
      return { allowed: false as const, code: 'CONFLICT' as const };
    }
    // When no row matches the requested environment, fall back to the first row
    // so the pure decision reports ENVIRONMENT_DENIED (no silent environment
    // escalation); a genuinely absent onboarding reports PRODUCT_DENIED.
    const record = matching[0] ?? rows[0] ?? null;
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
