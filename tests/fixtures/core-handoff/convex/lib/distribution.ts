// FSTS Compliance Core — distribution / adoption / rollback builders
// (Phase 6, Chat 3).
//
// Pure, deterministic, fail-closed builders + evaluators for the post-release
// half of the locked lifecycle: DISTRIBUTION → PRODUCT ADOPTION → ROLLBACK.
//
// Hard invariants enforced here (never weakened):
//   RELEASED != ADOPTED  — a distribution/release existing proves nothing.
//   RECEIVED != APPLIED  — delivery/receipt never proves application.
//
// Product intake is FROZEN: only SYNTHETIC_TARGET targets are permitted.

import {
  ValidationError,
  requireNonEmptyString,
  requireEnum,
  compact,
} from "./validation.ts";
import {
  DISTRIBUTION_STATES,
  DISTRIBUTION_DELIVERED_STATES,
  DISTRIBUTION_TERMINAL_STATES,
  ADOPTION_STATES,
  ROLLBACK_STATES,
  ROLLBACK_REASON_CATEGORIES,
  FROZEN_TARGET_TYPE,
  type DistributionState,
} from "./lifecycleConstants.ts";
import type { ReleaseEligibility } from "./policyRelease.ts";

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// 1. Release distribution — governed delivery. Delivery is NOT adoption.
// ---------------------------------------------------------------------------
export function buildReleaseDistribution(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const distributionId = requireNonEmptyString(input.distributionId, "distributionId");
  const releaseId = requireNonEmptyString(input.releaseId, "releaseId");
  const releaseVersion = requireNonEmptyString(input.releaseVersion, "releaseVersion");
  const targetTenant = requireNonEmptyString(input.targetTenant, "targetTenant");
  const targetProduct = requireNonEmptyString(input.targetProduct, "targetProduct");
  const environment = requireNonEmptyString(input.environment, "environment");
  const deliveryState = requireEnum(input.deliveryState ?? "PENDING", DISTRIBUTION_STATES, "deliveryState");
  const correlationId = requireNonEmptyString(input.correlationId, "correlationId");
  const idempotencyKey = requireNonEmptyString(input.idempotencyKey, "idempotencyKey");

  // Product intake frozen: delivery targets must be synthetic.
  if (!targetTenant.startsWith("SYNTH-")) {
    throw new ValidationError("PRODUCT_INTAKE_FROZEN", `targetTenant ${targetTenant} is not SYNTH-* (product intake frozen)`);
  }
  if (!targetProduct.startsWith("SYNTH-")) {
    throw new ValidationError("PRODUCT_INTAKE_FROZEN", `targetProduct ${targetProduct} is not SYNTH-* (product intake frozen)`);
  }

  return compact({
    tenantId,
    distributionId,
    releaseId,
    releaseVersion,
    targetTenant,
    targetProduct,
    environment,
    deliveryState,
    attemptCount: typeof input.attemptCount === "number" ? input.attemptCount : 0,
    correlationId,
    idempotencyKey,
    deliveredAt: input.deliveredAt ?? null,
    acknowledgedAt: input.acknowledgedAt ?? null,
    failure: input.failure ?? null,
    retryState: input.retryState ?? null,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

export interface DistributionDecision {
  deliverable: boolean;
  idempotentReplay: boolean;
  delivered: boolean;
  terminal: boolean;
  provesApplication: false;
  reasons: string[];
}

/**
 * Evaluate a distribution attempt. Idempotent: the same idempotencyKey against
 * the same release/target yields the same decision and never double-delivers.
 * A conflicting reuse of the key is rejected (never silently merged).
 */
export function evaluateDistribution(input: {
  releaseEligibility: ReleaseEligibility | { eligible: false };
  distribution: Record<string, any>;
  priorDistributions?: Array<Record<string, any>>;
}): DistributionDecision {
  const { releaseEligibility, distribution, priorDistributions = [] } = input;
  const reasons: string[] = [];
  if (!releaseEligibility?.eligible) reasons.push("RELEASE_NOT_ELIGIBLE");
  if (!distribution?.idempotencyKey) reasons.push("MISSING_IDEMPOTENCY_KEY");
  if (!distribution?.correlationId) reasons.push("MISSING_CORRELATION_ID");

  const prior = priorDistributions.find((d) => d.idempotencyKey === distribution?.idempotencyKey);
  let idempotentReplay = false;
  if (prior) {
    const sameTarget =
      prior.releaseId === distribution.releaseId &&
      prior.targetTenant === distribution.targetTenant &&
      prior.targetProduct === distribution.targetProduct &&
      prior.environment === distribution.environment;
    if (!sameTarget) reasons.push("IDEMPOTENCY_KEY_CONFLICT");
    else idempotentReplay = true;
  }

  const delivered = (DISTRIBUTION_DELIVERED_STATES as readonly string[]).includes(distribution?.deliveryState);
  const terminal = (DISTRIBUTION_TERMINAL_STATES as readonly string[]).includes(distribution?.deliveryState);

  return {
    deliverable: reasons.length === 0,
    idempotentReplay,
    delivered,
    terminal,
    provesApplication: false,
    reasons: uniq(reasons),
  };
}

// A delivery acknowledgement advances DELIVERED → ACKNOWLEDGED. It never
// advances adoption.
export function buildDeliveryAcknowledgement(input: {
  distribution: Record<string, any>;
  acknowledgedAt: number;
}): Record<string, unknown> {
  const { distribution, acknowledgedAt } = input;
  const state = distribution.deliveryState as DistributionState;
  if (state === "CANCELLED") {
    throw new ValidationError("DISTRIBUTION_CANCELLED", "a cancelled distribution cannot be acknowledged");
  }
  if (!(DISTRIBUTION_DELIVERED_STATES as readonly string[]).includes(state)) {
    throw new ValidationError(
      "DISTRIBUTION_NOT_DELIVERED",
      `cannot acknowledge a distribution in state ${state} (must be DELIVERED first)`,
    );
  }
  return compact({
    deliveryState: "ACKNOWLEDGED",
    acknowledgedAt,
    // Delivery/acknowledgement never proves application.
    provesApplication: false,
  });
}

// ---------------------------------------------------------------------------
// 2. Adoption receipt + state — RECEIVED != APPLIED.
// ---------------------------------------------------------------------------
export function buildAdoptionReceipt(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const receiptId = requireNonEmptyString(input.receiptId, "receiptId");
  const releaseId = requireNonEmptyString(input.releaseId, "releaseId");
  const releaseVersion = requireNonEmptyString(input.releaseVersion, "releaseVersion");
  const targetRef = requireNonEmptyString(input.targetRef, "targetRef");
  const targetType = requireNonEmptyString(input.targetType, "targetType");
  const resultingState = requireEnum(input.resultingState, ADOPTION_STATES, "resultingState");
  const correlationId = requireNonEmptyString(input.correlationId, "correlationId");
  const integrityHash = requireNonEmptyString(input.integrityHash, "integrityHash");
  const integrityAlgorithm = requireNonEmptyString(input.integrityAlgorithm, "integrityAlgorithm");

  // Product intake frozen: only synthetic targets are permitted.
  if (targetType !== FROZEN_TARGET_TYPE) {
    throw new ValidationError(
      "PRODUCT_INTAKE_FROZEN",
      `targetType ${targetType} is not ${FROZEN_TARGET_TYPE} (product intake frozen)`,
    );
  }
  if (!targetRef.startsWith("SYNTH-")) {
    throw new ValidationError("PRODUCT_INTAKE_FROZEN", `targetRef ${targetRef} is not SYNTH-* (product intake frozen)`);
  }

  const receivedAt = typeof input.receivedAt === "number" ? input.receivedAt : null;
  const appliedAt = typeof input.appliedAt === "number" ? input.appliedAt : null;

  // RECEIVED != APPLIED is structural: a receipt may be RECEIVED/VALIDATED
  // without ever being APPLIED. APPLIED requires an appliedAt fact.
  if (resultingState === "RECEIVED" && receivedAt === null) {
    throw new ValidationError("RECEIVED_WITHOUT_RECEIVED_AT", "RECEIVED requires receivedAt");
  }
  if (resultingState === "APPLIED" && appliedAt === null) {
    throw new ValidationError("APPLIED_WITHOUT_APPLIED_AT", "APPLIED requires appliedAt");
  }
  if (appliedAt !== null && receivedAt === null) {
    throw new ValidationError("APPLIED_WITHOUT_RECEIVED", "application requires a prior receipt");
  }

  return compact({
    tenantId,
    receiptId,
    releaseId,
    releaseVersion,
    targetRef,
    targetType,
    receivedAt,
    appliedAt,
    verificationRef: input.verificationRef ?? null,
    resultingState,
    exceptionRef: input.exceptionRef ?? null,
    rollbackRef: input.rollbackRef ?? null,
    correlationId,
    integrityHash,
    integrityAlgorithm,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

export interface AdoptionDecision {
  valid: boolean;
  received: boolean;
  applied: boolean;
  provesApplication: boolean;
  reasons: string[];
}

/**
 * Evaluate an adoption receipt. A receipt may be RECEIVED/VALIDATED without
 * ever being APPLIED.
 */
export function evaluateAdoption(input: { receipt: Record<string, any> | null }): AdoptionDecision {
  const receipt = input.receipt;
  const reasons: string[] = [];
  if (!receipt) return { valid: false, received: false, applied: false, provesApplication: false, reasons: ["NO_RECEIPT"] };

  const received = Boolean(receipt.receivedAt);
  const applied = Boolean(receipt.appliedAt);
  const state = receipt.resultingState;

  if (state === "RECEIVED" && !received) reasons.push("RECEIVED_WITHOUT_RECEIVED_AT");
  if (state === "APPLIED" && !applied) reasons.push("APPLIED_WITHOUT_APPLIED_AT");
  if (applied && !received) reasons.push("APPLIED_WITHOUT_RECEIVED");
  if (receipt.targetType && receipt.targetType !== FROZEN_TARGET_TYPE) {
    reasons.push("TARGET_TYPE_NOT_FROZEN");
  }

  return {
    valid: reasons.length === 0,
    received,
    applied,
    provesApplication: applied && state === "APPLIED",
    reasons: uniq(reasons),
  };
}

// ---------------------------------------------------------------------------
// 3. Rollback — explicit, history-preserving.
// ---------------------------------------------------------------------------
export function buildRollbackRecord(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const rollbackId = requireNonEmptyString(input.rollbackId, "rollbackId");
  const releaseId = requireNonEmptyString(input.releaseId, "releaseId");
  const releaseVersion = requireNonEmptyString(input.releaseVersion, "releaseVersion");
  const reason = requireNonEmptyString(input.reason, "reason");
  const reasonCategory = requireEnum(input.reasonCategory, ROLLBACK_REASON_CATEGORIES, "reasonCategory");
  const authority = requireNonEmptyString(input.authority, "authority");
  const authorityBasis = requireNonEmptyString(input.authorityBasis, "authorityBasis");
  const restoredState = requireNonEmptyString(input.restoredState, "restoredState");
  const correlationId = requireNonEmptyString(input.correlationId, "correlationId");
  const completionState = requireEnum(input.completionState ?? "INITIATED", ROLLBACK_STATES, "completionState");

  const affectedTargets = Array.isArray(input.affectedTargets)
    ? (input.affectedTargets as unknown[]).map((t) => requireNonEmptyString(t, "affectedTargets[]"))
    : [];
  if (affectedTargets.length === 0) {
    throw new ValidationError("NO_AFFECTED_TARGETS", "a rollback requires at least one affected target");
  }
  for (const t of affectedTargets) {
    if (!t.startsWith("SYNTH-")) {
      throw new ValidationError("PRODUCT_INTAKE_FROZEN", `affected target ${t} is not SYNTH-* (product intake frozen)`);
    }
  }

  return compact({
    tenantId,
    rollbackId,
    releaseId,
    releaseVersion,
    reason,
    reasonCategory,
    authority,
    authorityBasis,
    affectedTargets,
    restoredState,
    initiatedAt: typeof input.initiatedAt === "number" ? input.initiatedAt : 0,
    completedAt: input.completedAt ?? null,
    correlationId,
    distributionRef: input.distributionRef ?? null,
    receiptRefs: Array.isArray(input.receiptRefs) ? input.receiptRefs : null,
    verificationRequired: input.verificationRequired ?? null,
    completionState,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

export interface RollbackDecision {
  valid: boolean;
  preservesHistory: boolean;
  revertedReceiptCount: number;
  reasons: string[];
}

/**
 * Evaluate a rollback record. A rollback never deletes prior release/adoption
 * history; it records a reversion fact.
 */
export function evaluateRollback(input: {
  rollback: Record<string, any> | null;
  releases?: Array<Record<string, any>>;
  receipts?: Array<Record<string, any>>;
}): RollbackDecision {
  const { rollback, releases = [], receipts = [] } = input;
  const reasons: string[] = [];
  if (!rollback) return { valid: false, preservesHistory: true, revertedReceiptCount: 0, reasons: ["NO_ROLLBACK"] };

  const releaseById = new Map(releases.map((r) => [r.releaseId, r]));
  if (!releaseById.has(rollback.releaseId)) reasons.push("UNKNOWN_RELEASE");
  if (!rollback.reason || rollback.reason.length < 10) reasons.push("REASON_TOO_SHORT");
  if (!rollback.authority) reasons.push("MISSING_AUTHORITY");
  if (!Array.isArray(rollback.affectedTargets) || rollback.affectedTargets.length === 0) {
    reasons.push("NO_AFFECTED_TARGETS");
  }
  if (rollback.completedAt && !rollback.initiatedAt) reasons.push("COMPLETED_WITHOUT_INITIATED");

  const revertedReceipts = receipts.filter((r) => r.releaseId === rollback.releaseId);
  const historyPreserved = releaseById.has(rollback.releaseId) && revertedReceipts.length >= 0;

  return {
    valid: reasons.length === 0,
    preservesHistory: historyPreserved,
    revertedReceiptCount: revertedReceipts.length,
    reasons: uniq(reasons),
  };
}
