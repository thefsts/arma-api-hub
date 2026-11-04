// FSTS Governed Product Client — the client.
//
// Five thin layers, each fail-closed:
//   L5 product business logic (NOT here)
//   L4 GovernedProductClient (this file)
//   L3 governed envelope + integrity primitives
//   L2 manifest validator + identity/tenant/env/scope binder
//   L1 transport seam (injected) — the API Hub HTTP boundary
//
// The product never imports L1 or L3 directly. It constructs an L4 client from a
// validated manifest and non-secret configuration, and calls governed methods.
//
// LOCKED ARCHITECTURE: PRODUCT -> GOVERNED SDK -> ARMA API HUB -> COMPLIANCE CORE.
// The SDK may reach the API Hub only. It never reaches Compliance Core Convex.
// A GovernedResult is NEVER a compliance verdict.

import { canonicalize, sha256Hex } from '@arma/compliance-core-client';
import {
  CONFORMANCE_AREAS,
  ENVIRONMENTS,
  FRESHNESS_WINDOW_MS,
  FUTURE_SKEW_MS,
  ID_PATTERN,
  NONCE_PATTERN,
  PRODUCT_ID_PATTERN,
  RETRY_SCHEDULE_MS,
} from './constants.js';
import type { Environment, HealthStatus } from './constants.js';
import { mapCoreDenial } from './denial-map.js';
import { boundedFailure } from './errors.js';
import type { BoundedFailure, GovernedResult } from './errors.js';
import { buildSignedEnvelope, guardOutboundPayload } from './envelope.js';
import { observeHealth } from './health.js';
import type { CoreHealthObservation, HealthReport } from './health.js';
import { looksLikeSecretMaterial, validateGovernedManifest } from './manifest.js';
import type { GovernedProductManifest } from './manifest.js';
import { isRoutableOperation, OPERATION_BINDING } from './operation-binding.generated.js';
import { GovernedClientConfigError } from './errors.js';
import type { HubTransport } from './transport.js';

export interface ResolvedCredential {
  /** Short-lived, Hub-issued signing material. Never a long-lived product secret. */
  readonly secret: string;
}

export interface GovernedClientConfig {
  readonly manifest: GovernedProductManifest;
  readonly environment: Environment;
  readonly tenantId: string;
  /** A REFERENCE (a name), never secret material. */
  readonly credentialReference: string;
  readonly transport: HubTransport;
  /** Server-authoritative clock. Never caller-supplied per request. */
  readonly clock?: () => number;
  /** Hub-side resolution of the credential reference to short-lived material. */
  readonly resolveCredential?: (ref: string) => Promise<ResolvedCredential | null>;
  readonly nonceFactory?: () => string;
  readonly idFactory?: (prefix: string) => string;
  /** Observational kill-switch probe. Engaged => fail closed, no forward. */
  readonly killSwitch?: () => boolean;
  /** Observational Core health probe (Core-derived). */
  readonly healthProbe?: () => Promise<CoreHealthObservation | null>;
}

export interface GovernedIdentity {
  readonly productId: string;
  readonly routingIdentity: string;
  readonly environment: Environment;
  readonly tenantId: string;
  readonly apiVersion: string;
  readonly apiHubVersion: string;
  readonly coreVersion: string;
  readonly apiHubContractVersion: string;
  readonly ownership: string;
}

export interface OperationInput {
  readonly resourceId: string;
  readonly payload: unknown;
  /** Stable business key; makes the idempotency key deterministic across retries. */
  readonly businessKey?: string;
}

export type GovernedOperation = (input: OperationInput) => Promise<GovernedResult<unknown>>;

export interface GovernedProductClient {
  readonly identity: GovernedIdentity;
  readonly operations: Readonly<Record<string, GovernedOperation>>;
  /** Invoke a declared operation by id. Undeclared ids fail closed. */
  call(operationId: string, input: OperationInput): Promise<GovernedResult<unknown>>;
  /** Observational health. Never a compliance verdict. */
  health(): Promise<HealthReport>;
}

let counter = 0;
function defaultId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
function defaultNonce(): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 14);
  return `n-${Date.now().toString(36)}-${counter.toString(36)}-${rand}`.padEnd(24, '0');
}

export function createGovernedProductClient(config: GovernedClientConfig): GovernedProductClient {
  // --- construction-time, fail-closed validation sequence -----------------
  const manifest = validateGovernedManifest(config.manifest);

  if (!(ENVIRONMENTS as readonly string[]).includes(config.environment)) {
    throw new GovernedClientConfigError(
      'CONFIG_INVALID',
      `unsupported environment ${config.environment}`,
    );
  }
  if (!manifest.supportedEnvironments.includes(config.environment)) {
    throw new GovernedClientConfigError(
      'ENVIRONMENT_DENIED',
      `environment ${config.environment} is not in manifest.supportedEnvironments`,
    );
  }
  if (manifest.hubRoute.directCoreAccess !== false) {
    throw new GovernedClientConfigError('CONFIG_INVALID', 'directCoreAccess must be false');
  }
  if (!config.transport) {
    throw new GovernedClientConfigError(
      'CONFIG_INVALID',
      'a HubTransport is required; there is no direct-Core path',
    );
  }
  if (
    typeof config.tenantId !== 'string' ||
    config.tenantId.length === 0 ||
    !ID_PATTERN.test(config.tenantId)
  ) {
    throw new GovernedClientConfigError(
      'CONFIG_INVALID',
      'tenantId is required and must match the tenant pattern',
    );
  }
  if (typeof config.credentialReference !== 'string' || config.credentialReference.length === 0) {
    throw new GovernedClientConfigError('CONFIG_INVALID', 'credentialReference is required');
  }
  // A reference is a REFERENCE. Secret material is never accepted here, so a
  // product cannot smuggle a private key or token in as a "reference".
  if (looksLikeSecretMaterial(config.credentialReference)) {
    throw new GovernedClientConfigError(
      'CONFIG_INVALID',
      'credentialReference looks like secret material',
    );
  }
  if (!config.resolveCredential) {
    throw new GovernedClientConfigError(
      'CREDENTIAL_UNRESOLVED',
      'a credential resolver is required; the client cannot sign without Hub-resolved material',
    );
  }

  // Every declared operation must be routable and have a declared scope.
  for (const op of manifest.requiredOperations) {
    const binding = OPERATION_BINDING[op];
    if (!binding) {
      throw new GovernedClientConfigError(
        'UNKNOWN_OPERATION',
        `declared operation ${op} is not a Core operation`,
      );
    }
    if (!isRoutableOperation(op)) {
      throw new GovernedClientConfigError(
        'UNKNOWN_OPERATION',
        `operation ${op} has no Hub scope and is not routable through the governed SDK`,
      );
    }
    const covered = binding.hubScopes.some((s) => manifest.requiredHubScopes.includes(s as never));
    if (!covered) {
      throw new GovernedClientConfigError(
        'SCOPE_DENIED',
        `operation ${op} requires a hub scope not declared in requiredHubScopes`,
      );
    }
  }

  const clock = config.clock ?? (() => Date.now());
  const nonceFactory = config.nonceFactory ?? defaultNonce;
  const idFactory = config.idFactory ?? defaultId;

  const identity: GovernedIdentity = Object.freeze({
    productId: manifest.productId,
    routingIdentity: manifest.hubRoute.routingIdentity,
    environment: config.environment,
    tenantId: config.tenantId,
    apiVersion: manifest.hubRoute.apiVersion,
    apiHubVersion: manifest.hubRoute.apiHubVersion,
    coreVersion: manifest.hubRoute.coreVersion,
    apiHubContractVersion: manifest.hubRoute.apiHubContractVersion,
    ownership: manifest.ownership,
  });

  const declared = new Set(manifest.requiredOperations);

  async function call(
    operationId: string,
    input: OperationInput,
  ): Promise<GovernedResult<unknown>> {
    const correlationId = idFactory('corr');
    const requestId = idFactory('req');

    // 1. declared operation?
    if (!declared.has(operationId)) {
      return boundedFailure({
        code: 'UNKNOWN_OPERATION',
        disposition: 'TERMINAL',
        cause: 'UNDECLARED_OPERATION',
        correlationId,
        requestId,
      });
    }
    const binding = OPERATION_BINDING[operationId];
    if (!binding || !isRoutableOperation(operationId)) {
      return boundedFailure({
        code: 'UNKNOWN_OPERATION',
        disposition: 'TERMINAL',
        cause: 'NON_ROUTABLE_OPERATION',
        correlationId,
        requestId,
      });
    }
    // 2. scope held?
    const covered = binding.hubScopes.some((s) => manifest.requiredHubScopes.includes(s as never));
    if (!covered) {
      return boundedFailure({
        code: 'SCOPE_DENIED',
        disposition: 'TERMINAL',
        cause: 'SCOPE_NOT_DECLARED',
        correlationId,
        requestId,
      });
    }
    // 3. kill switch (observational). Engaged => fail closed, no forward.
    if (config.killSwitch?.() === true) {
      return boundedFailure({
        code: 'INTEGRATION_INACTIVE',
        disposition: 'HELD',
        cause: 'KILL_SWITCH_ENGAGED',
        correlationId,
        requestId,
      });
    }
    // 4. outbound payload guards (raw evidence + false claims).
    try {
      guardOutboundPayload(input.payload, binding.evidenceSensitive);
    } catch (err) {
      const e = err as GovernedClientConfigError;
      return boundedFailure({
        code: e.code,
        disposition: 'TERMINAL',
        cause: 'PAYLOAD_GUARD',
        correlationId,
        requestId,
      });
    }
    // 5. freshness — trusted clock only.
    const now = clock();
    if (!Number.isFinite(now) || now <= 0) {
      return boundedFailure({
        code: 'STALE_REQUEST',
        disposition: 'TERMINAL',
        cause: 'INVALID_CLOCK',
        correlationId,
        requestId,
      });
    }
    // 6. resolve credential reference -> short-lived material.
    let secret: string;
    try {
      const resolved = await config.resolveCredential?.(config.credentialReference);
      if (!resolved || typeof resolved.secret !== 'string' || resolved.secret.length === 0) {
        return boundedFailure({
          code: 'CREDENTIAL_UNRESOLVED',
          disposition: 'TERMINAL',
          cause: 'CREDENTIAL_UNRESOLVED',
          correlationId,
          requestId,
        });
      }
      secret = resolved.secret;
    } catch {
      return boundedFailure({
        code: 'CREDENTIAL_UNRESOLVED',
        disposition: 'TERMINAL',
        cause: 'CREDENTIAL_RESOLUTION_THREW',
        correlationId,
        requestId,
      });
    }
    // 7. idempotency key — deterministic across retries.
    const idempotencyKey = sha256Hex(
      canonicalize({
        operation: operationId,
        tenantId: config.tenantId,
        businessKey: input.businessKey ?? input.resourceId,
      }),
    );
    const nonce = nonceFactory();
    if (!NONCE_PATTERN.test(nonce)) {
      return boundedFailure({
        code: 'INTEGRITY_FAILED',
        disposition: 'TERMINAL',
        cause: 'NONCE_INVALID',
        correlationId,
        requestId,
      });
    }
    // 8. build + self-validate signed envelope.
    let envelope;
    try {
      envelope = buildSignedEnvelope({
        apiVersion: manifest.hubRoute.apiVersion,
        tenantId: config.tenantId,
        serviceIdentityId: manifest.hubRoute.routingIdentity,
        productId: manifest.productId,
        environment: config.environment,
        action: operationId,
        resourceType: binding.resourceType,
        resourceId: input.resourceId,
        timestamp: now,
        nonce,
        requestId,
        correlationId,
        idempotencyKey,
        payload: input.payload,
        secret,
      });
    } catch (err) {
      const e = err as GovernedClientConfigError;
      return boundedFailure({
        code: e.code ?? 'INTEGRITY_FAILED',
        disposition: 'TERMINAL',
        cause: 'ENVELOPE_BUILD_FAILED',
        correlationId,
        requestId,
      });
    }
    // 9. transport — the only egress.
    let response;
    try {
      response = await config.transport.send(envelope, JSON.stringify(input.payload ?? null));
    } catch {
      // Transport threw: outcome is ambiguous (may have been accepted). Never blind-retry.
      return boundedFailure({
        code: 'UPSTREAM_UNAVAILABLE',
        disposition: 'AMBIGUOUS',
        cause: 'TRANSPORT_THREW',
        correlationId,
        requestId,
      });
    }
    // 10. classify bounded response. Never a verdict.
    if (response.ok) {
      return Object.freeze({ ok: true as const, data: response.body, correlationId, requestId });
    }
    const mapped = mapCoreDenial(response.code);
    return boundedFailure({
      code: mapped.code,
      disposition: mapped.disposition,
      cause: mapped.cause,
      correlationId,
      requestId,
    });
  }

  // One governed method per declared operation.
  const operations: Record<string, GovernedOperation> = {};
  for (const op of manifest.requiredOperations) {
    operations[op] = (input: OperationInput) => call(op, input);
  }

  async function health(): Promise<HealthReport> {
    let observation: CoreHealthObservation | null = null;
    try {
      observation = config.healthProbe ? await config.healthProbe() : null;
    } catch {
      observation = null;
    }
    return observeHealth({
      observation,
      now: clock(),
      maxStalenessMs: manifest.healthExpectations.maxStalenessMs,
      correlationId: idFactory('corr'),
    });
  }

  return Object.freeze({
    identity,
    operations: Object.freeze(operations),
    call,
    health,
  });
}

/** Re-exported for adapters/tests that need the canonical area list. */
export const GOVERNED_CONFORMANCE_AREAS = CONFORMANCE_AREAS;
/** Re-exported for adapters/tests that need the freshness bounds. */
export const GOVERNED_FRESHNESS = Object.freeze({ FRESHNESS_WINDOW_MS, FUTURE_SKEW_MS });
/** Re-exported for adapters/tests that need the retry schedule (order preserved). */
export const GOVERNED_RETRY_SCHEDULE_MS = RETRY_SCHEDULE_MS;
/** Re-exported for adapters that validate their product id. */
export const GOVERNED_PRODUCT_ID_PATTERN = PRODUCT_ID_PATTERN;
/** Re-exported for adapters that surface a health status type. */
export type GovernedHealthStatus = HealthStatus;
/** Re-exported for callers that need the bounded failure shape. */
export type { BoundedFailure };
