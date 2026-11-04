// ARMA API Hub — production operations / observability (Phase 9).
//
// The Hub records what it TRANSPORTED: governed request/response observations,
// hop timings, bounded failure codes, retry/replay/rate-limit facts, dependency
// availability snapshots, INTERNAL operational SLO windows, and API-Hub-owned
// transport cost. It does NOT record compliance verdicts, raw evidence, request
// bodies, signatures, secrets, or credentials.
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE -> HUB ->
// PRODUCT. The Hub transports; the Core decides. A transport outcome is NEVER a
// compliance verdict. Every stored row carries `complianceClaim: 'NONE'` and
// `certificationClaim: 'NONE'` as literals so a caller cannot claim otherwise.
//
// All functions are INTERNAL: none is client-callable. Reads enforce the
// caller's server-derived service/tenant/environment scope. Writes are
// privileged internal mutations invoked by the Hub transport or worker.

import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import {
  dependencyHealthInputValidator,
  observationInputValidator,
  sloWindowInputValidator,
  transportCostInputValidator,
} from './lib/validators';
import {
  requireAuthorizationContext,
  requireEnvironment,
  requireRole,
  requireServiceScope,
  requireTenantScope,
} from './lib/authz';
import { fail } from './lib/errors';
import { dependencyHealthSnapshotDoc, sloWindowDoc, transportObservationDoc } from './lib/returns';

const WRITER_ROLES = ['admin', 'operator', 'service'] as const;
const READER_ROLES = ['admin', 'operator', 'service', 'viewer'] as const;

/** Bound a caller-supplied limit to a safe range. */
function boundedLimit(limit: number | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(limit ?? fallback, 1), max);
}

/**
 * Record one transport observation. Privileged internal mutation. The caller
 * supplies the retention resolution (`retentionPolicyRef` + `expiresAt`) that
 * was computed from environment + data classification; nothing is hardcoded
 * here.
 */
export const recordObservation = internalMutation({
  args: {
    observation: observationInputValidator,
    retentionPolicyRef: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, WRITER_ROLES);
    if (args.observation.environment !== undefined) {
      requireEnvironment(authz, args.observation.environment);
    }
    const existing = await ctx.db
      .query('transportObservations')
      .withIndex('by_observationId', (q) => q.eq('observationId', args.observation.observationId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A transport observation with this id already exists.', {
        observationId: args.observation.observationId,
      });
    }
    await ctx.db.insert('transportObservations', {
      ...args.observation,
      ...(args.retentionPolicyRef !== undefined
        ? { retentionPolicyRef: args.retentionPolicyRef }
        : {}),
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
    return args.observation.observationId;
  },
});

/**
 * Record a governed hop observation. Enforces that the observation is a HOP and
 * names one of the four governed hops. Privileged internal mutation.
 */
export const recordHop = internalMutation({
  args: {
    observation: observationInputValidator,
    retentionPolicyRef: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, WRITER_ROLES);
    if (args.observation.kind !== 'HOP') {
      fail('VALIDATION_FAILED', 'recordHop requires an observation of kind HOP.', {
        kind: args.observation.kind,
      });
    }
    if (args.observation.hop === undefined) {
      fail('VALIDATION_FAILED', 'recordHop requires a hop value.');
    }
    if (args.observation.environment !== undefined) {
      requireEnvironment(authz, args.observation.environment);
    }
    const existing = await ctx.db
      .query('transportObservations')
      .withIndex('by_observationId', (q) => q.eq('observationId', args.observation.observationId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A transport observation with this id already exists.', {
        observationId: args.observation.observationId,
      });
    }
    await ctx.db.insert('transportObservations', {
      ...args.observation,
      ...(args.retentionPolicyRef !== undefined
        ? { retentionPolicyRef: args.retentionPolicyRef }
        : {}),
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
    return args.observation.observationId;
  },
});

/**
 * Return the full trace for a caller correlation reference, scoped to a single
 * (service, tenant, product). The caller correlation reference is an untrusted
 * lookup key only: the Hub-minted `traceId` remains the authoritative identity.
 * Cross-tenant / cross-product reads fail closed.
 */
export const getTraceByCorrelation = internalQuery({
  args: {
    serviceId: v.string(),
    tenantId: v.string(),
    productId: v.string(),
    callerCorrelationRef: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(transportObservationDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, READER_ROLES);
    requireServiceScope(authz, args.serviceId);
    requireTenantScope(authz, args.tenantId);
    const limit = boundedLimit(args.limit, 200, 1000);

    // Locate the Hub-minted trace id from the caller reference within the
    // caller's own tenant. Bounded scan; no `.filter()`.
    const tenantRows = await ctx.db
      .query('transportObservations')
      .withIndex('by_tenantId_observedAt', (q) => q.eq('tenantId', args.tenantId))
      .take(limit);
    const anchor = tenantRows.find(
      (row) =>
        row.callerCorrelationRef === args.callerCorrelationRef &&
        row.productId === args.productId &&
        typeof row.traceId === 'string',
    );
    if (!anchor) return [];

    const traceRows = await ctx.db
      .query('transportObservations')
      .withIndex('by_traceId_observedAt', (q) => q.eq('traceId', anchor.traceId))
      .take(limit);

    // Defence in depth: never return a row outside the caller's tenant/product
    // even if a trace id were ever reused across a boundary.
    return traceRows
      .filter((row) => row.tenantId === args.tenantId && row.productId === args.productId)
      .sort((a, b) => a.observedAt - b.observedAt);
  },
});

/**
 * List bounded failures for a tenant within a time window. Returns only rows
 * carrying a bounded failure code. Privileged internal query.
 */
export const listFailuresByWindow = internalQuery({
  args: {
    serviceId: v.string(),
    tenantId: v.string(),
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(transportObservationDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, READER_ROLES);
    requireServiceScope(authz, args.serviceId);
    requireTenantScope(authz, args.tenantId);
    if (args.to < args.from) {
      fail('VALIDATION_FAILED', 'Window end must not precede window start.');
    }
    const limit = boundedLimit(args.limit, 200, 1000);
    const rows = await ctx.db
      .query('transportObservations')
      .withIndex('by_tenantId_observedAt', (q) =>
        q.eq('tenantId', args.tenantId).gte('observedAt', args.from).lte('observedAt', args.to),
      )
      .take(limit);
    return rows.filter((row) => row.errorCode !== undefined);
  },
});

/**
 * Return the most recent availability snapshots for one dependency, newest
 * first. Privileged internal query.
 */
export const getDependencyHealth = internalQuery({
  args: {
    serviceId: v.string(),
    environment: v.string(),
    dependencyId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(dependencyHealthSnapshotDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, READER_ROLES);
    requireServiceScope(authz, args.serviceId);
    requireEnvironment(authz, args.environment);
    const limit = boundedLimit(args.limit, 50, 200);
    const rows = await ctx.db
      .query('dependencyHealthSnapshots')
      .withIndex('by_dependencyId_observedAt', (q) => q.eq('dependencyId', args.dependencyId))
      .order('desc')
      .take(limit);
    return rows.filter((row) => row.environment === args.environment);
  },
});

/**
 * Derive the current operational state of the Hub for an environment from the
 * latest snapshot per dependency. Fail-closed: UNKNOWN never silently becomes
 * AVAILABLE. `complianceClaim` is always NONE.
 */
export const getServiceHealth = internalQuery({
  args: { serviceId: v.string(), environment: v.string() },
  returns: v.object({
    state: v.union(
      v.literal('AVAILABLE'),
      v.literal('DEGRADED'),
      v.literal('UNAVAILABLE'),
      v.literal('UNKNOWN'),
    ),
    complianceClaim: v.literal('NONE'),
    certificationClaim: v.literal('NONE'),
    dependencies: v.array(
      v.object({
        dependencyId: v.string(),
        dependencyType: v.string(),
        state: v.string(),
        observedAt: v.number(),
      }),
    ),
    reasons: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, READER_ROLES);
    requireServiceScope(authz, args.serviceId);
    requireEnvironment(authz, args.environment);

    const rows = await ctx.db
      .query('dependencyHealthSnapshots')
      .withIndex('by_environment_observedAt', (q) => q.eq('environment', args.environment))
      .order('desc')
      .take(500);

    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.dependencyId)) latest.set(row.dependencyId, row);
    }

    const dependencies = [...latest.values()].map((row) => ({
      dependencyId: row.dependencyId,
      dependencyType: row.dependencyType,
      state: row.state,
      observedAt: row.observedAt,
    }));

    const reasons: string[] = [];
    let state: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN' = 'AVAILABLE';

    if (dependencies.length === 0) {
      state = 'UNKNOWN';
      reasons.push('NO_DEPENDENCY_OBSERVATIONS');
    } else {
      const mandatory = dependencies.filter((d) => d.dependencyType === 'CORE');
      if (mandatory.some((d) => d.state === 'UNAVAILABLE')) {
        state = 'UNAVAILABLE';
        reasons.push('MANDATORY_DEPENDENCY_UNAVAILABLE');
      } else if (mandatory.some((d) => d.state === 'UNKNOWN')) {
        state = 'UNKNOWN';
        reasons.push('MANDATORY_DEPENDENCY_UNKNOWN');
      } else if (dependencies.some((d) => d.state === 'DEGRADED')) {
        state = 'DEGRADED';
        reasons.push('DEPENDENCY_DEGRADED');
      } else if (dependencies.some((d) => d.state === 'UNKNOWN')) {
        state = 'UNKNOWN';
        reasons.push('DEPENDENCY_UNKNOWN');
      } else {
        state = 'AVAILABLE';
        reasons.push('ALL_DEPENDENCIES_AVAILABLE');
      }
    }

    return {
      state,
      complianceClaim: 'NONE' as const,
      certificationClaim: 'NONE' as const,
      dependencies,
      reasons,
    };
  },
});

/** Record a dependency availability snapshot. Privileged internal mutation. */
export const recordDependencyHealth = internalMutation({
  args: { snapshot: dependencyHealthInputValidator },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, WRITER_ROLES);
    requireEnvironment(authz, args.snapshot.environment);
    const existing = await ctx.db
      .query('dependencyHealthSnapshots')
      .withIndex('by_snapshotId', (q) => q.eq('snapshotId', args.snapshot.snapshotId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A dependency health snapshot with this id already exists.', {
        snapshotId: args.snapshot.snapshotId,
      });
    }
    await ctx.db.insert('dependencyHealthSnapshots', {
      ...args.snapshot,
    });
    return args.snapshot.snapshotId;
  },
});

/**
 * Persist a computed INTERNAL operational SLO window. `targetClass` is the
 * literal INTERNAL_OPERATIONAL_TARGET; this is not an SLA or certification.
 * Privileged internal mutation (worker-invoked).
 */
export const computeSloWindow = internalMutation({
  args: { window: sloWindowInputValidator },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, WRITER_ROLES);
    if (args.window.windowEnd < args.window.windowStart) {
      fail('VALIDATION_FAILED', 'SLO window end must not precede window start.');
    }
    const existing = await ctx.db
      .query('sloWindows')
      .withIndex('by_windowId', (q) => q.eq('windowId', args.window.windowId))
      .first();
    if (existing) {
      fail('CONFLICT', 'An SLO window with this id already exists.', {
        windowId: args.window.windowId,
      });
    }
    await ctx.db.insert('sloWindows', { ...args.window, createdAt: Date.now() });
    return args.window.windowId;
  },
});

/** List INTERNAL operational SLO windows in a time range. Internal query. */
export const getSloWindows = internalQuery({
  args: {
    serviceId: v.string(),
    from: v.number(),
    to: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.array(sloWindowDoc),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, READER_ROLES);
    requireServiceScope(authz, args.serviceId);
    if (args.to < args.from) {
      fail('VALIDATION_FAILED', 'Window end must not precede window start.');
    }
    const limit = boundedLimit(args.limit, 100, 500);
    return await ctx.db
      .query('sloWindows')
      .withIndex('by_windowStart', (q) =>
        q.gte('windowStart', args.from).lte('windowStart', args.to),
      )
      .order('desc')
      .take(limit);
  },
});

/**
 * Record API-Hub-owned transport cost. `costOwner` is the literal API_HUB and
 * `complianceClaim` is NONE: this is not product profitability or model cost.
 * Privileged internal mutation.
 */
export const recordTransportCost = internalMutation({
  args: { cost: transportCostInputValidator },
  returns: v.string(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, WRITER_ROLES);
    requireServiceScope(authz, args.cost.serviceId);
    if (args.cost.environment !== undefined) {
      requireEnvironment(authz, args.cost.environment);
    }
    if (!Number.isInteger(args.cost.amountMinor) || args.cost.amountMinor < 0) {
      fail('VALIDATION_FAILED', 'Transport cost amountMinor must be a non-negative integer.');
    }
    const existing = await ctx.db
      .query('transportCostRecords')
      .withIndex('by_costRecordId', (q) => q.eq('costRecordId', args.cost.costRecordId))
      .first();
    if (existing) {
      fail('CONFLICT', 'A transport cost record with this id already exists.', {
        costRecordId: args.cost.costRecordId,
      });
    }
    await ctx.db.insert('transportCostRecords', { ...args.cost, createdAt: Date.now() });
    return args.cost.costRecordId;
  },
});

/**
 * Purge observations whose governed retention window has elapsed. Worker
 * internal mutation. `now` is supplied explicitly so the operation is
 * deterministic and testable.
 */
export const purgeExpiredObservations = internalMutation({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authz = await requireAuthorizationContext(ctx);
    requireRole(authz, WRITER_ROLES);
    const limit = boundedLimit(args.limit, 500, 2000);
    const expired = await ctx.db
      .query('transportObservations')
      .withIndex('by_expiresAt', (q) => q.lte('expiresAt', args.now))
      .take(limit);
    let purged = 0;
    for (const row of expired) {
      // Fail-closed retention: a row whose retention policy could not be
      // resolved has no `expiresAt` and must never be treated as expired.
      if (row.expiresAt === undefined) continue;
      await ctx.db.delete(row._id);
      purged += 1;
    }
    return purged;
  },
});
