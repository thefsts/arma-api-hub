// FSTS Compliance Core — governed API correlation (Phase 6, Chat 1)
//
// Every governed request carries a correlationId and a requestId so that the
// full authorization + audit trail for a single logical operation can be
// reconstructed. Correlation is mandatory: a governed call without one fails
// closed (MALFORMED_PAYLOAD) rather than producing uncorrelatable audit.

import { apiError } from "./apiErrors.ts";
import { requireNonEmptyString } from "./validation.ts";

// Bounded, opaque id shape. UUIDs and ULID-like tokens are accepted; anything
// with control characters or excessive length is rejected.
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function isValidCorrelationId(value: unknown): boolean {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function requireCorrelationId(value: unknown): string {
  if (!isValidCorrelationId(value)) {
    throw apiError("MALFORMED_PAYLOAD", "correlationId is missing or malformed");
  }
  return value as string;
}

export function requireRequestId(value: unknown): string {
  if (!isValidCorrelationId(value)) {
    throw apiError("MALFORMED_PAYLOAD", "requestId is missing or malformed");
  }
  return value as string;
}

// Build the correlation context that ties request -> authorization -> audit.
export function buildCorrelationContext(input: {
  correlationId: unknown;
  requestId: unknown;
  tenantId?: string | null;
  serviceIdentityId?: string | null;
}): {
  correlationId: string;
  requestId: string;
  tenantId: string | null;
  serviceIdentityId: string | null;
} {
  return {
    correlationId: requireCorrelationId(input.correlationId),
    requestId: requireRequestId(input.requestId),
    tenantId: input.tenantId ?? null,
    serviceIdentityId: input.serviceIdentityId ?? null,
  };
}

// Convenience: assert a non-empty string id for internal use.
export function requireNonEmpty(value: unknown, name: string): string {
  return requireNonEmptyString(value, name);
}
