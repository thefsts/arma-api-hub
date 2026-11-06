// ARMA API Hub — internal SLO computation.
//
// PM CORRECTION C3 (locked): every value here is an INITIAL INTERNAL
// OPERATIONAL TARGET. It is not an SLA, not a compliance requirement, not a
// certification, and not a customer promise. Every computed window carries
// `targetClass = INTERNAL_OPERATIONAL_TARGET` and `complianceClaim = NONE`.
//
// This module computes reliability signals from observed transport facts. It
// never infers a compliance conclusion from a healthy transport.

export const SLO_TARGET_CLASS = 'INTERNAL_OPERATIONAL_TARGET' as const;
export const SLO_COMPLIANCE_CLAIM = 'NONE' as const;

/** Words that must never appear in an SLO record. */
export const FORBIDDEN_SLO_WORDS = [
  'SLA',
  'CONTRACTUAL',
  'CERTIFIED',
  'REGULATORY',
  'CUSTOMER_PROMISE',
  'GUARANTEE',
] as const;

/** Initial internal operational targets. Tunable without external process. */
export const INITIAL_INTERNAL_TARGETS = {
  successRatio: 0.99,
  latencyP95Ms: 400,
  latencyP99Ms: 1200,
  availabilityRatio: 0.995,
  retryRate: 0.02,
  rateLimitEventRate: 0.005,
  deadLetterRate: 0.001,
} as const;

export interface SloWindowInput {
  readonly windowId: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly totalRequests: number;
  readonly successes: number;
  readonly failures: number;
  readonly latenciesMs: readonly number[];
  readonly retries: number;
  readonly rateLimited: number;
  readonly deadLettered: number;
  /** Minutes a dependency was observed UNAVAILABLE in the window. */
  readonly dependencyUnavailableMinutes: number;
  /** Total minutes the window covers. */
  readonly observedMinutes: number;
}

export interface SloWindow {
  readonly windowId: string;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly totalRequests: number;
  readonly successRatio: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly latencyP99Ms: number;
  readonly availabilityRatio: number;
  readonly retryRate: number;
  readonly rateLimitEventRate: number;
  readonly deadLetterRate: number;
  readonly targetClass: typeof SLO_TARGET_CLASS;
  readonly complianceClaim: typeof SLO_COMPLIANCE_CLAIM;
  readonly evaluatedAgainst: typeof INITIAL_INTERNAL_TARGETS;
  readonly breaches: readonly string[];
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

/** Nearest-rank percentile over a sorted copy. Returns 0 for an empty set. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

/** Compute an internal SLO window from observed transport facts. */
export function computeSloWindow(input: SloWindowInput): SloWindow {
  const successRatio = ratio(input.successes, input.totalRequests);
  const availabilityRatio =
    input.observedMinutes > 0
      ? Math.max(
          0,
          (input.observedMinutes - input.dependencyUnavailableMinutes) / input.observedMinutes,
        )
      : 0;
  const retryRate = ratio(input.retries, input.totalRequests);
  const rateLimitEventRate = ratio(input.rateLimited, input.totalRequests);
  const deadLetterRate = ratio(input.deadLettered, input.totalRequests);
  const p95 = percentile(input.latenciesMs, 95);
  const p99 = percentile(input.latenciesMs, 99);

  const breaches: string[] = [];
  if (input.totalRequests > 0 && successRatio < INITIAL_INTERNAL_TARGETS.successRatio) {
    breaches.push('SUCCESS_RATIO_BELOW_INTERNAL_TARGET');
  }
  if (input.latenciesMs.length > 0 && p95 > INITIAL_INTERNAL_TARGETS.latencyP95Ms) {
    breaches.push('LATENCY_P95_ABOVE_INTERNAL_TARGET');
  }
  if (input.latenciesMs.length > 0 && p99 > INITIAL_INTERNAL_TARGETS.latencyP99Ms) {
    breaches.push('LATENCY_P99_ABOVE_INTERNAL_TARGET');
  }
  if (input.observedMinutes > 0 && availabilityRatio < INITIAL_INTERNAL_TARGETS.availabilityRatio) {
    breaches.push('AVAILABILITY_BELOW_INTERNAL_TARGET');
  }
  if (input.totalRequests > 0 && retryRate > INITIAL_INTERNAL_TARGETS.retryRate) {
    breaches.push('RETRY_RATE_ABOVE_INTERNAL_TARGET');
  }
  if (input.totalRequests > 0 && rateLimitEventRate > INITIAL_INTERNAL_TARGETS.rateLimitEventRate) {
    breaches.push('RATE_LIMIT_RATE_ABOVE_INTERNAL_TARGET');
  }
  if (input.totalRequests > 0 && deadLetterRate > INITIAL_INTERNAL_TARGETS.deadLetterRate) {
    breaches.push('DEAD_LETTER_RATE_ABOVE_INTERNAL_TARGET');
  }

  return {
    windowId: input.windowId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    totalRequests: input.totalRequests,
    successRatio,
    latencyP50Ms: percentile(input.latenciesMs, 50),
    latencyP95Ms: p95,
    latencyP99Ms: p99,
    availabilityRatio,
    retryRate,
    rateLimitEventRate,
    deadLetterRate,
    targetClass: SLO_TARGET_CLASS,
    complianceClaim: SLO_COMPLIANCE_CLAIM,
    evaluatedAgainst: INITIAL_INTERNAL_TARGETS,
    breaches,
  };
}

/** Static guard used by tests: an SLO record may not claim SLA semantics. */
export function assertInternalTargetSemantics(record: Record<string, unknown>): void {
  if (record['targetClass'] !== SLO_TARGET_CLASS) {
    throw new Error('SLO_TARGET_CLASS_MUST_BE_INTERNAL_OPERATIONAL_TARGET');
  }
  if (record['complianceClaim'] !== SLO_COMPLIANCE_CLAIM) {
    throw new Error('SLO_COMPLIANCE_CLAIM_MUST_BE_NONE');
  }
  const serialized = JSON.stringify(record).toUpperCase();
  for (const word of FORBIDDEN_SLO_WORDS) {
    if (serialized.includes(`"${word}`) || serialized.includes(`${word}"`)) {
      throw new Error(`FORBIDDEN_SLO_SEMANTICS: ${word}`);
    }
  }
}
