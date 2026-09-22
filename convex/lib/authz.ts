// Authorization helpers for the ARMA API Hub control plane.
//
// Public functions are authorization-aware: they require an authenticated
// caller and, where appropriate, a specific role. Privileged lifecycle, retry,
// receipt, audit, and credential operations are exposed only as internal
// functions, which are not reachable from clients.

import type { MutationCtx, QueryCtx } from '../_generated/server';
import { fail } from './errors';

export type Role = 'admin' | 'operator' | 'service' | 'viewer';

export interface CallerIdentity {
  subject: string;
  roles: Role[];
}

const KNOWN_ROLES: ReadonlySet<string> = new Set(['admin', 'operator', 'service', 'viewer']);

function parseRoles(claims: Record<string, unknown>): Role[] {
  const raw = claims['roles'] ?? claims['role'];
  const list: string[] = [];
  if (typeof raw === 'string') {
    list.push(...raw.split(/[\s,]+/));
  } else if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === 'string') list.push(entry);
    }
  }
  const roles = list.map((r) => r.trim().toLowerCase()).filter((r) => KNOWN_ROLES.has(r));
  return Array.from(new Set(roles)) as Role[];
}

/** Resolve the caller identity, or null when unauthenticated. */
export async function getCaller(ctx: QueryCtx | MutationCtx): Promise<CallerIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const claims = identity as unknown as Record<string, unknown>;
  return { subject: identity.subject, roles: parseRoles(claims) };
}

/** Require an authenticated caller. */
export async function requireCaller(ctx: QueryCtx | MutationCtx): Promise<CallerIdentity> {
  const caller = await getCaller(ctx);
  if (!caller) {
    fail('UNAUTHENTICATED', 'Authentication is required for this operation.');
  }
  return caller;
}

/** Require an authenticated caller holding at least one of the allowed roles. */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  allowed: readonly Role[],
): Promise<CallerIdentity> {
  const caller = await requireCaller(ctx);
  if (!caller.roles.some((role) => allowed.includes(role))) {
    fail('FORBIDDEN', 'The caller does not hold a role permitted for this operation.');
  }
  return caller;
}
