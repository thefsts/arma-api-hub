// FSTS Compliance Core — governed request pipeline (Phase 6, Chat 1)
//
// The single ordered pipeline every governed Compliance Service/API call flows
// through. It is pure orchestration: all persistence and secret resolution are
// injected as async ports, so the pipeline is fully unit-testable with fakes
// and is wired to Convex in convex/apiService.ts.
//
// Order is security-significant (fail closed at the earliest violated step):
//   envelope -> version -> correlation -> identity -> integrity -> freshness
//   -> nonce replay -> product binding -> tenant resolution -> contract
//   resolution -> authorization -> environment -> rate limit -> idempotency
//   -> dispatch -> audit.
//
// PASS != COMPLIANT. A successful result is an operational outcome, never a
// compliance or certification claim.

import { ApiError, apiError, toApiError } from "./apiErrors.ts";
import {
  validateRequestEnvelope,
  verifyRequestIntegrity,
  validateFreshness,
  computeIdempotencyHash,
  type GovernedRequest,
} from "./apiRequest.ts";
import { resolveApiVersion, assertVersionCompatible, CURRENT_API_VERSION } from "./apiVersion.ts";
import { buildCorrelationContext } from "./apiCorrelation.ts";
import {
  authenticateServiceIdentity,
  assertServiceIdentityProductBinding,
  type ServiceIdentityRecord,
  type PrincipalRecord,
} from "./apiIdentity.ts";
import {
  resolveTenant,
  authorizeGovernedAction,
  assertEnvironmentAuthorized,
  type MembershipRecord,
  type RoleAssignmentRecord,
} from "./apiAuthorization.ts";
import {
  buildRateLimitBucketKey,
  evaluateRateLimit,
  assertRateLimit,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_MS,
} from "./apiRateLimit.ts";
import { buildIdempotencyKey, evaluateReplay } from "./idempotency.ts";
// ADDITIVE (Phase 7, Chat 1): the governed onboarding gate. Imported here but
// only invoked when the optional loadOnboarding port is supplied, so Chat 1
// behavior is preserved EXACTLY when it is absent.
import { evaluateOnboarding, type OnboardingSnapshot } from "./apiOnboarding.ts";

// A resolved, versioned governed API contract. The contract is the server-side
// authority for which actions exist, what scope they require, and where they
// may run. A request that does not address a KNOWN, non-retired contract fails
// closed (CONTRACT_UNKNOWN) before authorization.
export type ContractRecord = {
  contractId?: unknown;
  apiVersion?: unknown;
  action?: unknown;
  method?: unknown;
  resourceType?: unknown;
  status?: unknown;
  requiredScope?: unknown;
  allowedEnvironments?: unknown;
  rateLimit?: unknown;
  rateWindowMs?: unknown;
};

export type GovernedPorts = {
  now: () => number;
  loadServiceIdentity: (
    tenantId: string,
    serviceIdentityId: string,
  ) => Promise<ServiceIdentityRecord | null>;
  loadPrincipal: (tenantId: string, principalId: string) => Promise<PrincipalRecord | null>;
  loadMemberships: (tenantId: string, principalId: string) => Promise<MembershipRecord[]>;
  loadRoleAssignments: (
    tenantId: string,
    principalId: string,
  ) => Promise<RoleAssignmentRecord[]>;
  loadContract: (
    tenantId: string,
    apiVersion: string,
    action: string,
  ) => Promise<ContractRecord | null>;
  resolveSecret: (serviceIdentityId: string) => Promise<string | null>;
  getNonce: (
    tenantId: string,
    serviceIdentityId: string,
    nonce: string,
  ) => Promise<{ requestHash: string } | null>;
  putNonce: (record: {
    tenantId: string;
    serviceIdentityId: string;
    nonce: string;
    requestHash: string;
    seenAt: number;
    expiresAt: number;
  }) => Promise<void>;
  getIdempotency: (
    tenantId: string,
    scope: string,
    key: string,
  ) => Promise<{ requestHash: string; status: string; resultRef: string | null } | null>;
  putIdempotency: (record: {
    tenantId: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    status: string;
    resultRef: string | null;
    createdAt: number;
  }) => Promise<void>;
  getRateCount: (bucketKey: string, now: number, windowMs: number) => Promise<number>;
  bumpRateCount: (bucketKey: string, now: number, windowMs: number) => Promise<void>;
  appendAudit: (event: Record<string, unknown>) => Promise<void>;
  dispatch: (request: GovernedRequest) => Promise<unknown>;
  // ADDITIVE (Phase 6 Chat 4 convergence): optional domain overrides. The
  // defaults preserve the Chat 1 governed behavior EXACTLY. The legal /
  // regulatory domain API sets these so its writes flow through the SAME
  // authoritative idempotency foundation and audit ledger, labelled for the
  // legal surface \u2014 it never introduces a competing foundation.
  idempotencyScope?: string;
  auditSource?: string;
  allowedEnvironments?: readonly string[];
  rateLimit?: number;
  rateWindowMs?: number;
  freshnessWindowMs?: number;
  futureSkewMs?: number;
  nonceTtlMs?: number;
  // ADDITIVE (Phase 7, Chat 1): optional governed onboarding snapshot port.
  // When supplied, the pipeline enforces the fail-closed onboarding gate AFTER
  // environment authorization and BEFORE dispatch. When absent, Chat 1 behavior
  // is unchanged. The Core (not the ARMA API Hub) owns this decision.
  loadOnboarding?: (query: {
    tenantId: string;
    serviceIdentityId: string;
    productId: string;
  }) => Promise<OnboardingSnapshot>;
};

export type GovernedOutcome = {
  ok: true;
  apiVersion: string;
  tenantId: string;
  serviceIdentityId: string;
  productId: string;
  action: string;
  contractId: string;
  correlationId: string;
  requestId: string;
  replayed: boolean;
  result: unknown;
  resultRef: string | null;
  rateLimitRemaining: number;
};

export const IDEMPOTENCY_SCOPE_API = "api-request";

function auditEvent(input: {
  now: number;
  request: GovernedRequest;
  principalId: string;
  action: string;
  outcome: string;
  correlationId: string;
  requestId: string;
  auditSource?: string;
}): Record<string, unknown> {
  return {
    auditEventId: `api-${input.request.requestId}`,
    tenantId: input.request.tenantId,
    actorPrincipalId: input.principalId,
    serviceIdentityId: input.request.serviceIdentityId,
    action: input.action,
    resourceType: input.request.resourceType,
    resourceId: input.request.resourceId,
    timestamp: input.now,
    correlationId: input.correlationId,
    requestId: input.requestId,
    source: input.auditSource ?? "convex/apiService.invoke",
    metadata: { outcome: input.outcome, apiVersion: input.request.apiVersion },
    schemaVersion: "1.0.0",
    sequence: 0,
  };
}

// Run the governed pipeline. Returns a GovernedOutcome on success; throws an
// ApiError (bounded code) on any failure.
export async function runGovernedPipeline(
  rawEnvelope: unknown,
  ports: GovernedPorts,
): Promise<GovernedOutcome> {
  const now = ports.now();
  const nonceTtlMs = ports.nonceTtlMs ?? 10 * 60 * 1000;
  // ADDITIVE (Phase 6 Chat 4 convergence): the idempotency scope defaults to the
  // Chat 1 governed scope. The legal/regulatory domain API overrides it with
  // "legal-api" so its writes use the SAME authoritative idempotency foundation
  // under a domain-labelled scope.
  const idemScope = ports.idempotencyScope ?? IDEMPOTENCY_SCOPE_API;

  // 1. Envelope shape (fail closed).
  const request = validateRequestEnvelope(rawEnvelope);

  // 2. API version negotiation.
  resolveApiVersion(request.apiVersion);
  assertVersionCompatible(CURRENT_API_VERSION, request.apiVersion);

  // 3. Correlation context (mandatory).
  const correlation = buildCorrelationContext({
    correlationId: request.correlationId,
    requestId: request.requestId,
    tenantId: request.tenantId,
    serviceIdentityId: request.serviceIdentityId,
  });

  let principalId = "";
  try {
    // 4. Authenticate the service identity.
    const si = await ports.loadServiceIdentity(request.tenantId, request.serviceIdentityId);
    const authed = authenticateServiceIdentity({
      presentedServiceIdentityId: request.serviceIdentityId,
      tenantId: request.tenantId,
      serviceIdentity: si,
    });
    principalId = authed.principalId;
    const principal = await ports.loadPrincipal(request.tenantId, authed.principalId);

    // 5. Request integrity (signature over the canonical signed fields).
    const secret = await ports.resolveSecret(request.serviceIdentityId);
    if (!secret) {
      throw apiError("CREDENTIAL_INVALID", "no resolvable credential for service identity");
    }
    verifyRequestIntegrity(request, secret);

    // 6. Freshness.
    validateFreshness({
      timestamp: request.timestamp,
      now,
      windowMs: ports.freshnessWindowMs,
      futureSkewMs: ports.futureSkewMs,
    });

    // 7. Nonce replay protection.
    const seenNonce = await ports.getNonce(
      request.tenantId,
      request.serviceIdentityId,
      request.nonce,
    );
    if (seenNonce) {
      throw apiError("NONCE_REPLAY", "nonce has already been used");
    }

    // 8. Product binding (least privilege).
    assertServiceIdentityProductBinding(authed.productId, request.productId);

    // 9. Tenant resolution (never trust the client tenant id).
    const memberships = await ports.loadMemberships(request.tenantId, authed.principalId);
    const resolvedTenantId = resolveTenant({
      claimedTenantId: request.tenantId,
      principalId: authed.principalId,
      memberships,
    });

    // 10. Contract resolution. The action must address a KNOWN, non-retired
    //     contract for this API version. Unknown/retired -> CONTRACT_UNKNOWN.
    const contract = await ports.loadContract(
      resolvedTenantId,
      request.apiVersion,
      request.action,
    );
    if (!contract) {
      throw apiError("CONTRACT_UNKNOWN", `no contract for ${request.apiVersion}:${request.action}`);
    }
    if (contract.status === "RETIRED") {
      throw apiError("CONTRACT_UNKNOWN", "contract is retired");
    }
    if (contract.status !== "ACTIVE" && contract.status !== "DEPRECATED") {
      throw apiError("CONTRACT_UNKNOWN", "contract is not servable");
    }
    const requiredScope =
      typeof contract.requiredScope === "string" && contract.requiredScope.length > 0
        ? contract.requiredScope
        : "api:invoke";

    // 11. Authorization (RBAC + scope, server-side). The contract's required
    //     scope is the authorization action; UI roles are never trusted.
    const roleAssignments = await ports.loadRoleAssignments(request.tenantId, authed.principalId);
    const decision = authorizeGovernedAction({
      principal,
      roleAssignments,
      action: requiredScope,
      tenantId: resolvedTenantId,
      resource: { productId: request.productId, environment: request.environment },
    });
    if (!decision.allowed) {
      throw apiError("FORBIDDEN", `authorization denied: ${decision.reason}`);
    }

    // 12. Environment scope. Contract-declared environments are authoritative;
    //     an optional port-level allow-list further restricts them.
    const contractEnvs = Array.isArray(contract.allowedEnvironments)
      ? (contract.allowedEnvironments as unknown[]).filter(
          (e): e is string => typeof e === "string",
        )
      : [];
    const allowedEnvs =
      contractEnvs.length > 0 ? contractEnvs : (ports.allowedEnvironments ?? []);
    if (allowedEnvs.length > 0) {
      assertEnvironmentAuthorized(allowedEnvs, request.environment);
    }

    // 12b. Governed onboarding gate (Phase 7, Chat 1) \u2014 ADDITIVE and OPTIONAL.
    //      When a loadOnboarding port is supplied, the request must be backed by
    //      a fully ACTIVE onboarding: service identity, product registration and
    //      tenant bindings all ACTIVE, credentials usable, history not forged.
    //      The Core owns this decision; the ARMA API Hub only transports it.
    //      Absent the port, Chat 1 behavior is preserved EXACTLY.
    if (ports.loadOnboarding) {
      const snapshot = await ports.loadOnboarding({
        tenantId: resolvedTenantId,
        serviceIdentityId: request.serviceIdentityId,
        productId: request.productId,
      });
      evaluateOnboarding(
        {
          tenantId: resolvedTenantId,
          serviceIdentityId: request.serviceIdentityId,
          productId: request.productId,
          environment: request.environment,
          scope: requiredScope,
          now,
        },
        snapshot,
      );
    }

    // 13. Rate limit (contract override, else port/default).
    const windowMs =
      typeof contract.rateWindowMs === "number" && contract.rateWindowMs > 0
        ? contract.rateWindowMs
        : (ports.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS);
    const limit =
      typeof contract.rateLimit === "number" && contract.rateLimit > 0
        ? contract.rateLimit
        : (ports.rateLimit ?? DEFAULT_RATE_LIMIT);
    const bucketKey = buildRateLimitBucketKey({
      tenantId: resolvedTenantId,
      serviceIdentityId: request.serviceIdentityId,
      action: request.action,
    });
    const count = await ports.getRateCount(bucketKey, now, windowMs);
    const rl = evaluateRateLimit({ count, limit, now, windowMs });
    assertRateLimit(rl);

    // 14. Idempotency (tenant-aware). Replay must not duplicate authoritative
    //     records; same key + different payload fails closed.
    const idemKey = buildIdempotencyKey({
      tenantId: resolvedTenantId,
      scope: idemScope,
      key: request.idempotencyKey,
    });
    const existing = await ports.getIdempotency(
      resolvedTenantId,
      idemScope,
      request.idempotencyKey,
    );
    const idempotencyHash = computeIdempotencyHash(request);
    const replay = evaluateReplay(existing, idempotencyHash);
    if (replay.conflict) {
      throw apiError("IDEMPOTENCY_CONFLICT", "idempotency key reused with a different request");
    }
    if (replay.replay) {
      await ports.appendAudit(
        auditEvent({
          now,
          request,
          principalId: authed.principalId,
          action: "api.invoke.replay",
          outcome: "REPLAYED",
          correlationId: correlation.correlationId,
          requestId: correlation.requestId,
          auditSource: ports.auditSource,
        }),
      );
      return {
        ok: true,
        apiVersion: request.apiVersion,
        tenantId: resolvedTenantId,
        serviceIdentityId: request.serviceIdentityId,
        productId: request.productId,
        action: request.action,
        contractId: typeof contract.contractId === "string" ? contract.contractId : "",
        correlationId: correlation.correlationId,
        requestId: correlation.requestId,
        replayed: true,
        result: null,
        resultRef: replay.resultRef,
        rateLimitRemaining: rl.remaining,
      };
    }

    // 15. Dispatch.
    const result = await ports.dispatch(request);
    const resultRef = `api-result:${idemKey}`;

    // Commit side effects only after successful dispatch.
    await ports.bumpRateCount(bucketKey, now, windowMs);
    await ports.putNonce({
      tenantId: resolvedTenantId,
      serviceIdentityId: request.serviceIdentityId,
      nonce: request.nonce,
      requestHash: request.nonce,
      seenAt: now,
      expiresAt: now + nonceTtlMs,
    });
    await ports.putIdempotency({
      tenantId: resolvedTenantId,
      scope: idemScope,
      idempotencyKey: request.idempotencyKey,
      requestHash: idempotencyHash,
      status: "COMPLETED",
      resultRef,
      createdAt: now,
    });

    // 16. Audit correlation.
    await ports.appendAudit(
      auditEvent({
        now,
        request,
        principalId: authed.principalId,
        action: "api.invoke",
        outcome: "SUCCESS",
        correlationId: correlation.correlationId,
        requestId: correlation.requestId,
        auditSource: ports.auditSource,
      }),
    );

    return {
      ok: true,
      apiVersion: request.apiVersion,
      tenantId: resolvedTenantId,
      serviceIdentityId: request.serviceIdentityId,
      productId: request.productId,
      action: request.action,
      contractId: typeof contract.contractId === "string" ? contract.contractId : "",
      correlationId: correlation.correlationId,
      requestId: correlation.requestId,
      replayed: false,
      result,
      resultRef,
      rateLimitRemaining: rl.remaining,
    };
  } catch (error) {
    const e = toApiError(error);
    // Append a denial audit event (best-effort, never masks the original error).
    try {
      await ports.appendAudit(
        auditEvent({
          now,
          request,
          principalId,
          action: "api.invoke.denied",
          outcome: e.code,
          correlationId: correlation.correlationId,
          requestId: correlation.requestId,
          auditSource: ports.auditSource,
        }),
      );
    } catch {
      // Audit failure must not change the fail-closed outcome.
    }
    throw e;
  }
}
