// ARMA API Hub — product onboarding routing decision (Phase 8).
//
// The pure, dependency-free, fail-closed decision that governs whether a
// request from a real FSTS product (ARMA System 360 is the first) may be routed
// onto the governed Core path. It is the Hub's ROUTING gate — it decides
// whether the Hub will TRANSPORT a request. It NEVER decides a compliance
// verdict: a routing ALLOW means "the Hub will carry this to the Core"; the Core
// still owns every compliance decision.
//
// LOCKED ARCHITECTURE: PRODUCT -> ARMA API HUB -> FSTS COMPLIANCE CORE.
// The Hub transports. The Core decides. A transport outcome is NEVER a verdict.
//
// This module is pure: no Convex, no I/O, no wall-clock. `now` is supplied by
// the caller (server-authoritative) so the decision is deterministic and fully
// unit-testable. The Convex layer (`convex/productOnboardings.ts`) loads the
// onboarding record and calls `decideRouting`.
//
// MISSION INVARIANTS (fail closed):
//   * APPROVED != ACTIVE, PROVISIONED != VERIFIED, VERIFIED != CERTIFIED.
//   * Only ACTIVE onboarding produces consumable traffic.
//   * A suspended or revoked integration fails closed.
//   * A product may never impersonate another product, act for another tenant,
//     or escalate environment.
//   * An invalid/expired credential reference fails closed.
//   * An unsupported version fails closed (no silent downgrade).

/** The onboarding lifecycle. Mirrors the Core / client ONBOARDING_STATES. */
export const PRODUCT_ONBOARDING_STATES = [
  'PROPOSED',
  'REVIEWED',
  'APPROVED',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'REJECTED',
] as const;

export type ProductOnboardingState = (typeof PRODUCT_ONBOARDING_STATES)[number];

/** Terminal states: no outbound transitions. */
export const TERMINAL_STATES: readonly ProductOnboardingState[] = ['REVOKED', 'REJECTED'];

/** The closed transition table. Any pair not listed is rejected. */
const TRANSITIONS: Record<ProductOnboardingState, readonly ProductOnboardingState[]> = {
  PROPOSED: ['REVIEWED', 'REJECTED'],
  REVIEWED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROVISIONED', 'REJECTED', 'REVOKED'],
  PROVISIONED: ['VERIFIED', 'SUSPENDED', 'REVOKED'],
  VERIFIED: ['ACTIVE', 'SUSPENDED', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
  REJECTED: [],
};

/** The ordered forward path (anti-forgery). */
export const FORWARD_PATH: readonly ProductOnboardingState[] = [
  'PROPOSED',
  'REVIEWED',
  'APPROVED',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVE',
];

/** Forbidden shortcuts (already excluded by the table; asserted explicitly). */
export const FORBIDDEN_SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['PROPOSED', 'APPROVED'],
  ['PROPOSED', 'ACTIVE'],
  ['REVIEWED', 'ACTIVE'],
  ['APPROVED', 'ACTIVE'],
  ['PROVISIONED', 'ACTIVE'],
  ['REVOKED', 'ACTIVE'],
  ['REJECTED', 'ACTIVE'],
];

/** Wire API versions the Hub can route. */
export const SUPPORTED_WIRE_API_VERSIONS: readonly string[] = ['1.0.0', '1.1.0'];

/** Hub contract versions the Hub can route. */
export const SUPPORTED_CONTRACT_VERSIONS: readonly string[] = ['1.0.0'];

/** Deployment environments a product onboarding may be bound to. */
export const ROUTING_ENVIRONMENTS: readonly string[] = ['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'];

/** Bounded routing denial codes (a subset of the Hub failure taxonomy). */
export const ROUTING_DENIAL_CODES = [
  'PRODUCT_DENIED',
  'TENANT_DENIED',
  'ENVIRONMENT_DENIED',
  'INTEGRATION_INACTIVE',
  'AUTHENTICATION_FAILED',
  'UNSUPPORTED_VERSION',
  'UNKNOWN_OPERATION',
  'SCOPE_DENIED',
  // A non-finite evaluation time (the credential-expiry clock) fails closed.
  'VALIDATION_FAILED',
  // More than one onboarding claims the same (product, tenant, environment)
  // binding: conflicting authorization fails closed rather than picking one.
  'CONFLICT',
] as const;

export type RoutingDenialCode = (typeof ROUTING_DENIAL_CODES)[number];

export function isOnboardingState(value: unknown): value is ProductOnboardingState {
  return (
    typeof value === 'string' && (PRODUCT_ONBOARDING_STATES as readonly string[]).includes(value)
  );
}

export function isTerminal(state: ProductOnboardingState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function nextStates(state: ProductOnboardingState): readonly ProductOnboardingState[] {
  return TRANSITIONS[state] ?? [];
}

export function canTransition(from: unknown, to: unknown): boolean {
  if (!isOnboardingState(from) || !isOnboardingState(to)) return false;
  return nextStates(from).includes(to);
}

/** Only ACTIVE is consumable. Everything else fails closed. */
export function isConsumable(state: unknown): boolean {
  return state === 'ACTIVE';
}

/**
 * Anti-forgery: verify an ordered history is a legal walk from PROPOSED to the
 * claimed state. Any illegal step, gap, or unreached claim is forged.
 */
export function verifyTransitionHistory(
  history: readonly unknown[],
  claimedState: unknown,
): boolean {
  if (!Array.isArray(history) || history.length === 0) return false;
  if (!isOnboardingState(claimedState)) return false;
  if (history[0] !== 'PROPOSED') return false;
  for (let i = 0; i < history.length; i += 1) {
    if (!isOnboardingState(history[i])) return false;
    if (i > 0 && !canTransition(history[i - 1], history[i])) return false;
  }
  return history[history.length - 1] === claimedState;
}

/** A product onboarding record as stored by the Hub. */
export interface ProductOnboardingRecord {
  readonly productId: string;
  readonly tenantId: string;
  readonly environment: string;
  /** The Hub routing identity (serviceId) the product calls as. */
  readonly hubRoutingIdentity: string;
  readonly allowedScopes: readonly string[];
  readonly allowedOperations: readonly string[];
  /** P0 keyId REFERENCE only — never the secret. */
  readonly credentialReference: string;
  readonly contractVersion: string;
  readonly state: string;
  /** Ordered states from PROPOSED to current (anti-forgery). */
  readonly history: readonly string[];
  readonly credentialExpiresAt?: number;
}

/** A request the Hub is asked to route. */
export interface RoutingRequest {
  readonly productId: string;
  readonly tenantId: string;
  readonly environment: string;
  readonly hubRoutingIdentity: string;
  readonly operation: string;
  readonly scope: string;
  readonly contractVersion: string;
  readonly apiVersion: string;
}

export interface RoutingAllowance {
  readonly allowed: true;
  readonly route: {
    readonly productId: string;
    readonly tenantId: string;
    readonly environment: string;
    readonly hubRoutingIdentity: string;
    readonly operation: string;
    readonly scope: string;
    readonly contractVersion: string;
    readonly apiVersion: string;
    readonly credentialReference: string;
  };
}

/**
 * The disposition a routing denial carries for the durable worker. It maps the
 * Hub's bounded denial vocabulary onto the worker's retry/hold vocabulary so a
 * denial is NEVER blanket-classified as terminal:
 *
 *   * TERMINAL        — permanently invalid authority. A new onboarding or a
 *                       credential re-submission is required: REVOKED/REJECTED,
 *                       product/tenant/environment impersonation, forged
 *                       history, unsupported version, disallowed operation or
 *                       scope, malformed/forged input.
 *   * HELD            — the integration is not currently consumable but may
 *                       become consumable WITHOUT a new onboarding (SUSPENDED,
 *                       or not-yet-ACTIVE). Work is held, never discarded, and
 *                       does not consume the retry budget.
 *   * CLEAN_RETRYABLE — the failure happened before any side effect; safe to
 *                       retry automatically. Produced by the transport layer,
 *                       never by a routing denial.
 *   * AMBIGUOUS       — a remote side may have accepted; never blindly retried.
 *                       Produced by the transport layer.
 */
export type RoutingDisposition = 'TERMINAL' | 'HELD' | 'CLEAN_RETRYABLE' | 'AMBIGUOUS';

export interface RoutingDenial {
  readonly allowed: false;
  readonly code: RoutingDenialCode;
  /** How the durable worker must treat this denial (never blanket TERMINAL). */
  readonly disposition: RoutingDisposition;
}

export type RoutingDecision = RoutingAllowance | RoutingDenial;

function deny(code: RoutingDenialCode, disposition: RoutingDisposition): RoutingDenial {
  return { allowed: false, code, disposition };
}

/**
 * The disposition for an `INTEGRATION_INACTIVE` denial, derived from the
 * durable onboarding state. A SUSPENDED integration may be reactivated without a
 * new onboarding (HELD); a not-yet-ACTIVE integration may still become ACTIVE
 * (HELD); REVOKED/REJECTED are terminal.
 */
function inactiveDisposition(state: string): RoutingDisposition {
  if (state === 'REVOKED' || state === 'REJECTED') return 'TERMINAL';
  return 'HELD';
}

/**
 * Decide whether the Hub may route a product request onto the governed Core
 * path. Fail-closed order (deny at the earliest violated step):
 *
 *   evaluation clock finite -> onboarding present -> product binding ->
 *   tenant binding -> environment -> onboarding ACTIVE -> history not forged ->
 *   credential reference present/unexpired -> contract version -> api version ->
 *   operation allowed -> scope allowed -> routing identity match.
 *
 * Returns an ALLOW with the resolved route, or a bounded DENY code. Never
 * throws; never widens a request.
 */
export function decideRouting(
  request: RoutingRequest,
  onboarding: ProductOnboardingRecord | null | undefined,
  now: number,
): RoutingDecision {
  // 0. The evaluation clock must be a finite server-supplied number. A
  //    non-finite `now` would make the credential-expiry comparison
  //    (`expiresAt <= now`) evaluate false and silently admit an expired
  //    credential, so it fails closed before any other check.
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return deny('VALIDATION_FAILED', 'TERMINAL');
  }

  // 1. Onboarding must exist.
  if (!onboarding) return deny('PRODUCT_DENIED', 'TERMINAL');

  // 1. Product binding — a product may not impersonate another product.
  if (request.productId !== onboarding.productId) return deny('PRODUCT_DENIED', 'TERMINAL');

  // 2. Tenant binding — a product may not act for another tenant.
  if (request.tenantId !== onboarding.tenantId) return deny('TENANT_DENIED', 'TERMINAL');

  // 3. Environment — no escalation (a DEVELOPMENT onboarding cannot invoke
  //    PRODUCTION authorization).
  if (
    !ROUTING_ENVIRONMENTS.includes(request.environment) ||
    request.environment !== onboarding.environment
  ) {
    return deny('ENVIRONMENT_DENIED', 'TERMINAL');
  }

  // 4. Onboarding must be ACTIVE. A SUSPENDED integration is HELD (reactivation
  //    is allowed without a new onboarding); a REVOKED/REJECTED integration is
  //    TERMINAL. A not-yet-ACTIVE integration is HELD (it may still activate).
  if (!isConsumable(onboarding.state)) {
    return deny('INTEGRATION_INACTIVE', inactiveDisposition(onboarding.state));
  }

  // 5. History must legally support the claimed ACTIVE (anti-forgery). A forged
  //    history is malformed/forged authorization: TERMINAL.
  if (!verifyTransitionHistory(onboarding.history, onboarding.state)) {
    return deny('INTEGRATION_INACTIVE', 'TERMINAL');
  }

  // 6. Credential reference present + unexpired. The Hub resolves the secret on
  //    its side; the product holds only the reference.
  if (
    typeof onboarding.credentialReference !== 'string' ||
    onboarding.credentialReference.trim().length === 0
  ) {
    return deny('AUTHENTICATION_FAILED', 'TERMINAL');
  }
  // The stored credential-expiry clock is an authority-bearing numeric field. A
  // hostile/corrupted durable record could carry a non-finite value (NaN,
  // +Infinity, -Infinity) or a non-number; any of those would make the
  // `expiresAt <= now` comparison evaluate false and silently admit an expired
  // credential. Fail closed unless it is absent or a finite number. An invalid
  // credential requires re-submission or a new onboarding: TERMINAL.
  if (onboarding.credentialExpiresAt !== undefined) {
    if (
      typeof onboarding.credentialExpiresAt !== 'number' ||
      !Number.isFinite(onboarding.credentialExpiresAt)
    ) {
      return deny('AUTHENTICATION_FAILED', 'TERMINAL');
    }
    if (onboarding.credentialExpiresAt <= now) {
      return deny('AUTHENTICATION_FAILED', 'TERMINAL');
    }
  }

  // 7. Contract version — exact match, no silent downgrade.
  if (
    !SUPPORTED_CONTRACT_VERSIONS.includes(request.contractVersion) ||
    request.contractVersion !== onboarding.contractVersion
  ) {
    return deny('UNSUPPORTED_VERSION', 'TERMINAL');
  }

  // 8. Wire API version — must be supported.
  if (!SUPPORTED_WIRE_API_VERSIONS.includes(request.apiVersion)) {
    return deny('UNSUPPORTED_VERSION', 'TERMINAL');
  }

  // 9. Operation — must be an allowed operation of this onboarding.
  if (!onboarding.allowedOperations.includes(request.operation)) {
    return deny('UNKNOWN_OPERATION', 'TERMINAL');
  }

  // 10. Scope — must be an allowed scope of this onboarding.
  if (!onboarding.allowedScopes.includes(request.scope)) {
    return deny('SCOPE_DENIED', 'TERMINAL');
  }

  // 11. Routing identity — the product must call as its bound routing identity.
  if (request.hubRoutingIdentity !== onboarding.hubRoutingIdentity) {
    return deny('PRODUCT_DENIED', 'TERMINAL');
  }

  return {
    allowed: true,
    route: {
      productId: onboarding.productId,
      tenantId: onboarding.tenantId,
      environment: onboarding.environment,
      hubRoutingIdentity: onboarding.hubRoutingIdentity,
      operation: request.operation,
      scope: request.scope,
      contractVersion: onboarding.contractVersion,
      apiVersion: request.apiVersion,
      credentialReference: onboarding.credentialReference,
    },
  };
}
