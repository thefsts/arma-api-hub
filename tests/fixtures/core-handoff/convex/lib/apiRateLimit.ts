// FSTS Compliance Core — governed API rate-limit foundation (Phase 6, Chat 1)
//
// A deterministic, tenant-and-identity-scoped fixed-window limiter. This is a
// FOUNDATION: it provides the pure algorithm and the bucket key, plus a
// pluggable counter store. It does not depend on any external rate-limit
// service.

import { apiError } from "./apiErrors.ts";
import { requireNonEmptyString } from "./validation.ts";

export const DEFAULT_RATE_LIMIT = 600; // requests
export const DEFAULT_RATE_WINDOW_MS = 60 * 1000; // per minute

// Bucket key: tenant + service identity + action. Tenant scope is part of the
// key so one tenant can never exhaust another tenant's budget.
export function buildRateLimitBucketKey(input: {
  tenantId: unknown;
  serviceIdentityId: unknown;
  action: unknown;
}): string {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const serviceIdentityId = requireNonEmptyString(input.serviceIdentityId, "serviceIdentityId");
  const action = requireNonEmptyString(input.action, "action");
  return `${tenantId}::${serviceIdentityId}::${action}`;
}

// Compute the window start for a fixed-window limiter.
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

// Evaluate the limiter. `count` is the number of hits already recorded in the
// current window (before this request). Fail closed with RATE_LIMITED.
export function evaluateRateLimit(input: {
  count: number;
  limit?: number;
  now: number;
  windowMs?: number;
}): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const limit = input.limit ?? DEFAULT_RATE_LIMIT;
  const windowMs = input.windowMs ?? DEFAULT_RATE_WINDOW_MS;
  const count = Number.isFinite(input.count) && input.count > 0 ? Math.floor(input.count) : 0;
  const remaining = Math.max(0, limit - count - 1);
  if (count >= limit) {
    const start = windowStart(input.now, windowMs);
    const retryAfterMs = Math.max(0, start + windowMs - input.now);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
  return { allowed: true, remaining, retryAfterMs: 0 };
}

export function assertRateLimit(result: { allowed: boolean; retryAfterMs: number }): void {
  if (!result.allowed) {
    throw apiError("RATE_LIMITED", "rate limit exceeded");
  }
}
