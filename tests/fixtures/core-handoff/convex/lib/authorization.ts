// FSTS Compliance Core — authorization engine (Phase 5, Chat 1)
//
// Server-side only. Authorization never depends on UI roles or a
// client-supplied tenant id. A product integration identity must never gain
// access to another product.

import { ValidationError, requireNonEmptyString } from "./validation.ts";
import { ROLES } from "./auth.ts";

// Role -> permitted actions. "*" is the FSTS owner/admin super-scope.
//
// NOTE (Chat 2, additive): the compliance-runtime actions (runtime:*,
// verification:*, evidence:*, exception:*, remediation:*, readiness:*) are
// added here so the Phase 5 runtime functions can consume this single
// authorization engine rather than building a competing one. Existing actions
// are unchanged.
//
// Phase 5 (Chat 4) ADDITIVE legal/regulatory actions:
//   legal:read     — read legal operational intelligence
//   legal:write    — register/refresh legal runtime state from Git
//   legal:monitor  — run official-source checks and record monitoring runs
//   legal:review   — classify changes and record legal/human review decisions
//   legal:handoff  — open legal->policy handoff contracts
// These are additive; no existing action or role is removed or re-scoped.
//
// Phase 6 (Chat 1) ADDITIVE governed-API actions:
//   api:invoke — invoke a governed Compliance Service/API contract
//   api:admin  — register/manage governed API contracts
//
// Phase 6 (Chat 3) ADDITIVE policy release / distribution / adoption actions:
//   lifecycle:read        — read policy release lifecycle state + projections
//   lifecycle:write       — record pack runtime, drift, handoffs
//   lifecycle:approve     — record a policy approval decision
//   lifecycle:release     — record a signed release
//   lifecycle:distribute  — distribute a signed release / acknowledge delivery
//   lifecycle:adopt       — record an adoption receipt / adoption state
//   lifecycle:rollback    — record a rollback
//   lifecycle:hold        — place / release retention / legal holds
// These are additive; no existing action or role is removed or re-scoped.
//
// Phase 7 (Chat 1) ADDITIVE production-onboarding actions:
//   onboarding:read      - read onboarding / registry state
//   onboarding:write     - propose onboarding, register identities/products/bindings
//   onboarding:approve   - review / approve / reject an onboarding
//   onboarding:provision - provision an approved onboarding
//   onboarding:verify    - verify a provisioned onboarding
//   onboarding:activate  - activate a verified onboarding (the ONLY path to ACTIVE)
//   onboarding:suspend   - suspend an active onboarding
//   onboarding:revoke    - revoke an onboarding (terminal)
// These are additive; no existing action or role is removed or re-scoped.
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  FSTS_OWNER_ADMIN: ["*"],
  COMPLIANCE_ADMINISTRATOR: [
    "tenant:read",
    "tenant:write",
    "product:read",
    "product:write",
    "identity:read",
    "identity:write",
    "registry:sync",
    "audit:read",
    "integration:read",
    "integration:write",
    "runtime:read",
    "runtime:write",
    "verification:read",
    "verification:write",
    "evidence:read",
    "evidence:write",
    "exception:read",
    "exception:write",
    "exception:approve",
    "remediation:read",
    "remediation:write",
    "readiness:read",
    "readiness:write",
    "legal:read",
    "legal:write",
    "legal:monitor",
    "legal:review",
    "legal:handoff",
    "lifecycle:read",
    "lifecycle:write",
    "lifecycle:approve",
    "lifecycle:release",
    "lifecycle:distribute",
    "lifecycle:adopt",
    "lifecycle:rollback",
    "lifecycle:hold",
    "api:invoke",
    "api:admin",
    "onboarding:read",
    "onboarding:write",
    "onboarding:approve",
    "onboarding:provision",
    "onboarding:verify",
    "onboarding:activate",
    "onboarding:suspend",
    "onboarding:revoke",
  ],
  COMPLIANCE_ANALYST: [
    "tenant:read",
    "product:read",
    "identity:read",
    "audit:read",
    "integration:read",
    "runtime:read",
    "runtime:write",
    "verification:read",
    "verification:write",
    "evidence:read",
    "evidence:write",
    "exception:read",
    "remediation:read",
    "remediation:write",
    "readiness:read",
    "legal:read",
    "lifecycle:read",
    "lifecycle:write",
    "lifecycle:distribute",
    "lifecycle:adopt",
    "onboarding:read",
  ],
  LEGAL_REVIEWER: [
    "tenant:read",
    "product:read",
    "audit:read",
    "runtime:read",
    "verification:read",
    "evidence:read",
    "exception:read",
    "exception:approve",
    "readiness:read",
    "legal:read",
    "legal:review",
    "lifecycle:read",
    "lifecycle:hold",
    "onboarding:read",
  ],
  AUDITOR_READ_ONLY: [
    "tenant:read",
    "product:read",
    "identity:read",
    "audit:read",
    "integration:read",
    "runtime:read",
    "verification:read",
    "evidence:read",
    "exception:read",
    "remediation:read",
    "readiness:read",
    "legal:read",
    "lifecycle:read",
    "onboarding:read",
  ],
  SERVICE_IDENTITY: [
    "registry:sync",
    "audit:write",
    "runtime:read",
    "verification:write",
    "evidence:write",
    "legal:monitor",
    "lifecycle:read",
    "lifecycle:distribute",
    "api:invoke",
    "onboarding:read",
  ],
  PRODUCT_INTEGRATION: [
    "product:read",
    "integration:read",
    "integration:write",
    "audit:write",
    "runtime:read",
    "verification:write",
    "evidence:write",
    "legal:read",
    "lifecycle:read",
    "lifecycle:adopt",
    "api:invoke",
    "onboarding:read",
  ],
};

export function isKnownRole(role: unknown): boolean {
  return typeof role === "string" && (ROLES as readonly string[]).includes(role);
}

export function roleAllows(role: string, action: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes("*") || perms.includes(action);
}

export function authorize(input: {
  principal: { principalId?: unknown; kind?: unknown; status?: unknown } | null | undefined;
  roleAssignments: Array<{
    role?: unknown;
    status?: unknown;
    scopeType?: unknown;
    scopeId?: unknown;
  }>;
  action: string;
  tenantId: string;
  resource?: { productId?: unknown; environment?: unknown };
}): { allowed: boolean; reason: string } {
  const principal = input.principal;
  if (!principal || principal.status !== "ACTIVE") {
    return { allowed: false, reason: "PRINCIPAL_INACTIVE" };
  }
  const action = requireNonEmptyString(input.action, "action");
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const resource = input.resource ?? {};
  const assignments = (input.roleAssignments || []).filter((a) => a && a.status === "ACTIVE");

  const effective = assignments.filter((a) => {
    if (a.scopeType === "TENANT") return a.scopeId === tenantId;
    if (a.scopeType === "PRODUCT") return a.scopeId === resource.productId;
    if (a.scopeType === "ENVIRONMENT") return a.scopeId === resource.environment;
    return false;
  });

  if (effective.length === 0) {
    return { allowed: false, reason: "NO_SCOPE_ASSIGNMENT" };
  }
  for (const a of effective) {
    if (typeof a.role === "string" && roleAllows(a.role, action)) {
      return { allowed: true, reason: `GRANTED_BY_${a.role}` };
    }
  }
  return { allowed: false, reason: "ACTION_NOT_PERMITTED" };
}

// Tenant access requires an ACTIVE membership server-side.
export function canAccessTenant(
  principalId: string,
  tenantId: string,
  memberships: Array<{ tenantId?: unknown; principalId?: unknown; status?: unknown }>,
): boolean {
  return (memberships || []).some(
    (m) =>
      m &&
      m.tenantId === tenantId &&
      m.principalId === principalId &&
      m.status === "ACTIVE",
  );
}

// Product access for a service identity is bound to exactly one product.
export function canAccessProduct(
  serviceIdentity: { productId?: unknown } | null | undefined,
  targetProductId: string,
): boolean {
  return (
    !!serviceIdentity &&
    typeof serviceIdentity.productId === "string" &&
    serviceIdentity.productId === targetProductId
  );
}

export function assertAuthorized(result: { allowed: boolean; reason: string }): void {
  if (!result.allowed) {
    throw new ValidationError("UNAUTHORIZED", `authorization denied: ${result.reason}`);
  }
}
