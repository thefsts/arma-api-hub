// ARMA API Hub — policy engine.
//
// Every protected decision resolves through this module and FAILS CLOSED on
// anything unknown, unregistered, inactive, unapproved, missing a capability,
// out of classification scope, tenant-mismatched, or kill-switched.
//
// HARD RULE: a service must not send or receive protected events unless it is
// registered, approved, active, and assigned the required scoped capability.

import type {
  Capability,
  DataClassification,
  Lifecycle,
  ServiceRecord,
  TenantScope,
} from '@arma/contracts';

/** Classification ordering, lowest to highest sensitivity. */
const CLASSIFICATION_ORDER: readonly DataClassification[] = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PROTECTED',
  'REGULATED',
];

export function classificationRank(c: DataClassification): number {
  return CLASSIFICATION_ORDER.indexOf(c);
}

/** Lifecycle states in which a service may send/receive protected events. */
const ACTIVE_LIFECYCLES: ReadonlySet<Lifecycle> = new Set<Lifecycle>(['PILOT', 'ACTIVE']);

export type PolicyFailureCode =
  | 'SERVICE_UNKNOWN'
  | 'SERVICE_NOT_ACTIVE'
  | 'SERVICE_NOT_APPROVED'
  | 'KILL_SWITCH_ENGAGED'
  | 'CAPABILITY_MISSING'
  | 'CAPABILITY_DIRECTION_MISMATCH'
  | 'CLASSIFICATION_EXCEEDED'
  | 'TENANT_MISMATCH'
  | 'TENANT_REQUIRED'
  | 'DESTINATION_NOT_ALLOWED';

export type PolicyDecision =
  | { ok: true; serviceId: string; capability: string }
  | { ok: false; code: PolicyFailureCode; detail?: Record<string, unknown> };

export interface PolicyRequest {
  readonly serviceId: string;
  readonly capability: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly classification: DataClassification;
  /** Tenant scope carried by the request, when applicable. */
  readonly tenant?: TenantScope;
  /** Destination service for outbound requests. */
  readonly destinationServiceId?: string;
}

export interface PolicyRegistry {
  getService(serviceId: string): ServiceRecord | null;
}

/** In-memory registry used for tests and local development. */
export class InMemoryPolicyRegistry implements PolicyRegistry {
  private readonly services = new Map<string, ServiceRecord>();

  register(record: ServiceRecord): void {
    this.services.set(record.serviceId, record);
  }

  getService(serviceId: string): ServiceRecord | null {
    return this.services.get(serviceId) ?? null;
  }
}

function findCapability(record: ServiceRecord, capability: string): Capability | undefined {
  return record.capabilities.find((c) => c.capability === capability);
}

/**
 * Evaluate a policy request. Returns a decision; never throws for ordinary
 * denials. Fails closed on every unknown condition.
 */
export function evaluatePolicy(registry: PolicyRegistry, request: PolicyRequest): PolicyDecision {
  const record = registry.getService(request.serviceId);
  if (!record) return { ok: false, code: 'SERVICE_UNKNOWN' };

  if (record.killSwitchEngaged) {
    return { ok: false, code: 'KILL_SWITCH_ENGAGED', detail: { serviceId: record.serviceId } };
  }

  if (record.onboardingStatus !== 'APPROVED') {
    return { ok: false, code: 'SERVICE_NOT_APPROVED', detail: { status: record.onboardingStatus } };
  }

  if (!ACTIVE_LIFECYCLES.has(record.lifecycle)) {
    return { ok: false, code: 'SERVICE_NOT_ACTIVE', detail: { lifecycle: record.lifecycle } };
  }

  const capability = findCapability(record, request.capability);
  if (!capability) {
    return { ok: false, code: 'CAPABILITY_MISSING', detail: { capability: request.capability } };
  }

  if (capability.direction !== 'BIDIRECTIONAL' && capability.direction !== request.direction) {
    return {
      ok: false,
      code: 'CAPABILITY_DIRECTION_MISMATCH',
      detail: { required: capability.direction, requested: request.direction },
    };
  }

  if (
    classificationRank(request.classification) > classificationRank(capability.maxClassification)
  ) {
    return {
      ok: false,
      code: 'CLASSIFICATION_EXCEEDED',
      detail: { requested: request.classification, max: capability.maxClassification },
    };
  }

  // Tenant isolation: a tenant-scoped request must carry a tenant, and the
  // tenant must fall within the service's declared authorized scope when the
  // service is tenant-scoped. Unknown/absent scope fails closed only where the
  // service declares one.
  if (request.tenant) {
    const authorized = record.authorizedTenantIds;
    if (authorized && authorized.length > 0 && !authorized.includes(request.tenant.tenantId)) {
      return {
        ok: false,
        code: 'TENANT_MISMATCH',
        detail: { tenantId: request.tenant.tenantId },
      };
    }
    if (record.classification === 'REGULATED' && !request.tenant.tenantId) {
      return { ok: false, code: 'TENANT_REQUIRED' };
    }
  }

  // Destination allow-list: outbound requests must target an approved connection.
  if (request.direction === 'OUTBOUND' && request.destinationServiceId) {
    const allowed = record.connections.some(
      (c) =>
        c.direction === 'OUTBOUND' &&
        c.remoteServiceId === request.destinationServiceId &&
        c.enabled,
    );
    if (!allowed) {
      return {
        ok: false,
        code: 'DESTINATION_NOT_ALLOWED',
        detail: { destination: request.destinationServiceId },
      };
    }
  }

  return { ok: true, serviceId: record.serviceId, capability: capability.capability };
}

/** True when a service may participate in protected event exchange. */
export function isServiceActiveForProtectedEvents(record: ServiceRecord): boolean {
  return (
    record.onboardingStatus === 'APPROVED' &&
    ACTIVE_LIFECYCLES.has(record.lifecycle) &&
    !record.killSwitchEngaged
  );
}

// Admission pipeline (composes the policy engine with crypto, identity, and
// replay/idempotency registries). Re-exported here so the control plane has a
// single import surface.
export {
  admitServiceRequest,
  checkAudience,
  isSupportedSchemaVersion,
  SUPPORTED_SCHEMA_VERSIONS,
  type AdmissionDecision,
  type AdmissionFailureCode,
  type AdmissionInput,
} from './admission.js';
