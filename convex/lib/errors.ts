// Structured error helpers for the ARMA API Hub control plane.
//
// All failures surface as a ConvexError carrying a stable machine-readable
// code. Error payloads never include secrets, signatures, credentials, or
// protected payloads.

import { ConvexError, type Value } from 'convex/values';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'POLICY_DENIED'
  | 'KILL_SWITCH_ENGAGED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NONCE_REPLAY'
  | 'CREDENTIAL_REVOKED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'VENDOR_SHUTDOWN'
  | 'INTERNAL';

/** Throw a structured, redaction-safe error. */
export function fail(
  code: ErrorCode,
  message: string,
  details?: Record<string, string | number | boolean>,
): never {
  const payload: Record<string, Value> = { code, message };
  if (details) {
    const safeDetails: Record<string, Value> = {};
    for (const [key, value] of Object.entries(details)) {
      safeDetails[key] = value;
    }
    payload['details'] = safeDetails;
  }
  throw new ConvexError(payload);
}
