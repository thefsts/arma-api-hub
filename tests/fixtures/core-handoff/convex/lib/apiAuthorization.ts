// FSTS Compliance Core — governed API authorization (Phase 6, Chat 1)
//
// Server-side authorization for governed calls. This module composes the Phase
// 5 authorization engine rather than reimplementing it. Two invariants:
//   1. A client-supplied tenantId is NEVER trusted on its own — it must be
//      resolved against an ACTIVE membership/role assignment server-side.
//   2. Product and environment scope are enforced server-side; a caller bound
//      to one product/environment can never reach another.

import { apiError } from "./apiErrors.ts";
import { requireNonEmptyString } from "./validation.ts";
import { authorize } from "./authorization.ts";

export type MembershipRecord = {
  tenantId?: unknown;
  principalId?: unknown;
  status?: unknown;
};

export type RoleAssignmentRecord = {
  role?: unknown;
  status?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
};

// Resolve the effective tenant server-side. The claimed tenant must be backed
// by an ACTIVE membership for the authenticated principal. Fail closed.
export function resolveTenant(input: {
  claimedTenantId: unknown;
  principalId: string;
  memberships: MembershipRecord[];
}): string {
  const claimed = requireNonEmptyString(input.claimedTenantId, "claimedTenantId");
  const memberships = Array.isArray(input.memberships) ? input.memberships : [];
  const match = memberships.find(
    (m) =>
      m &&
      m.tenantId === claimed &&
      m.principalId === input.principalId &&
      m.status === "ACTIVE",
  );
  if (!match) {
    // Distinguish "no membership at all" from "membership in another tenant".
    const anyMembership = memberships.some(
      (m) => m && m.principalId === input.principalId && m.status === "ACTIVE",
    );
    if (anyMembership) {
      throw apiError("TENANT_ACCESS_DENIED", "principal has no active membership in claimed tenant");
    }
    throw apiError("TENANT_UNRESOLVED", "principal has no active membership");
  }
  return claimed;
}

// Authorize the action within the resolved tenant, honoring product and
// environment scope. Composes the Phase 5 engine (role -> action map + scope
// matching). Never trusts UI roles.
export function authorizeGovernedAction(input: {
  principal: { principalId?: unknown; kind?: unknown; status?: unknown } | null | undefined;
  roleAssignments: RoleAssignmentRecord[];
  action: string;
  tenantId: string;
  resource?: { productId?: string; environment?: string };
}): { allowed: boolean; reason: string } {
  return authorize({
    principal: input.principal,
    roleAssignments: input.roleAssignments,
    action: input.action,
    tenantId: input.tenantId,
    resource: input.resource,
  });
}

// Enforce environment scope server-side. A caller bound to a specific
// environment may not act against another.
export function assertEnvironmentAuthorized(
  allowedEnvironments: readonly string[],
  requestedEnvironment: string,
): void {
  const env = requireNonEmptyString(requestedEnvironment, "environment");
  if (allowedEnvironments.length === 0 || !allowedEnvironments.includes(env)) {
    throw apiError("ENVIRONMENT_NOT_AUTHORIZED", `environment ${env} is not authorized`);
  }
}
