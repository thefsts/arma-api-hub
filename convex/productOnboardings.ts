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
  requireAdminAuthority,
  requireEnvironment,
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
    // Creating onboarding authority is a privileged control-plane action. It is
    // NOT "internal, therefore trusted": the caller must be a HUMAN
    // administrator AND be authorized both for the target environment AND for
    // the Hub routing identity being bound. A service identity can never
    // self-register a product (SERVICE principals do not hold admin authority),
    // and an administrator scoped to one service can never bind another
    // service's routing identity. Fail closed before touching durable authority.
    const authz = await requireAuthorizationContext(ctx);
    requireAdminAuthority(authz);
    requireEnvironment(authz, args.environment);
    requireServiceScope(authz, args.hubRoutingIdentity);

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
    // Exact binding: at most one onboarding may bind a given
    // (product, tenant, environment). Query the EXACT composite index so a
    // conflicting sibling can never be hidden behind a bounded `.take(N)` scan.
    // Zero rows → may create. A row with the same onboardingId → idempotent
    // replay. A row with a different onboardingId → CONFLICT (never create
    // ambiguous routing authority).
    const binding = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId_environment', (q) =>
        q
          .eq('productId', args.productId)
          .eq('tenantId', args.tenantId)
          .eq('environment', args.environment),
      )
      .take(1);
    const bound = binding[0];
    if (bound) {
      if (bound.onboardingId === onboardingId) return bound.onboardingId;
      fail(
        'CONFLICT',
        'A product onboarding already binds this product, tenant, and environment.',
        { onboardingId: bound.onboardingId },
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
    // Lifecycle progression is a privileged control-plane action. Require HUMAN
    // administrator authority AND authorization for the onboarding's
    // environment. A service identity (the product's own routing identity) can
    // never advance its own onboarding toward ACTIVE.
    const authz = await requireAuthorizationContext(ctx);
    requireAdminAuthority(authz);
    const record = await ctx.db
      .query('productOnboardings')
      .withIndex('by_onboardingId', (q) => q.eq('onboardingId', args.onboardingId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Product onboarding not found.', { onboardingId: args.onboardingId });
    }
    requireEnvironment(authz, record.environment);
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
    // Suspension/revocation is a privileged control-plane action. Require HUMAN
    // administrator authority AND authorization for the onboarding's
    // environment.
    const authz = await requireAuthorizationContext(ctx);
    requireAdminAuthority(authz);
    const record = await ctx.db
      .query('productOnboardings')
      .withIndex('by_onboardingId', (q) => q.eq('onboardingId', args.onboardingId))
      .first();
    if (!record) {
      fail('NOT_FOUND', 'Product onboarding not found.', { onboardingId: args.onboardingId });
    }
    requireEnvironment(authz, record.environment);
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

/**
 * Read a single onboarding by its EXACT (product, tenant, environment) binding.
 * This is the authoritative read contract: the binding IS the routing authority
 * key, so the read is unambiguous even when a tenant holds DEVELOPMENT, PREVIEW,
 * and PRODUCTION onboardings. It fails closed (CONFLICT) if more than one row
 * claims the exact binding rather than arbitrarily returning one.
 *
 * Scope is enforced on the onboarding's Hub routing identity (the service
 * identity the product calls as), never on the product id. The product id is not
 * a service identity and must not be used as an authorization key.
 */
export const getByProductTenantEnvironment = internalQuery({
  args: { productId: v.string(), tenantId: v.string(), environment: v.string() },
  returns: v.union(productOnboardingDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const rows = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId_environment', (q) =>
        q
          .eq('productId', args.productId)
          .eq('tenantId', args.tenantId)
          .eq('environment', args.environment),
      )
      .take(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      fail('CONFLICT', 'More than one onboarding claims this exact binding.', {
        productId: args.productId,
        tenantId: args.tenantId,
        environment: args.environment,
      });
    }
    const record = rows[0]!;
    requireServiceScope(authz, record.hubRoutingIdentity);
    return record;
  },
});

/**
 * @deprecated Ambiguous by design. A tenant may hold DEVELOPMENT, PREVIEW, and
 * PRODUCTION onboardings, so (product, tenant) does not identify a single
 * binding. Retained only for backward compatibility; it NEVER arbitrarily
 * returns a row. It returns null when nothing matches, the single match when
 * exactly one exists, and fails closed (CONFLICT) when the binding is ambiguous.
 * New callers MUST use `getByProductTenantEnvironment`.
 */
export const getByProductTenant = internalQuery({
  args: { productId: v.string(), tenantId: v.string() },
  returns: v.union(productOnboardingDoc, v.null()),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    const rows = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId', (q) =>
        q.eq('productId', args.productId).eq('tenantId', args.tenantId),
      )
      .take(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      fail(
        'CONFLICT',
        'Ambiguous read: more than one onboarding matches this product and tenant. Use getByProductTenantEnvironment.',
        { productId: args.productId, tenantId: args.tenantId },
      );
    }
    const record = rows[0]!;
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
      // How the durable worker must treat the denial (never blanket TERMINAL).
      disposition: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireServiceScope(authz, args.hubRoutingIdentity);
    // Exact binding lookup on the composite index. 0 rows → no onboarding for
    // this exact binding; 1 row → the routing authority; >1 rows → conflicting
    // authority (fail closed). Never `.first()`, never a bounded `.take(N)`
    // scan whose limit could hide a conflicting sibling. The environment is part
    // of the binding key, so a missing exact binding is reported by the pure
    // decision as PRODUCT_DENIED (the product is not onboarded for that
    // environment) — no silent environment escalation is possible.
    const rows = await ctx.db
      .query('productOnboardings')
      .withIndex('by_productId_tenantId_environment', (q) =>
        q
          .eq('productId', args.productId)
          .eq('tenantId', args.tenantId)
          .eq('environment', args.environment),
      )
      .take(2);
    // Conflicting authorization: more than one onboarding claims the same exact
    // binding. Fail closed rather than pick one.
    if (rows.length > 1) {
      return {
        allowed: false as const,
        code: 'CONFLICT' as const,
        disposition: 'TERMINAL' as const,
      };
    }
    const record = rows[0] ?? null;
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
    return {
      allowed: false as const,
      code: decision.code,
      disposition: decision.disposition,
    };
  },
});

// Re-exported so the routing vocabulary has a single import surface.
export { isOnboardingState, verifyTransitionHistory };
