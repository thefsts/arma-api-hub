// ARMA API Hub — deterministic cost calculation primitives.
//
// These are pure, side-effect-free functions. They are the ONLY place where
// monetary arithmetic happens, so that cost behavior is identical everywhere
// and can be unit-tested deterministically.
//
// MONEY RULES (locked):
//   * Monetary amounts are INTEGER MINOR CURRENCY UNITS (e.g. cents). Floating
//     point is never used to represent or store money.
//   * Quantities are integer counts of a usage unit (requests, bytes, tokens,
//     seconds, deliveries, retries, storage byte-months).
//   * Every calculated amount is derived from an immutable vendor price version
//     that was effective when the request occurred. Historical usage is never
//     recomputed with a newer price.
//
// These primitives never touch vendor credentials and never emit a field that
// claims to be profit, margin, or company-wide cost.

import { fail } from './errors';

/** Assert that a value is a non-negative safe integer. */
function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
    fail('VALIDATION_FAILED', `${label} must be a non-negative safe integer.`, { label });
  }
}

/**
 * Compute an authoritative cost amount in integer minor units.
 *
 * `quantity` is an integer count of `unitType`; `unitPriceMinor` is the integer
 * minor-unit price of one unit from the effective vendor price version. The
 * product must remain a safe integer — otherwise the amount is rejected rather
 * than silently losing precision.
 */
export function computeCostMinor(quantity: number, unitPriceMinor: number): number {
  requireNonNegativeInteger(quantity, 'quantity');
  requireNonNegativeInteger(unitPriceMinor, 'unitPriceMinor');
  const amount = quantity * unitPriceMinor;
  if (!Number.isSafeInteger(amount)) {
    fail('VALIDATION_FAILED', 'Computed cost exceeds the safe integer range.');
  }
  return amount;
}

/**
 * Compute retry waste: the cost of attempts that did not produce a usable
 * result. The first attempt is the intended request; every additional failed
 * attempt is waste.
 */
export function computeRetryWasteMinor(failedAttempts: number, unitPriceMinor: number): number {
  requireNonNegativeInteger(failedAttempts, 'failedAttempts');
  requireNonNegativeInteger(unitPriceMinor, 'unitPriceMinor');
  return computeCostMinor(failedAttempts, unitPriceMinor);
}

/**
 * Compute cache savings: the cost avoided by serving a request from cache
 * instead of performing the external call.
 */
export function computeCacheSavingsMinor(cacheHits: number, unitPriceMinor: number): number {
  requireNonNegativeInteger(cacheHits, 'cacheHits');
  requireNonNegativeInteger(unitPriceMinor, 'unitPriceMinor');
  return computeCostMinor(cacheHits, unitPriceMinor);
}

/**
 * Compute batch savings: the difference between the realtime-equivalent cost
 * and the batched cost. Savings are never negative.
 */
export function computeBatchSavingsMinor(
  realtimeEquivalentMinor: number,
  batchedMinor: number,
): number {
  requireNonNegativeInteger(realtimeEquivalentMinor, 'realtimeEquivalentMinor');
  requireNonNegativeInteger(batchedMinor, 'batchedMinor');
  return realtimeEquivalentMinor > batchedMinor ? realtimeEquivalentMinor - batchedMinor : 0;
}

/** A minimal price-version shape for effective-date resolution. */
export interface PriceVersionLike {
  readonly pricingVersionId: string;
  readonly effectiveFrom: number;
  readonly effectiveTo?: number;
}

/**
 * Resolve the price version that was effective at `at` (epoch ms).
 *
 * A version applies when `effectiveFrom <= at` and (`effectiveTo` is absent or
 * `at < effectiveTo`). When several versions match, the one with the latest
 * `effectiveFrom` wins. Returns `null` when no version applies — callers must
 * fail closed rather than guess a price.
 */
export function resolveEffectivePriceVersion<T extends PriceVersionLike>(
  versions: readonly T[],
  at: number,
): T | null {
  let best: T | null = null;
  for (const version of versions) {
    if (version.effectiveFrom > at) continue;
    if (version.effectiveTo !== undefined && at >= version.effectiveTo) continue;
    if (best === null || version.effectiveFrom > best.effectiveFrom) {
      best = version;
    }
  }
  return best;
}

/** Threshold evaluation result. */
export interface ThresholdEvaluation {
  readonly status: 'OK' | 'WARNING' | 'THROTTLED' | 'BLOCKED';
  /** Consumed / limit as a percentage, rounded to two decimals. */
  readonly consumedPct: number;
}

/**
 * Evaluate a consumption threshold deterministically.
 *
 * `warningPct` is the percentage at which a WARNING is raised. When consumed
 * reaches or exceeds the limit, the status is BLOCKED (the caller decides
 * whether to throttle or hard-block based on the configured action).
 */
export function evaluateThreshold(
  consumedMinor: number,
  limitMinor: number,
  warningPct: number,
): ThresholdEvaluation {
  requireNonNegativeInteger(consumedMinor, 'consumedMinor');
  requireNonNegativeInteger(limitMinor, 'limitMinor');
  if (limitMinor === 0) {
    return { status: consumedMinor > 0 ? 'BLOCKED' : 'OK', consumedPct: 0 };
  }
  const consumedPct = Math.round((consumedMinor / limitMinor) * 10000) / 100;
  if (consumedMinor >= limitMinor) {
    return { status: 'BLOCKED', consumedPct };
  }
  if (consumedPct >= warningPct) {
    return { status: 'WARNING', consumedPct };
  }
  return { status: 'OK', consumedPct };
}

/**
 * Compute a deviation percentage between an expected and observed amount.
 * Used for anomaly detection. Rounded to two decimals.
 */
export function computeDeviationPct(expectedMinor: number, observedMinor: number): number {
  requireNonNegativeInteger(expectedMinor, 'expectedMinor');
  requireNonNegativeInteger(observedMinor, 'observedMinor');
  if (expectedMinor === 0) {
    return observedMinor === 0 ? 0 : 100;
  }
  return Math.round(((observedMinor - expectedMinor) / expectedMinor) * 10000) / 100;
}
