// FSTS Compliance Core — Phase 7 (Chat 1) governed onboarding gate
//
// The fail-closed gate that the governed pipeline calls AFTER identity auth and
// BEFORE dispatch. It proves that a request from a product (transported by the
// ARMA API Hub) is backed by a fully ACTIVE onboarding: service identity,
// product registration and tenant bindings all ACTIVE, credentials usable, and
// the onboarding transition history not forged.
//
// The gate is pure orchestration over an injected snapshot port so it is fully
// unit-testable with fakes. It never performs I/O and never trusts a claimed
// status: it recomputes ACTIVE from the recorded state + history.
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> GOVERNED COMPLIANCE CORE API
// -> COMPLIANCE CORE. This gate lives in the Core; the Hub only transports.

import { apiError } from "./apiErrors.ts";
import {
  type OnboardingState,
  type OnboardingSubjectType,
  OnboardingStateError,
  assertConsumable,
  assertTransitionHistory,
  isOnboardingState,
} from "./onboardingState.ts";
import {
  type CredentialReferenceRecord,
  type ProductRegistrationRecord,
  type ServiceIdentityRecord,
  type TenantBindingRecord,
  assertCredentialReferenceRecord,
  assertCredentialUsable,
  assertEnvironmentAllowed,
  assertProductAllowed,
  assertProductConsumable,
  assertProductTenantScope,
  assertScopeAllowed,
  assertServiceIdentityActive,
  assertTenantAllowed,
  assertTenantBinding,
} from "./onboardingRegistry.ts";

export type OnboardingRecord = {
  onboardingId: string;
  subjectType: OnboardingSubjectType;
  subjectRef: string;
  state: OnboardingState;
  // Ordered states from PROPOSED to current. Used to reject forged ACTIVE.
  history: readonly OnboardingState[];
};

export type OnboardingSnapshot = {
  serviceIdentity: ServiceIdentityRecord | null;
  product: ProductRegistrationRecord | null;
  tenantBindings: readonly TenantBindingRecord[];
  onboardings: readonly OnboardingRecord[];
  credential?: CredentialReferenceRecord | null;
};

export type OnboardingQuery = {
  tenantId: string;
  serviceIdentityId: string;
  productId: string;
  environment: string;
  scope?: string | null;
  now: number;
};

// Injected snapshot port. The Convex function supplies a real loader; tests
// supply fakes. Returns nulls (never throws) so the gate owns the failure codes.
export type OnboardingPort = {
  loadOnboardingSnapshot: (query: {
    tenantId: string;
    serviceIdentityId: string;
    productId: string;
  }) => Promise<OnboardingSnapshot>;
};

// Assert a specific onboarding subject is ACTIVE and its history is not forged.
function assertSubjectActive(
  snapshot: OnboardingSnapshot,
  subjectType: OnboardingSubjectType,
  subjectRef: string,
): OnboardingRecord {
  const record = snapshot.onboardings.find(
    (o) => o.subjectType === subjectType && o.subjectRef === subjectRef,
  );
  if (!record) {
    throw apiError("ONBOARDING_NOT_APPROVED", `no onboarding for ${subjectType}:${subjectRef}`);
  }
  if (!isOnboardingState(record.state)) {
    throw apiError("ONBOARDING_STATE_INVALID", "unknown onboarding state");
  }
  // Anti-forgery: the recorded history must legally support the claimed state.
  // The pure state machine throws OnboardingStateError; convert it to a bounded
  // ApiError so the governed surface never leaks an INTERNAL for a forged claim.
  try {
    assertTransitionHistory(record.history, record.state);
    // Only ACTIVE is consumable.
    assertConsumable(record.state);
  } catch (error) {
    if (error instanceof OnboardingStateError) {
      throw apiError(error.code, error.message);
    }
    throw error;
  }
  return record;
}

// The full onboarding evaluation. Ordered, fail-closed. Any failure throws a
// bounded ApiError. Success returns the validated records for audit linkage.
export function evaluateOnboarding(
  query: OnboardingQuery,
  snapshot: OnboardingSnapshot,
): {
  serviceIdentity: ServiceIdentityRecord;
  product: ProductRegistrationRecord;
  onboardings: readonly OnboardingRecord[];
} {
  const si = snapshot.serviceIdentity;
  if (!si) {
    throw apiError("IDENTITY_INVALID", "unknown service identity");
  }
  // 1. service identity status
  assertServiceIdentityActive(si);
  // 2. credential reference + expiry + rotation
  if (snapshot.credential) {
    assertCredentialReferenceRecord(snapshot.credential, query.now);
  }
  assertCredentialUsable(si, query.now);
  // 3. environment authorization
  assertEnvironmentAllowed(si, query.environment);
  // 4. product authorization (service -> product)
  assertProductAllowed(si, query.productId);
  // 5. tenant authorization (service -> tenant)
  assertTenantAllowed(si, query.tenantId);
  // 6. scope authorization (if a scope is requested)
  if (query.scope) {
    assertScopeAllowed(si, query.scope);
  }
  // 7. product registration consumable
  const product = snapshot.product;
  if (!product) {
    throw apiError("PRODUCT_NOT_APPROVED", "unknown product registration");
  }
  if (product.productId !== query.productId) {
    throw apiError("PRODUCT_ISOLATION_VIOLATION", "product registration mismatch");
  }
  assertProductConsumable(product);
  // 8. product tenant scope authorization
  assertProductTenantScope(product, query.tenantId);
  // 9. tenant binding present (service -> tenant)
  assertTenantBinding(snapshot.tenantBindings, {
    bindingType: "SERVICE",
    subjectRef: query.serviceIdentityId,
    targetTenantId: query.tenantId,
  });
  // 10. scope binding present (if a scope is requested)
  if (query.scope) {
    const scopeBinding = snapshot.tenantBindings.find(
      (b) =>
        b.bindingType === "SCOPE" &&
        b.subjectRef === query.serviceIdentityId &&
        b.targetTenantId === query.tenantId &&
        b.scope === query.scope &&
        b.status === "ACTIVE" &&
        typeof b.revokedAt !== "number",
    );
    if (!scopeBinding) {
      throw apiError("SCOPE_NOT_BOUND", "required scope binding not present");
    }
  }
  // 11. onboarding state ACTIVE for service identity, product and tenant binding
  assertSubjectActive(snapshot, "SERVICE_IDENTITY", query.serviceIdentityId);
  assertSubjectActive(snapshot, "PRODUCT", query.productId);
  assertSubjectActive(snapshot, "TENANT_BINDING", query.serviceIdentityId);
  return { serviceIdentity: si, product, onboardings: snapshot.onboardings };
}

// Convenience: run the gate through an injected port. Used by the governed
// pipeline's optional loadOnboarding step.
export async function runOnboardingGate(
  query: OnboardingQuery,
  port: OnboardingPort,
): Promise<ReturnType<typeof evaluateOnboarding>> {
  const snapshot = await port.loadOnboardingSnapshot({
    tenantId: query.tenantId,
    serviceIdentityId: query.serviceIdentityId,
    productId: query.productId,
  });
  return evaluateOnboarding(query, snapshot);
}
