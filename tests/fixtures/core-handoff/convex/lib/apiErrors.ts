// FSTS Compliance Core — governed API error taxonomy (Phase 6, Chat 1)
//
// Standardized, fail-closed error surface for the governed Compliance
// Service/API. Every governed request that fails does so with a bounded,
// machine-readable code — never a raw exception, never a silent success.
//
// PASS != COMPLIANT / IMPLEMENTED != CERTIFIED. A successful governed call is
// an operational outcome, never a compliance or certification claim.

export const API_ERROR_CODES = [
  // authentication / identity
  "UNAUTHENTICATED",
  "IDENTITY_INVALID",
  "IDENTITY_REVOKED",
  "IDENTITY_SUSPENDED",
  "CREDENTIAL_INVALID",
  // tenancy / authorization
  "TENANT_UNRESOLVED",
  "TENANT_ACCESS_DENIED",
  "FORBIDDEN",
  "SCOPE_VIOLATION",
  "PRODUCT_ISOLATION_VIOLATION",
  "ENVIRONMENT_NOT_AUTHORIZED",
  // request integrity / freshness / replay
  "MALFORMED_PAYLOAD",
  "REQUEST_TAMPERED",
  "REQUEST_STALE",
  "REQUEST_FUTURE",
  "NONCE_INVALID",
  "NONCE_REPLAY",
  "DUPLICATE_REQUEST",
  "IDEMPOTENCY_CONFLICT",
  // versioning
  "UNKNOWN_API_VERSION",
  "API_VERSION_UNSUPPORTED",
  // throttling / platform
  "RATE_LIMITED",
  "CONTRACT_UNKNOWN",
  "INTERNAL",
  // Phase 7 (Chat 1) \u2014 production onboarding. ADDITIVE. Fail-closed codes for
  // the governed onboarding layer. APPROVED != ACTIVE; a subject that has not
  // reached ACTIVE through the full state machine cannot be consumed.
  "ONBOARDING_NOT_APPROVED",
  "ONBOARDING_STATE_INVALID",
  "ONBOARDING_FORGED",
  "PRODUCT_NOT_APPROVED",
  "INTEGRATION_INACTIVE",
  "CREDENTIAL_EXPIRED",
  "CREDENTIAL_REVOKED",
  "ROTATION_INVALID",
  "TENANT_BINDING_MISSING",
  "SCOPE_NOT_BOUND",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// HTTP status mapping (governed service surface). Deterministic and closed.
const HTTP_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  IDENTITY_INVALID: 401,
  IDENTITY_REVOKED: 401,
  IDENTITY_SUSPENDED: 403,
  CREDENTIAL_INVALID: 401,
  TENANT_UNRESOLVED: 400,
  TENANT_ACCESS_DENIED: 403,
  FORBIDDEN: 403,
  SCOPE_VIOLATION: 403,
  PRODUCT_ISOLATION_VIOLATION: 403,
  ENVIRONMENT_NOT_AUTHORIZED: 403,
  MALFORMED_PAYLOAD: 400,
  REQUEST_TAMPERED: 401,
  REQUEST_STALE: 401,
  REQUEST_FUTURE: 401,
  NONCE_INVALID: 400,
  NONCE_REPLAY: 409,
  DUPLICATE_REQUEST: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UNKNOWN_API_VERSION: 400,
  API_VERSION_UNSUPPORTED: 400,
  RATE_LIMITED: 429,
  CONTRACT_UNKNOWN: 404,
  INTERNAL: 500,
  ONBOARDING_NOT_APPROVED: 403,
  ONBOARDING_STATE_INVALID: 409,
  ONBOARDING_FORGED: 401,
  PRODUCT_NOT_APPROVED: 403,
  INTEGRATION_INACTIVE: 403,
  CREDENTIAL_EXPIRED: 401,
  CREDENTIAL_REVOKED: 401,
  ROTATION_INVALID: 401,
  TENANT_BINDING_MISSING: 403,
  SCOPE_NOT_BOUND: 403,
};

// Retryability: only transient throttling/platform conditions are retryable.
// Integrity, auth, and authorization failures are never retryable.
const RETRYABLE: Record<ApiErrorCode, boolean> = {
  UNAUTHENTICATED: false,
  IDENTITY_INVALID: false,
  IDENTITY_REVOKED: false,
  IDENTITY_SUSPENDED: false,
  CREDENTIAL_INVALID: false,
  TENANT_UNRESOLVED: false,
  TENANT_ACCESS_DENIED: false,
  FORBIDDEN: false,
  SCOPE_VIOLATION: false,
  PRODUCT_ISOLATION_VIOLATION: false,
  ENVIRONMENT_NOT_AUTHORIZED: false,
  MALFORMED_PAYLOAD: false,
  REQUEST_TAMPERED: false,
  REQUEST_STALE: false,
  REQUEST_FUTURE: false,
  NONCE_INVALID: false,
  NONCE_REPLAY: false,
  DUPLICATE_REQUEST: false,
  IDEMPOTENCY_CONFLICT: false,
  UNKNOWN_API_VERSION: false,
  API_VERSION_UNSUPPORTED: false,
  RATE_LIMITED: true,
  CONTRACT_UNKNOWN: false,
  INTERNAL: true,
  ONBOARDING_NOT_APPROVED: false,
  ONBOARDING_STATE_INVALID: false,
  ONBOARDING_FORGED: false,
  PRODUCT_NOT_APPROVED: false,
  INTEGRATION_INACTIVE: false,
  CREDENTIAL_EXPIRED: false,
  CREDENTIAL_REVOKED: false,
  ROTATION_INVALID: false,
  TENANT_BINDING_MISSING: false,
  SCOPE_NOT_BOUND: false,
};

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

export function httpStatusFor(code: ApiErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

export function isRetryable(code: ApiErrorCode): boolean {
  return RETRYABLE[code] ?? false;
}

// The governed API error. Always carries a bounded code; never leaks internals.
export class ApiError extends Error {
  code: ApiErrorCode;
  httpStatus: number;
  retryable: boolean;
  details: Record<string, unknown> | null;

  constructor(code: ApiErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatusFor(code);
    this.retryable = isRetryable(code);
    this.details = details ?? null;
  }
}

export function apiError(
  code: ApiErrorCode,
  message?: string,
  details?: Record<string, unknown>,
): ApiError {
  return new ApiError(code, message, details);
}

// Standardized response envelope. `ok:false` always carries a bounded code.
export function errorEnvelope(
  error: unknown,
  context?: { requestId?: string | null; correlationId?: string | null },
): {
  ok: false;
  error: { code: ApiErrorCode; message: string; retryable: boolean };
  httpStatus: number;
  requestId: string | null;
  correlationId: string | null;
} {
  const e = error instanceof ApiError ? error : apiError("INTERNAL", "internal error");
  return {
    ok: false,
    error: { code: e.code, message: e.message, retryable: e.retryable },
    httpStatus: e.httpStatus,
    requestId: context?.requestId ?? null,
    correlationId: context?.correlationId ?? null,
  };
}

// Normalize any thrown value into an ApiError. Unknown throws fail closed to
// INTERNAL — they are never surfaced verbatim.
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return apiError("INTERNAL", "internal error");
}
