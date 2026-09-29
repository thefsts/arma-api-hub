// FSTS Compliance Core — identity primitives (Phase 5, Chat 1)
//
// Authority concepts are server-side only. UI roles are never authorization.
// Service identities use least privilege and are product-bound.

import { ValidationError, requireNonEmptyString } from "./validation.ts";

export const PRINCIPAL_KINDS = ["HUMAN", "SERVICE"] as const;
export const PRINCIPAL_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;

export const ROLES = [
  "FSTS_OWNER_ADMIN",
  "COMPLIANCE_ADMINISTRATOR",
  "COMPLIANCE_ANALYST",
  "LEGAL_REVIEWER",
  "AUDITOR_READ_ONLY",
  "SERVICE_IDENTITY",
  "PRODUCT_INTEGRATION",
] as const;

export function isServiceIdentity(
  principal: { kind?: unknown } | null | undefined,
): boolean {
  return !!principal && principal.kind === "SERVICE";
}

export function assertPrincipalActive(
  principal: { status?: unknown } | null | undefined,
): void {
  if (!principal || principal.status !== "ACTIVE") {
    throw new ValidationError("PRINCIPAL_INACTIVE", "principal is not ACTIVE");
  }
}

export function assertLeastPrivilege(
  serviceIdentity: { scope?: unknown; productId?: unknown } | null | undefined,
): void {
  if (!serviceIdentity) {
    throw new ValidationError("SERVICE_IDENTITY_MISSING", "service identity required");
  }
  requireNonEmptyString(serviceIdentity.scope, "serviceIdentity.scope");
  requireNonEmptyString(serviceIdentity.productId, "serviceIdentity.productId");
}
