// GENERATED FILE — do not edit by hand.
// Source: contracts/governed-product/operation-hub-scope.json
// coreMainSha: c7ac04b2d40624bef1742f819a9f7eee43e3d12c
// operations: 26, routable: 19, unroutable: 7

export interface OperationBinding {
  readonly requiredCoreScope: string;
  readonly hubScopes: readonly string[];
  readonly kind: 'READ' | 'WRITE';
  readonly resourceType: string;
  readonly evidenceSensitive: boolean;
  readonly idempotencyScope: string | null;
}

export const OPERATION_COUNT = 26 as const;
export const ROUTABLE_OPERATION_COUNT = 19 as const;
export const UNROUTABLE_OPERATION_COUNT = 7 as const;

export const OPERATION_BINDING: Readonly<Record<string, OperationBinding>> = Object.freeze({
  'applicability.record': Object.freeze({
    requiredCoreScope: 'runtime:write',
    hubScopes: Object.freeze(['compliance.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'applicabilityAssessment',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'applicability.get': Object.freeze({
    requiredCoreScope: 'runtime:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'applicabilityAssessment',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'activation.record': Object.freeze({
    requiredCoreScope: 'runtime:write',
    hubScopes: Object.freeze(['compliance.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'controlActivation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'activation.get': Object.freeze({
    requiredCoreScope: 'runtime:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'controlActivation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'controlRuntimeState.record': Object.freeze({
    requiredCoreScope: 'runtime:write',
    hubScopes: Object.freeze(['compliance.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'controlRuntimeState',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'verification.plan.create': Object.freeze({
    requiredCoreScope: 'verification:write',
    hubScopes: Object.freeze(['verification.submit'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'verificationPlan',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'verification.execution.submit': Object.freeze({
    requiredCoreScope: 'verification:write',
    hubScopes: Object.freeze(['verification.submit'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'verificationExecution',
    evidenceSensitive: false,
    idempotencyScope: 'verification-submission',
  }),
  'verification.execution.get': Object.freeze({
    requiredCoreScope: 'verification:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'verificationExecution',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'verification.result.record': Object.freeze({
    requiredCoreScope: 'verification:write',
    hubScopes: Object.freeze(['verification.submit'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'verificationResult',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'evidence.record': Object.freeze({
    requiredCoreScope: 'evidence:write',
    hubScopes: Object.freeze(['evidence.metadata.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'evidenceRecord',
    evidenceSensitive: true,
    idempotencyScope: 'evidence-receipt',
  }),
  'evidence.get': Object.freeze({
    requiredCoreScope: 'evidence:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'evidenceRecord',
    evidenceSensitive: true,
    idempotencyScope: null,
  }),
  'evidence.candidate.propose': Object.freeze({
    requiredCoreScope: 'evidence:write',
    hubScopes: Object.freeze(['evidence.metadata.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'evidenceCandidate',
    evidenceSensitive: true,
    idempotencyScope: null,
  }),
  'observation.record': Object.freeze({
    requiredCoreScope: 'runtime:write',
    hubScopes: Object.freeze(['compliance.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'observation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'observation.get': Object.freeze({
    requiredCoreScope: 'runtime:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'observation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'exception.request': Object.freeze({
    requiredCoreScope: 'exception:write',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'exception',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'exception.decide': Object.freeze({
    requiredCoreScope: 'exception:approve',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'exception',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'exception.get': Object.freeze({
    requiredCoreScope: 'exception:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'exception',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'remediation.create': Object.freeze({
    requiredCoreScope: 'remediation:write',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'remediation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'remediation.action.record': Object.freeze({
    requiredCoreScope: 'remediation:write',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'remediationAction',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'remediation.close': Object.freeze({
    requiredCoreScope: 'remediation:write',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'remediation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'remediation.reopen': Object.freeze({
    requiredCoreScope: 'remediation:write',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'remediation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'remediation.get': Object.freeze({
    requiredCoreScope: 'remediation:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'remediation',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'readiness.snapshot.record': Object.freeze({
    requiredCoreScope: 'readiness:write',
    hubScopes: Object.freeze([] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'readinessSnapshot',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'readiness.snapshot.get': Object.freeze({
    requiredCoreScope: 'readiness:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'readinessSnapshot',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'drift.record': Object.freeze({
    requiredCoreScope: 'runtime:write',
    hubScopes: Object.freeze(['compliance.write'] as readonly string[]),
    kind: 'WRITE' as 'READ' | 'WRITE',
    resourceType: 'runtimeDrift',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
  'drift.get': Object.freeze({
    requiredCoreScope: 'runtime:read',
    hubScopes: Object.freeze(['compliance.read'] as readonly string[]),
    kind: 'READ' as 'READ' | 'WRITE',
    resourceType: 'runtimeDrift',
    evidenceSensitive: false,
    idempotencyScope: null,
  }),
});

/** True when the operation has at least one Hub scope and is therefore routable. */
export function isRoutableOperation(operationId: string): boolean {
  const b = OPERATION_BINDING[operationId];
  return b !== undefined && b.hubScopes.length > 0;
}
