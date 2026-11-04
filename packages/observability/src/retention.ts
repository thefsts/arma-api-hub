// ARMA API Hub — governed telemetry retention.
//
// PM CORRECTION C4 (locked): retention is NOT a hardcoded universal window. It
// is resolved per (environment, data classification, policy) through the policy
// layer, clamped to a bounded maximum. A policy may tighten or extend retention
// within bounds; it can never make the store retain raw evidence, because the
// observation record has no field capable of carrying it.
//
// The resolved window is recorded on the purge audit event so an operator can
// always answer "why was this deleted?" with the exact policy that applied.

import type { Environment } from './telemetry.js';

export type DataClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'PROTECTED' | 'REGULATED';

/** Absolute upper bound. No policy may exceed this. */
export const MAX_RETENTION_DAYS = 365;
/** Absolute lower bound. No policy may go below this (audit trail floor). */
export const MIN_RETENTION_DAYS = 7;

/**
 * Conservative fallback used ONLY when no policy is supplied. It is the
 * shortest defensible window, never the longest.
 */
export const CONSERVATIVE_FALLBACK_DAYS = 14;

export interface RetentionPolicy {
  /** Stable reference recorded on the purge audit event. */
  readonly policyRef: string;
  /** Optional per-environment override. */
  readonly byEnvironment?: Partial<Record<Environment, number>>;
  /** Optional per-classification override. */
  readonly byClassification?: Partial<Record<DataClassification, number>>;
  /** Optional hard cap for this policy. */
  readonly maxDays?: number;
}

export interface RetentionResolution {
  readonly retentionDays: number;
  readonly policyRef: string;
  readonly source:
    'POLICY_CLASSIFICATION' | 'POLICY_ENVIRONMENT' | 'POLICY_DEFAULT' | 'CONSERVATIVE_FALLBACK';
  readonly clamped: boolean;
}

function clampDays(value: number, cap: number): { days: number; clamped: boolean } {
  const upper = Math.min(cap, MAX_RETENTION_DAYS);
  if (!Number.isFinite(value)) return { days: CONSERVATIVE_FALLBACK_DAYS, clamped: true };
  const rounded = Math.floor(value);
  if (rounded < MIN_RETENTION_DAYS) return { days: MIN_RETENTION_DAYS, clamped: true };
  if (rounded > upper) return { days: upper, clamped: true };
  return { days: rounded, clamped: false };
}

/**
 * Resolve the retention window for an observation.
 *
 * Precedence: classification override -> environment override -> policy default
 * -> conservative fallback. The most specific applicable rule wins, and the
 * result is always clamped to [MIN_RETENTION_DAYS, min(policy.maxDays, MAX)].
 */
export function resolveRetention(input: {
  readonly environment: Environment;
  readonly dataClassification: DataClassification;
  readonly policy?: RetentionPolicy;
}): RetentionResolution {
  const cap = input.policy?.maxDays ?? MAX_RETENTION_DAYS;

  if (!input.policy) {
    return {
      retentionDays: clampDays(CONSERVATIVE_FALLBACK_DAYS, cap).days,
      policyRef: 'fallback:conservative',
      source: 'CONSERVATIVE_FALLBACK',
      clamped: true,
    };
  }

  const classificationDays = input.policy.byClassification?.[input.dataClassification];
  if (typeof classificationDays === 'number') {
    const { days, clamped } = clampDays(classificationDays, cap);
    return {
      retentionDays: days,
      policyRef: input.policy.policyRef,
      source: 'POLICY_CLASSIFICATION',
      clamped,
    };
  }

  const environmentDays = input.policy.byEnvironment?.[input.environment];
  if (typeof environmentDays === 'number') {
    const { days, clamped } = clampDays(environmentDays, cap);
    return {
      retentionDays: days,
      policyRef: input.policy.policyRef,
      source: 'POLICY_ENVIRONMENT',
      clamped,
    };
  }

  const fallback = clampDays(CONSERVATIVE_FALLBACK_DAYS, cap);
  return {
    retentionDays: fallback.days,
    policyRef: input.policy.policyRef,
    source: 'POLICY_DEFAULT',
    clamped: fallback.clamped,
  };
}

/** Epoch ms before which observations are expired under the resolution. */
export function retentionCutoff(now: number, resolution: RetentionResolution): number {
  return now - resolution.retentionDays * 24 * 60 * 60 * 1000;
}
