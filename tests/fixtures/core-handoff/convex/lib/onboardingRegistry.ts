// FSTS Compliance Core — Phase 7 (Chat 1) production onboarding registries
//
// Pure, deterministic models + fail-closed validators for the three governed
// registries: SERVICE IDENTITY, PRODUCT REGISTRATION and TENANT BINDING, plus
// metadata-only CREDENTIAL REFERENCES (references + digests, never material).
//
// Every validator throws a bounded ApiError. Nothing here performs I/O. The
// Convex functions persist; the governed pipeline gates; these modules decide.
//
// SECURITY: credential material is NEVER accepted here. Only a reference string
// and a digest string. A caller that supplies material is rejected.

import { apiError } from "./apiErrors.ts";

// ---------------------------------------------------------------------------
// Closed unions (mirror convex/schema.ts Phase 7 enums exactly)
// ---------------------------------------------------------------------------
export const SERVICE_IDENTITY_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type ServiceIdentityStatus = (typeof SERVICE_IDENTITY_STATUSES)[number];

export const CREDENTIAL_ROTATION_STATES = ["CURRENT", "ROTATING", "EXPIRED", "REVOKED"] as const;
export type CredentialRotationState = (typeof CREDENTIAL_ROTATION_STATES)[number];

export const PRODUCT_INTEGRATION_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type ProductIntegrationStatus = (typeof PRODUCT_INTEGRATION_STATUSES)[number];

export const TENANT_BINDING_TYPES = ["PRODUCT", "SERVICE", "ENVIRONMENT", "SCOPE"] as const;
export type TenantBindingType = (typeof TENANT_BINDING_TYPES)[number];

// ---------------------------------------------------------------------------
// Record shapes (persistence-agnostic; the schema stores the same fields)
// ---------------------------------------------------------------------------
export type ServiceIdentityRecord = {
  serviceIdentityId: string;
  serviceName: string;
  status: ServiceIdentityStatus;
  allowedEnvironments: readonly string[];
  allowedProducts: readonly string[];
  allowedTenants: readonly string[];
  allowedScopes: readonly string[];
  credentialRef: string;
  credentialRotationState: CredentialRotationState;
  credentialIssuedAt: number;
  credentialExpiresAt: number;
  credentialRotatedAt?: number;
  rotationDueAt?: number;
  previousCredentialRef?: string;
};

export type ProductRegistrationRecord = {
  productId: string;
  productName: string;
  owningSystem: string;
  environment: string;
  integrationStatus: ProductIntegrationStatus;
  authorizedTenantScopes: readonly string[];
  apiContractVersion: string;
  apiHubRoutingId: string;
  activationTimestamp?: number;
  suspensionTimestamp?: number;
  revocationTimestamp?: number;
};

export type TenantBindingRecord = {
  bindingId: string;
  bindingType: TenantBindingType;
  subjectRef: string;
  targetTenantId: string;
  environment?: string;
  scope?: string;
  status: ServiceIdentityStatus;
  grantedAt: number;
  revokedAt?: number;
};

export type CredentialReferenceRecord = {
  credentialRefId: string;
  serviceIdentityId: string;
  credentialRef: string;
  credentialDigest: string;
  algorithm: string;
  rotationState: CredentialRotationState;
  issuedAt: number;
  expiresAt: number;
  rotatedAt?: number;
  rotationDueAt?: number;
  revokedAt?: number;
  previousCredentialRef?: string;
};

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------
const DIGEST_RE = /^[a-f0-9]{64}$/; // SHA-256 hex
const REF_RE = /^[A-Za-z0-9._:/@-]{3,256}$/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// Reject anything that looks like raw key material. References and digests are
// fine; a PEM block, a long base64 blob or a labelled secret is not.
const MATERIAL_MARKERS = ["-----BEGIN", "PRIVATE KEY", "SECRET=", "API_KEY=", "PASSWORD="];
export function assertNoCredentialMaterial(value: unknown): void {
  if (typeof value !== "string") return;
  const upper = value.toUpperCase();
  for (const marker of MATERIAL_MARKERS) {
    if (upper.includes(marker)) {
      throw apiError("CREDENTIAL_INVALID", "credential material must never be stored");
    }
  }
  if (value.length > 512) {
    throw apiError("CREDENTIAL_INVALID", "credential value too long to be a reference");
  }
}

export function assertCredentialReference(ref: unknown): string {
  if (!isNonEmptyString(ref) || !REF_RE.test(ref)) {
    throw apiError("CREDENTIAL_INVALID", "invalid credential reference");
  }
  assertNoCredentialMaterial(ref);
  return ref;
}

export function assertCredentialDigest(digest: unknown): string {
  if (!isNonEmptyString(digest) || !DIGEST_RE.test(digest)) {
    throw apiError("CREDENTIAL_INVALID", "invalid credential digest (expect sha-256 hex)");
  }
  return digest;
}

// ---------------------------------------------------------------------------
// SERVICE IDENTITY validation
// ---------------------------------------------------------------------------
export function assertServiceIdentityActive(record: ServiceIdentityRecord): void {
  if (record.status === "REVOKED") {
    throw apiError("IDENTITY_REVOKED", "service identity revoked");
  }
  if (record.status === "SUSPENDED") {
    throw apiError("IDENTITY_SUSPENDED", "service identity suspended");
  }
  if (record.status !== "ACTIVE") {
    throw apiError("IDENTITY_INVALID", "service identity not active");
  }
}

export function assertEnvironmentAllowed(
  record: ServiceIdentityRecord,
  environment: unknown,
): void {
  if (!isNonEmptyString(environment) || !record.allowedEnvironments.includes(environment)) {
    throw apiError("ENVIRONMENT_NOT_AUTHORIZED", "environment not authorized for service identity");
  }
}

export function assertProductAllowed(record: ServiceIdentityRecord, productId: unknown): void {
  if (!isNonEmptyString(productId) || !record.allowedProducts.includes(productId)) {
    throw apiError("PRODUCT_ISOLATION_VIOLATION", "product not authorized for service identity");
  }
}

export function assertTenantAllowed(record: ServiceIdentityRecord, tenantId: unknown): void {
  if (!isNonEmptyString(tenantId) || !record.allowedTenants.includes(tenantId)) {
    throw apiError("TENANT_ACCESS_DENIED", "tenant not authorized for service identity");
  }
}

export function assertScopeAllowed(record: ServiceIdentityRecord, scope: unknown): void {
  if (!isNonEmptyString(scope) || !record.allowedScopes.includes(scope)) {
    throw apiError("SCOPE_VIOLATION", "scope not authorized for service identity");
  }
}

// Credential + rotation validation. Fails closed on expiry, revocation and
// overdue/invalid rotation.
export function assertCredentialUsable(record: ServiceIdentityRecord, now: number): void {
  assertCredentialReference(record.credentialRef);
  if (record.credentialRotationState === "REVOKED") {
    throw apiError("CREDENTIAL_REVOKED", "credential revoked");
  }
  if (record.credentialRotationState === "EXPIRED") {
    throw apiError("CREDENTIAL_EXPIRED", "credential expired");
  }
  if (typeof record.credentialExpiresAt !== "number" || record.credentialExpiresAt <= now) {
    throw apiError("CREDENTIAL_EXPIRED", "credential expired");
  }
  // Rotation state machine: CURRENT may be rotated on schedule; ROTATING must
  // complete by rotationDueAt; anything overdue is invalid.
  if (record.credentialRotationState === "ROTATING") {
    if (typeof record.rotationDueAt !== "number" || record.rotationDueAt < now) {
      throw apiError("ROTATION_INVALID", "rotation overdue");
    }
  }
  if (record.credentialRotationState === "CURRENT" && typeof record.rotationDueAt === "number") {
    if (record.rotationDueAt < now) {
      throw apiError("ROTATION_INVALID", "rotation overdue");
    }
  }
}

// ---------------------------------------------------------------------------
// PRODUCT REGISTRATION validation
// ---------------------------------------------------------------------------
export function assertProductConsumable(record: ProductRegistrationRecord): void {
  if (record.integrationStatus === "PENDING") {
    throw apiError("PRODUCT_NOT_APPROVED", "product integration not approved");
  }
  if (record.integrationStatus === "SUSPENDED") {
    throw apiError("INTEGRATION_INACTIVE", "product integration suspended");
  }
  if (record.integrationStatus === "REVOKED") {
    throw apiError("INTEGRATION_INACTIVE", "product integration revoked");
  }
  if (record.integrationStatus !== "ACTIVE") {
    throw apiError("PRODUCT_NOT_APPROVED", "product integration not active");
  }
  if (!isNonEmptyString(record.apiHubRoutingId)) {
    throw apiError("PRODUCT_NOT_APPROVED", "product missing API Hub routing identity");
  }
}

export function assertProductTenantScope(
  record: ProductRegistrationRecord,
  tenantScope: unknown,
): void {
  if (!isNonEmptyString(tenantScope) || !record.authorizedTenantScopes.includes(tenantScope)) {
    throw apiError("TENANT_ACCESS_DENIED", "tenant scope not authorized for product");
  }
}

// ---------------------------------------------------------------------------
// TENANT BINDING validation
// ---------------------------------------------------------------------------
export function assertTenantBinding(
  bindings: readonly TenantBindingRecord[],
  query: { bindingType: TenantBindingType; subjectRef: string; targetTenantId: string },
): TenantBindingRecord {
  const match = bindings.find(
    (b) =>
      b.bindingType === query.bindingType &&
      b.subjectRef === query.subjectRef &&
      b.targetTenantId === query.targetTenantId &&
      b.status === "ACTIVE" &&
      typeof b.revokedAt !== "number",
  );
  if (!match) {
    throw apiError("TENANT_BINDING_MISSING", "required tenant binding not present");
  }
  return match;
}

export function assertScopeBound(
  bindings: readonly TenantBindingRecord[],
  query: { subjectRef: string; targetTenantId: string; scope: string },
): TenantBindingRecord {
  const match = bindings.find(
    (b) =>
      b.bindingType === "SCOPE" &&
      b.subjectRef === query.subjectRef &&
      b.targetTenantId === query.targetTenantId &&
      b.scope === query.scope &&
      b.status === "ACTIVE" &&
      typeof b.revokedAt !== "number",
  );
  if (!match) {
    throw apiError("SCOPE_NOT_BOUND", "required scope binding not present");
  }
  return match;
}

// ---------------------------------------------------------------------------
// Credential reference record validation (metadata-only)
// ---------------------------------------------------------------------------
export function assertCredentialReferenceRecord(
  record: CredentialReferenceRecord,
  now: number,
): void {
  assertCredentialReference(record.credentialRef);
  assertCredentialDigest(record.credentialDigest);
  if (record.rotationState === "REVOKED" || typeof record.revokedAt === "number") {
    throw apiError("CREDENTIAL_REVOKED", "credential reference revoked");
  }
  if (record.rotationState === "EXPIRED" || record.expiresAt <= now) {
    throw apiError("CREDENTIAL_EXPIRED", "credential reference expired");
  }
  if (record.rotationState === "ROTATING") {
    if (typeof record.rotationDueAt !== "number" || record.rotationDueAt < now) {
      throw apiError("ROTATION_INVALID", "credential rotation overdue");
    }
  }
}
