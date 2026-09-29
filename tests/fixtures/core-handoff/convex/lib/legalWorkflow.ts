// FSTS Compliance Core — legal change workflow primitives (Phase 5, Chat 4)
//
// Pure, dependency-free, fail-closed. Models the governed change-detection
// workflow:
//
//   OFFICIAL SOURCE CHECK -> CHANGE CANDIDATE -> CLASSIFICATION ->
//   LEGAL/HUMAN REVIEW -> ACCEPT/REJECT/NEEDS_REVIEW ->
//   GOVERNED CANONICAL UPDATE -> APPLICABILITY REVIEW -> POLICY REVIEW ->
//   APPROVAL -> SIGNED RELEASE -> PRODUCT ADOPTION
//
// HARD RULES:
//   * A detected change is NEVER auto-applied. It becomes a candidate that must
//     pass classification and a legal/human review before any canonical update.
//   * A candidate may only reach ACCEPTED when a resolved review with decision
//     ACCEPT exists. There is no path from DETECTED straight to ACCEPTED.
//   * Enforcement, control, and product behavior are NEVER auto-changed by this
//     workflow. The workflow only produces a governed handoff.
//   * Counsel review, when required, gates an ACCEPT decision.

import {
  ValidationError,
  requireNonEmptyString,
  requireEnum,
  compact,
} from "./validation.ts";

// ---------------------------------------------------------------------------
// Closed enums (mirror convex/schema.ts)
// ---------------------------------------------------------------------------
export const LEGAL_CHANGE_CLASSIFICATIONS = [
  "NO_CHANGE",
  "EDITORIAL",
  "SUBSTANTIVE",
  "STATUS_CHANGE",
  "EFFECTIVE_DATE_CHANGE",
  "SUPERSESSION",
  "REPEAL",
  "INJUNCTION",
  "UNKNOWN",
] as const;

export const LEGAL_CHANGE_CANDIDATE_STATUSES = [
  "DETECTED",
  "CLASSIFIED",
  "IN_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "NEEDS_REVIEW",
  "SUPERSEDED",
] as const;

export const LEGAL_REVIEW_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "ESCALATED"] as const;

export const LEGAL_REVIEW_DECISIONS = [
  "ACCEPT",
  "REJECT",
  "NEEDS_REVIEW",
  "COUNSEL_REVIEW_REQUIRED",
] as const;

// ---------------------------------------------------------------------------
// Candidate state machine
// ---------------------------------------------------------------------------
// Allowed transitions. A candidate can never jump from DETECTED to ACCEPTED.
const CANDIDATE_TRANSITIONS: Record<string, string[]> = {
  DETECTED: ["CLASSIFIED", "NEEDS_REVIEW", "SUPERSEDED"],
  CLASSIFIED: ["IN_REVIEW", "NEEDS_REVIEW", "SUPERSEDED"],
  IN_REVIEW: ["ACCEPTED", "REJECTED", "NEEDS_REVIEW", "SUPERSEDED"],
  NEEDS_REVIEW: ["CLASSIFIED", "IN_REVIEW", "REJECTED", "SUPERSEDED"],
  ACCEPTED: ["SUPERSEDED"],
  REJECTED: ["SUPERSEDED"],
  SUPERSEDED: [],
};

export function assertValidCandidateTransition(from: unknown, to: unknown): void {
  const f = requireEnum(from, LEGAL_CHANGE_CANDIDATE_STATUSES, "from");
  const t = requireEnum(to, LEGAL_CHANGE_CANDIDATE_STATUSES, "to");
  const allowed = CANDIDATE_TRANSITIONS[f] ?? [];
  if (!allowed.includes(t)) {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `illegal change-candidate transition ${f} -> ${t}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Review state machine
// ---------------------------------------------------------------------------
const REVIEW_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED", "ESCALATED"],
  IN_PROGRESS: ["RESOLVED", "ESCALATED"],
  ESCALATED: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: [],
};

export function assertValidReviewTransition(from: unknown, to: unknown): void {
  const f = requireEnum(from, LEGAL_REVIEW_STATUSES, "from");
  const t = requireEnum(to, LEGAL_REVIEW_STATUSES, "to");
  const allowed = REVIEW_TRANSITIONS[f] ?? [];
  if (!allowed.includes(t)) {
    throw new ValidationError("LEGAL_INVARIANT", `illegal review transition ${f} -> ${t}`);
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
export function buildLegalChangeCandidate(input: Record<string, unknown>): Record<string, unknown> {
  const classification = requireEnum(
    input.classification ?? "UNKNOWN",
    LEGAL_CHANGE_CLASSIFICATIONS,
    "classification",
  );
  const status = requireEnum(input.status ?? "DETECTED", LEGAL_CHANGE_CANDIDATE_STATUSES, "status");
  // A candidate may only be ACCEPTED via a resolved ACCEPT review (checked at
  // the function boundary). At build time, ACCEPTED is never the initial state.
  if (status === "ACCEPTED") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      "a change candidate is never created ACCEPTED; acceptance requires a resolved review",
    );
  }
  // A classified candidate must carry a real classification (not UNKNOWN).
  if (status === "CLASSIFIED" && classification === "UNKNOWN") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      "a CLASSIFIED candidate must carry a resolved classification",
    );
  }
  return compact({
    candidateId: requireNonEmptyString(input.candidateId, "candidateId"),
    sourceId: requireNonEmptyString(input.sourceId, "sourceId"),
    jurisdictionId: requireNonEmptyString(input.jurisdictionId, "jurisdictionId"),
    detectedAt: typeof input.detectedAt === "number" ? input.detectedAt : 0,
    detectedBy: requireNonEmptyString(input.detectedBy, "detectedBy"),
    monitoringRunId: input.monitoringRunId ?? null,
    checkId: input.checkId ?? null,
    snapshotId: input.snapshotId ?? null,
    classification,
    status,
    previousHash: input.previousHash ?? null,
    observedHash: input.observedHash ?? null,
    summary: input.summary ?? null,
    evidenceRef: input.evidenceRef ?? null,
  });
}

export function buildLegalChangeReview(input: Record<string, unknown>): Record<string, unknown> {
  const status = requireEnum(input.status ?? "OPEN", LEGAL_REVIEW_STATUSES, "status");
  const decision =
    input.decision === undefined || input.decision === null
      ? null
      : requireEnum(input.decision, LEGAL_REVIEW_DECISIONS, "decision");
  const counselReviewRequired = input.counselReviewRequired === true;

  // A RESOLVED review must carry a decision; an unresolved review must not.
  if (status === "RESOLVED" && decision === null) {
    throw new ValidationError("LEGAL_INVARIANT", "a RESOLVED review must carry a decision");
  }
  if (status !== "RESOLVED" && decision !== null) {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `a ${status} review must not carry a decision`,
    );
  }
  // Counsel gate: when counsel review is required, an ACCEPT decision is not
  // permitted — the reviewer must escalate to counsel.
  if (counselReviewRequired && decision === "ACCEPT") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      "counselReviewRequired reviews must not ACCEPT; escalate to counsel",
    );
  }
  return compact({
    reviewId: requireNonEmptyString(input.reviewId, "reviewId"),
    candidateId: requireNonEmptyString(input.candidateId, "candidateId"),
    sourceId: requireNonEmptyString(input.sourceId, "sourceId"),
    status,
    decision,
    reviewerPrincipalId: input.reviewerPrincipalId ?? null,
    counselReviewRequired,
    rationale: input.rationale ?? null,
    resultingLegalStatus: input.resultingLegalStatus ?? null,
    resultingEffectiveDate: input.resultingEffectiveDate ?? null,
    openedAt: typeof input.openedAt === "number" ? input.openedAt : 0,
    resolvedAt: typeof input.resolvedAt === "number" ? input.resolvedAt : null,
  });
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
// A candidate may only be ACCEPTED when a resolved review with decision ACCEPT
// exists for it. This is the anti-auto-apply gate.
export function assertAcceptRequiresReview(
  candidate: { candidateId?: unknown; status?: unknown },
  reviews: Array<{ candidateId?: unknown; status?: unknown; decision?: unknown }>,
): void {
  if (candidate?.status !== "ACCEPTED") return;
  const ok = (reviews || []).some(
    (r) =>
      r &&
      r.candidateId === candidate.candidateId &&
      r.status === "RESOLVED" &&
      r.decision === "ACCEPT",
  );
  if (!ok) {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      "a candidate may only be ACCEPTED with a resolved ACCEPT review (never auto-applied)",
    );
  }
}

// The workflow never auto-changes enforcement/control/product behavior. A
// candidate/review must not carry any enforcement or product mutation field.
export function assertNoAutoApply(record: Record<string, unknown>): void {
  const forbidden = [
    "autoApply",
    "autoChangeEnforcement",
    "enforcementChange",
    "controlActivation",
    "productBehaviorChange",
    "canonicalRewrite",
  ];
  for (const key of forbidden) {
    if (record && key in record) {
      throw new ValidationError(
        "LEGAL_INVARIANT",
        `change workflow must not carry ${key} (never auto-change enforcement/control/product behavior)`,
      );
    }
  }
}
