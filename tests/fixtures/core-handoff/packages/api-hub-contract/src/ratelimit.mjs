// FSTS Compliance Core — Phase 6
// API Hub Contract — rate limits, quotas, retry-storm protection.
// ---------------------------------------------------------------------------
// The API Hub owns external rate limiting/quotas for vendor APIs; Compliance
// Core enforces its OWN inbound rate limit + quota so a misbehaving or
// compromised caller cannot exhaust Core. All evaluation is deterministic and
// driven by explicit `now` — no wall clock.
//
// TRANSPORT-ONLY (locked): this module is the API HUB TRANSPORT-side reference
// implementation of rate limiting/quotas. It does NOT replace, duplicate,
// weaken, or bypass the Core's authoritative inbound rate limit + quota
// (convex/lib/apiPipeline.ts). The Hub transports; the Core decides.
// ---------------------------------------------------------------------------

export const TRANSPORT_ONLY = true;
export const TRANSPORT_ROLE = 'API_HUB_TRANSPORT_REFERENCE';

import { DEFAULT_RATE_LIMIT, DEFAULT_QUOTA, RETRY_BUDGET } from './constants.mjs';

/** Bucket key: per (tenant, product, action). */
export function rateBucketKey({ tenantId, productId, action }) {
  return `${tenantId}::${productId}::${action}`;
}

/**
 * Fixed-window rate limit evaluation. `buckets` is a Map/array of
 * { key, windowStart, count }. Returns the decision + the next bucket state.
 */
export function evaluateRateLimit({ envelope, buckets, now, limit = DEFAULT_RATE_LIMIT.limit, windowMs = DEFAULT_RATE_LIMIT.windowMs }) {
  const key = rateBucketKey(envelope);
  const list = Array.isArray(buckets) ? buckets : [];
  const existing = list.find((b) => b && b.key === key) ?? null;
  const inWindow = existing && now - existing.windowStart < windowMs;
  const count = inWindow ? existing.count : 0;
  const windowStart = inWindow ? existing.windowStart : now;

  if (count >= limit) {
    const resetAt = windowStart + windowMs;
    return {
      allowed: false,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterMs: Math.max(0, resetAt - now),
      remaining: 0,
      next: { key, windowStart, count },
    };
  }
  return {
    allowed: true,
    code: null,
    retryAfterMs: null,
    remaining: limit - count - 1,
    next: { key, windowStart, count: count + 1 },
  };
}

/**
 * Period quota evaluation. `ledgers` is a Map/array of
 * { key, period, consumed, limit }. Returns the decision + next ledger state.
 */
export function evaluateQuota({ envelope, ledgers, period, limit = DEFAULT_QUOTA.limit }) {
  const key = rateBucketKey(envelope);
  const list = Array.isArray(ledgers) ? ledgers : [];
  const existing = list.find((l) => l && l.key === key && l.period === period) ?? null;
  const consumed = existing ? existing.consumed : 0;
  if (consumed >= limit) {
    return {
      allowed: false,
      code: 'QUOTA_EXCEEDED',
      remaining: 0,
      next: { key, period, consumed, limit },
    };
  }
  return {
    allowed: true,
    code: null,
    remaining: limit - consumed - 1,
    next: { key, period, consumed: consumed + 1, limit },
  };
}

/**
 * Retry-storm protection: the Hub may retry a logical request at most
 * RETRY_BUDGET times. Beyond that, a RETRY_STORM is declared (fail closed on
 * the retry, but the original outcome is preserved).
 */
export function evaluateRetryStorm({ attempt }) {
  if (Number.isInteger(attempt) && attempt >= RETRY_BUDGET) {
    return { storm: true, code: 'RETRY_STORM' };
  }
  return { storm: false, code: null };
}

/** Rate-limit abuse: a burst far above the limit is flagged, not just capped. */
export function detectRateLimitAbuse({ attempt, limit = DEFAULT_RATE_LIMIT.limit }) {
  const abuseThreshold = limit * 3;
  return { abuse: Number.isInteger(attempt) && attempt > abuseThreshold, code: 'RATE_LIMIT_EXCEEDED' };
}
