// FSTS Compliance Core — governed API service-identity authentication
// (Phase 6, Chat 1)
//
// Server-side authentication of the calling service identity. The presented
// identity is resolved against the Phase 5 `serviceIdentities` / `principals`
// records. Raw secrets are never stored; the caller proves possession of a
// shared secret via the request signature (verified in apiRequest.ts), while
// this module enforces identity existence, status, and product binding.

import { apiError } from "./apiErrors.ts";
import { requireNonEmptyString } from "./validation.ts";

export type ServiceIdentityRecord = {
  serviceIdentityId?: unknown;
  tenantId?: unknown;
  productId?: unknown;
  principalId?: unknown;
  scope?: unknown;
  status?: unknown;
};

export type PrincipalRecord = {
  principalId?: unknown;
  kind?: unknown;
  status?: unknown;
};

// Resolve and authenticate the presented service identity. Fail closed on
// missing, unknown, suspended, or revoked identities.
export function authenticateServiceIdentity(input: {
  presentedServiceIdentityId: unknown;
  tenantId: string;
  serviceIdentity: ServiceIdentityRecord | null | undefined;
  principal?: PrincipalRecord | null | undefined;
}): { serviceIdentityId: string; productId: string; principalId: string; scope: string } {
  const presented = requireNonEmptyString(
    input.presentedServiceIdentityId,
    "serviceIdentityId",
  );
  const si = input.serviceIdentity;
  if (!si) {
    throw apiError("IDENTITY_INVALID", "service identity not found");
  }
  if (si.serviceIdentityId !== presented) {
    throw apiError("IDENTITY_INVALID", "service identity mismatch");
  }
  // The service identity must belong to the tenant it claims.
  if (si.tenantId !== input.tenantId) {
    throw apiError("TENANT_ACCESS_DENIED", "service identity is not bound to the claimed tenant");
  }
  if (si.status === "REVOKED") {
    throw apiError("IDENTITY_REVOKED", "service identity is revoked");
  }
  if (si.status === "SUSPENDED") {
    throw apiError("IDENTITY_SUSPENDED", "service identity is suspended");
  }
  if (si.status !== "ACTIVE") {
    throw apiError("IDENTITY_INVALID", "service identity is not ACTIVE");
  }
  // The backing principal must be a SERVICE principal and ACTIVE.
  const principal = input.principal;
  if (principal) {
    if (principal.kind !== "SERVICE") {
      throw apiError("IDENTITY_INVALID", "backing principal is not a SERVICE principal");
    }
    if (principal.status === "REVOKED") {
      throw apiError("IDENTITY_REVOKED", "backing principal is revoked");
    }
    if (principal.status === "SUSPENDED") {
      throw apiError("IDENTITY_SUSPENDED", "backing principal is suspended");
    }
    if (principal.status !== "ACTIVE") {
      throw apiError("IDENTITY_INVALID", "backing principal is not ACTIVE");
    }
  }
  const productId = requireNonEmptyString(si.productId, "serviceIdentity.productId");
  const principalId = requireNonEmptyString(si.principalId, "serviceIdentity.principalId");
  const scope = requireNonEmptyString(si.scope, "serviceIdentity.scope");
  return { serviceIdentityId: presented, productId, principalId, scope };
}

// Least privilege: a service identity is bound to exactly one product. It must
// never be used to reach another product (PRODUCT_ISOLATION_VIOLATION).
export function assertServiceIdentityProductBinding(
  boundProductId: string,
  requestedProductId: string,
): void {
  if (boundProductId !== requestedProductId) {
    throw apiError(
      "PRODUCT_ISOLATION_VIOLATION",
      "service identity is not bound to the requested product",
    );
  }
}
