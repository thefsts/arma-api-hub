// Server-derived authorization for the ARMA API Hub control plane.
//
// SECURITY MODEL (Phase 0)
// ------------------------
//   * No human identity provider is approved for Phase 0. Every control-plane
//     data function is therefore an INTERNAL function (see
//     docs/security/ADR-0005-authentication-decision.md). Internal functions
//     are not client-callable, so no unauthenticated human access is possible.
//   * Authorization is NEVER derived from caller-supplied claims or
//     caller-supplied scope. The authenticated subject (a human subject or a
//     service identity) is first verified against the configured trusted
//     issuer, then resolved against durable `principalAuthorizations` records.
//     The resulting scope is what gets enforced.
//   * Missing, malformed, unknown, or untrusted identity fails CLOSED.
//   * Cross-tenant / cross-service access is possible ONLY through an explicit,
//     durable `global` grant (the FSTS owner/admin grant). That grant is
//     modeled, authenticated, tested, and audited.
//
// The trusted issuer is read from the `ARMA_TRUSTED_ISSUER` environment
// variable. When it is unset the module fails closed: no caller is ever
// considered authenticated. This is deliberate — a placeholder issuer would be
// a fake authentication provider.

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { fail } from './errors';

export type Role = 'admin' | 'operator' | 'service' | 'viewer';
export type PrincipalType = 'HUMAN' | 'SERVICE';

/** The server-derived, enforcement-ready authorization context. */
export interface AuthorizationContext {
  readonly principalId: string;
  readonly principalType: PrincipalType;
  readonly roles: readonly Role[];
  /** Explicit FSTS owner/admin grant. The only source of cross-scope access. */
  readonly global: boolean;
  readonly systemIds: ReadonlySet<string>;
  readonly serviceIds: ReadonlySet<string>;
  readonly tenantIds: ReadonlySet<string>;
  readonly customerRefs: ReadonlySet<string>;
  readonly capabilities: ReadonlySet<string>;
  readonly environments: ReadonlySet<string>;
}

/**
 * The configured trusted issuer. Returns null when unset, which makes every
 * authorization check fail closed.
 */
export function trustedIssuer(): string | null {
  const value = process.env.ARMA_TRUSTED_ISSUER;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Return the verified subject of the caller, or null when the caller is
 * unauthenticated or the identity does not originate from the configured
 * trusted issuer. Caller-supplied roles are never trusted here.
 */
export async function getVerifiedSubject(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const issuer = trustedIssuer();
  if (issuer === null) return null;
  if (identity.issuer !== issuer) return null;
  if (typeof identity.subject !== 'string' || identity.subject.length === 0) return null;
  return identity.subject;
}

/**
 * Resolve a durable authorization binding into an enforcement context. Returns
 * null when no ACTIVE binding exists for the principal.
 */
export async function resolveAuthorizationContext(
  ctx: QueryCtx | MutationCtx,
  principalId: string,
): Promise<AuthorizationContext | null> {
  const record = await ctx.db
    .query('principalAuthorizations')
    .withIndex('by_principalId_state', (q) =>
      q.eq('principalId', principalId).eq('state', 'ACTIVE'),
    )
    .first();
  if (!record) return null;
  // A service identity can never be a cross-scope administrator. Treat an
  // invalid durable record as unauthorised instead of allowing `global` to
  // bypass service binding. Human administrators remain explicitly modeled
  // through HUMAN + global records.
  if (record.principalType === 'SERVICE' && record.global) return null;
  return {
    principalId: record.principalId,
    principalType: record.principalType,
    roles: record.roles,
    global: record.global,
    systemIds: new Set(record.systemIds),
    serviceIds: new Set(record.serviceIds),
    tenantIds: new Set(record.tenantIds),
    customerRefs: new Set(record.customerRefs),
    capabilities: new Set(record.capabilities),
    environments: new Set(record.environments),
  };
}

/**
 * Require a verified, durably-authorized caller. Fails closed when the caller
 * is unauthenticated, untrusted, or has no active authorization binding.
 */
export async function requireAuthorizationContext(
  ctx: QueryCtx | MutationCtx,
): Promise<AuthorizationContext> {
  const subject = await getVerifiedSubject(ctx);
  if (subject === null) {
    fail('UNAUTHENTICATED', 'A verified identity from the configured issuer is required.');
  }
  const context = await resolveAuthorizationContext(ctx, subject);
  if (context === null) {
    fail('FORBIDDEN', 'No active authorization binding exists for this principal.');
  }
  return context;
}

// --- Scope predicates --------------------------------------------------------

export function canAccessSystem(ctx: AuthorizationContext, systemId: string): boolean {
  return ctx.global || ctx.systemIds.has(systemId);
}

export function canAccessService(ctx: AuthorizationContext, serviceId: string): boolean {
  // A service principal is cryptographically bound to its own subject. Its
  // durable serviceIds list cannot delegate it access to another service.
  if (ctx.principalType === 'SERVICE') return ctx.principalId === serviceId;
  return ctx.global || ctx.serviceIds.has(serviceId);
}

export function canAccessTenant(ctx: AuthorizationContext, tenantId: string): boolean {
  return ctx.global || ctx.tenantIds.has(tenantId);
}

export function canAccessCustomer(ctx: AuthorizationContext, customerRef: string): boolean {
  return ctx.global || ctx.customerRefs.has(customerRef);
}

export function hasCapability(ctx: AuthorizationContext, capability: string): boolean {
  return ctx.global || ctx.capabilities.has(capability);
}

export function canAccessEnvironment(ctx: AuthorizationContext, environment: string): boolean {
  return ctx.global || ctx.environments.has(environment);
}

export function hasRole(ctx: AuthorizationContext, allowed: readonly Role[]): boolean {
  return ctx.roles.some((role) => allowed.includes(role));
}

// --- Enforcement helpers (throw on denial) -----------------------------------

export function requireGlobal(ctx: AuthorizationContext): void {
  if (!ctx.global) {
    fail('FORBIDDEN', 'Global (FSTS owner/admin) authorization is required for this operation.');
  }
}

export function requireRole(ctx: AuthorizationContext, allowed: readonly Role[]): void {
  if (!hasRole(ctx, allowed)) {
    fail('FORBIDDEN', 'The caller does not hold a role permitted for this operation.');
  }
}

/**
 * Onboarding administration authority. Creating, advancing, suspending, or
 * revoking product-onboarding authority is a privileged CONTROL-PLANE action
 * reserved for a HUMAN administrator. A SERVICE principal (a product calling in
 * as its own routing identity) may NEVER administer onboarding authority, even
 * if a durable record mistakenly grants it the `admin` role: the product must
 * never be able to self-register or self-activate. This makes the "SERVICE
 * principals do not hold admin" invariant enforced rather than assumed.
 */
export function requireAdminAuthority(ctx: AuthorizationContext): void {
  if (ctx.principalType !== 'HUMAN') {
    fail('FORBIDDEN', 'Onboarding administration requires a human administrator.');
  }
  requireRole(ctx, ['admin']);
}

export function requireSystemScope(ctx: AuthorizationContext, systemId: string): void {
  if (!canAccessSystem(ctx, systemId)) {
    fail('FORBIDDEN', 'The caller is not authorized for this system.', { systemId });
  }
}

export function requireServiceScope(ctx: AuthorizationContext, serviceId: string): void {
  if (!canAccessService(ctx, serviceId)) {
    fail('FORBIDDEN', 'The caller is not authorized for this service.', { serviceId });
  }
}

export function requireTenantScope(ctx: AuthorizationContext, tenantId: string): void {
  if (!canAccessTenant(ctx, tenantId)) {
    fail('FORBIDDEN', 'The caller is not authorized for this tenant.', { tenantId });
  }
}

export function requireCustomerScope(ctx: AuthorizationContext, customerRef: string): void {
  if (!canAccessCustomer(ctx, customerRef)) {
    fail('FORBIDDEN', 'The caller is not authorized for this customer.', { customerRef });
  }
}

export function requireCapability(ctx: AuthorizationContext, capability: string): void {
  if (!hasCapability(ctx, capability)) {
    fail('FORBIDDEN', 'The caller does not hold the required capability.', { capability });
  }
}

export function requireEnvironment(ctx: AuthorizationContext, environment: string): void {
  if (!canAccessEnvironment(ctx, environment)) {
    fail('FORBIDDEN', 'The caller is not authorized for this environment.', { environment });
  }
}

/**
 * Service-identity binding. A service caller may only act on its own
 * server-derived service identity. A caller that supplies a different
 * `serviceId` is rejected, even when it holds the `service` role.
 */
export function requireServiceBinding(ctx: AuthorizationContext, serviceId: string): void {
  if (ctx.principalType === 'SERVICE') {
    if (ctx.principalId === serviceId) return;
    fail('FORBIDDEN', 'The service caller is not bound to the requested service identity.', {
      serviceId,
    });
  }
  if (ctx.global) return;
  if (ctx.serviceIds.has(serviceId)) return;
  fail('FORBIDDEN', 'The caller is not bound to the requested service identity.', { serviceId });
}

/** True when the caller may see every row (explicit global grant only). */
export function isGlobal(ctx: AuthorizationContext): boolean {
  return ctx.global;
}

/** Filter rows to those the caller is authorized to see by service scope. */
export function filterByServiceScope<T>(
  ctx: AuthorizationContext,
  rows: readonly T[],
  getServiceId: (row: T) => string,
): T[] {
  if (ctx.principalType === 'SERVICE') {
    return rows.filter((row) => ctx.principalId === getServiceId(row));
  }
  if (ctx.global) return [...rows];
  return rows.filter((row) => ctx.serviceIds.has(getServiceId(row)));
}

/** Filter rows to those the caller is authorized to see by system scope. */
export function filterBySystemScope<T>(
  ctx: AuthorizationContext,
  rows: readonly T[],
  getSystemId: (row: T) => string,
): T[] {
  if (ctx.global) return [...rows];
  return rows.filter((row) => ctx.systemIds.has(getSystemId(row)));
}

/**
 * Resolve the owning service of a connector from durable records. Connectors
 * are sub-resources of a service; the binding is read from the connector
 * subscription or the connector health record. Returns null when the connector
 * is not bound to any known service, which callers treat as fail-closed.
 */
export async function resolveConnectorServiceId(
  ctx: QueryCtx | MutationCtx,
  connectorId: string,
): Promise<string | null> {
  const subscription = await ctx.db
    .query('connectorSubscriptions')
    .withIndex('by_connectorId', (q) => q.eq('connectorId', connectorId))
    .first();
  if (subscription) return subscription.serviceId;
  const health = await ctx.db
    .query('connectorHealth')
    .withIndex('by_connectorId', (q) => q.eq('connectorId', connectorId))
    .first();
  if (health) return health.serviceId;
  return null;
}

/**
 * Enforce that the caller is authorized for the service that owns a connector.
 * A connector that is not bound to any known service fails closed.
 */
export async function requireConnectorScope(
  ctx: QueryCtx | MutationCtx,
  authz: AuthorizationContext,
  connectorId: string,
): Promise<void> {
  if (authz.global) return;
  const serviceId = await resolveConnectorServiceId(ctx, connectorId);
  if (serviceId === null) {
    fail('FORBIDDEN', 'The connector is not bound to an authorized service.', { connectorId });
  }
  requireServiceScope(authz, serviceId);
}

/**
 * Filter connector-scoped rows to those whose owning service the caller may
 * access. Rows whose connector is unbound are dropped (fail closed).
 */
export async function filterByConnectorScope<T>(
  ctx: QueryCtx | MutationCtx,
  authz: AuthorizationContext,
  rows: readonly T[],
  getConnectorId: (row: T) => string,
): Promise<T[]> {
  if (authz.principalType === 'HUMAN' && authz.global) return [...rows];
  const result: T[] = [];
  for (const row of rows) {
    const serviceId = await resolveConnectorServiceId(ctx, getConnectorId(row));
    if (serviceId !== null && canAccessService(authz, serviceId)) {
      result.push(row);
    }
  }
  return result;
}

/**
 * Enforce tenant and customer scope for a cost/usage row. A row that carries a
 * tenant or customer reference the caller is not authorized for is rejected.
 */
export function requireRowScope(
  authz: AuthorizationContext,
  row: { tenantId?: string; customerRef?: string },
): void {
  if (authz.global) return;
  if (row.tenantId !== undefined) requireTenantScope(authz, row.tenantId);
  if (row.customerRef !== undefined) requireCustomerScope(authz, row.customerRef);
}

/** True when the caller may see a cost/usage row under tenant + customer scope. */
export function canAccessRow(
  authz: AuthorizationContext,
  row: { tenantId?: string; customerRef?: string },
): boolean {
  if (authz.global) return true;
  if (row.tenantId !== undefined && !authz.tenantIds.has(row.tenantId)) return false;
  if (row.customerRef !== undefined && !authz.customerRefs.has(row.customerRef)) return false;
  return true;
}

/**
 * Enforce scope for a resource that declares an explicit `scope`/`scopeId`
 * pair (quota allocations, budgets). Unknown scope kinds fail closed.
 */
export async function requireScopeByKind(
  ctx: QueryCtx | MutationCtx,
  authz: AuthorizationContext,
  scope: string,
  scopeId: string,
): Promise<void> {
  if (authz.global) return;
  switch (scope) {
    case 'SERVICE':
      requireServiceScope(authz, scopeId);
      return;
    case 'SYSTEM':
      requireSystemScope(authz, scopeId);
      return;
    case 'TENANT':
      requireTenantScope(authz, scopeId);
      return;
    case 'CUSTOMER':
      requireCustomerScope(authz, scopeId);
      return;
    case 'CONNECTOR':
      await requireConnectorScope(ctx, authz, scopeId);
      return;
    default:
      fail('FORBIDDEN', 'The caller is not authorized for this scope.', { scope, scopeId });
  }
}
