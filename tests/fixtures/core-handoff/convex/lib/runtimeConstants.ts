// FSTS Compliance Core — Compliance Runtime constants (Phase 5, Chat 2)
//
// Shared, closed vocabularies for the compliance runtime / verification /
// evidence / remediation persistence layer. Pure and dependency-free so the
// module loads in both the Convex V8 runtime and plain Node (type-stripping).
//
// FAIL-CLOSED: every vocabulary is a closed union. An unknown value is rejected
// at the boundary rather than silently accepted.
//
// HONESTY RULES (locked, carried from Phases 3–4):
//   * PASS is a verification RESULT, never a compliance conclusion.
//   * COMPLIANT / CERTIFIED / AUTHORIZED are NOT verification results and are
//     NOT readiness states. They are never produced by this layer.
//   * Unknown/uncertain applicability fails closed to NEEDS_REVIEW.
//   * Verification-generated evidence remains PROPOSED until the evidence
//     lifecycle lane accepts it. This layer never ACCEPTS evidence.

// ---------------------------------------------------------------------------
// Applicability (Phase 4 vocabulary, preserved exactly)
// ---------------------------------------------------------------------------
export const APPLICABILITY_STATUSES = [
  "APPLICABLE",
  "POTENTIALLY_APPLICABLE",
  "NOT_APPLICABLE",
  "FUTURE",
  "NEEDS_REVIEW",
] as const;
export type ApplicabilityStatus = (typeof APPLICABILITY_STATUSES)[number];

// The fail-closed default: anything unknown or uncertain is NEEDS_REVIEW.
export const APPLICABILITY_FAIL_CLOSED: ApplicabilityStatus = "NEEDS_REVIEW";

// ---------------------------------------------------------------------------
// Control activation (Phase 4 vocabulary, preserved exactly)
// ---------------------------------------------------------------------------
export const ACTIVATION_STATES = [
  "ACTIVE",
  "CONDITIONAL",
  "INACTIVE",
  "FUTURE",
  "NEEDS_REVIEW",
] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

// Activation is always fail-closed: an undetermined state is NEEDS_REVIEW and
// the control is treated as ACTIVE for safety (never silently inactive).
export const ACTIVATION_FAIL_CLOSED: ActivationState = "NEEDS_REVIEW";

// ---------------------------------------------------------------------------
// Verification kinds (Phase 4 policy-verification engine, preserved exactly)
// ---------------------------------------------------------------------------
export const VERIFICATION_KINDS = [
  "POLICY_RELEASE",
  "APPLICABILITY",
  "ADOPTION",
  "DRIFT",
  "HIGH_SECURITY_SYNTHETIC",
  "RETENTION_LEGAL_HOLD",
  "SAFE_MODE",
] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

// ---------------------------------------------------------------------------
// Bounded verification result vocabulary (shared Phase 3/4, preserved exactly)
// ---------------------------------------------------------------------------
// NOTE: COMPLIANT is deliberately absent. PASS != COMPLIANT.
export const RESULT_VOCABULARY = [
  "PASS",
  "FAIL",
  "PARTIAL",
  "NOT_APPLICABLE",
  "BLOCKED",
  "ERROR",
  "NEEDS_REVIEW",
  "MANUAL_REVIEW_REQUIRED",
  "EXTERNAL_VALIDATION_REQUIRED",
  "PENDING",
] as const;
export type VerificationResult = (typeof RESULT_VOCABULARY)[number];

// Results that are terminal (a completed execution must carry one of these).
export const TERMINAL_RESULTS = [
  "PASS",
  "FAIL",
  "PARTIAL",
  "NOT_APPLICABLE",
  "BLOCKED",
  "ERROR",
  "NEEDS_REVIEW",
  "MANUAL_REVIEW_REQUIRED",
  "EXTERNAL_VALIDATION_REQUIRED",
] as const;

// Results that can NEVER be produced without a real observation.
export const NEVER_PASS_WITHOUT_OBSERVATION = true;

// Tokens that must NEVER appear as a verification result or readiness state.
export const FORBIDDEN_CONCLUSION_TOKENS = [
  "COMPLIANT",
  "CERTIFIED",
  "AUTHORIZED",
  "ATTESTED",
] as const;

// ---------------------------------------------------------------------------
// Verification execution status (separate from the result outcome)
// ---------------------------------------------------------------------------
export const EXECUTION_STATUSES = ["IN_PROGRESS", "COMPLETED", "BLOCKED"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Evidence lifecycle (Phase 3 vocabulary, preserved exactly)
// ---------------------------------------------------------------------------
export const EVIDENCE_LIFECYCLE_STATES = [
  "EXPECTED",
  "REQUESTED",
  "COLLECTING",
  "COLLECTED",
  "VALIDATING",
  "VALID",
  "INVALID",
  "STALE",
  "EXPIRED",
  "SUPERSEDED",
  "REVOKED",
  "NOT_AVAILABLE",
] as const;
export type EvidenceLifecycleState = (typeof EVIDENCE_LIFECYCLE_STATES)[number];

// The ONLY state a verification-generated evidence candidate may carry.
export const EVIDENCE_PROPOSED_STATE = "PROPOSED" as const;

// Freshness outcomes (Phase 3 vocabulary, preserved exactly).
export const FRESHNESS_STATUSES = [
  "CURRENT",
  "AGING",
  "STALE",
  "EXPIRED",
  "NOT_APPLICABLE",
] as const;
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number];

// Evidence integrity validation outcomes.
export const EVIDENCE_INTEGRITY_STATUSES = [
  "UNVALIDATED",
  "VALID",
  "MISMATCH",
  "MISSING_REFERENCE",
] as const;
export type EvidenceIntegrityStatus = (typeof EVIDENCE_INTEGRITY_STATUSES)[number];

// Evidence review states (human gate; separate from machine validation).
export const EVIDENCE_REVIEW_STATES = [
  "NOT_REVIEWED",
  "IN_REVIEW",
  "ACCEPTED",
  "REJECTED",
  "NEEDS_RECOLLECTION",
] as const;
export type EvidenceReviewState = (typeof EVIDENCE_REVIEW_STATES)[number];

// ---------------------------------------------------------------------------
// Observations / findings (separate from external compliance conclusions)
// ---------------------------------------------------------------------------
export const OBSERVATION_SEVERITIES = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type ObservationSeverity = (typeof OBSERVATION_SEVERITIES)[number];

export const OBSERVATION_PRIORITIES = ["P1", "P2", "P3", "P4"] as const;
export type ObservationPriority = (typeof OBSERVATION_PRIORITIES)[number];

export const OBSERVATION_STATUSES = [
  "OPEN",
  "TRIAGED",
  "IN_REMEDIATION",
  "RESOLVED",
  "RISK_ACCEPTED",
  "CLOSED",
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Exceptions (Phase 3 vocabulary, preserved exactly)
// ---------------------------------------------------------------------------
export const EXCEPTION_STATUSES = [
  "REQUESTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
  "CLOSED",
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export const EXCEPTION_RISK_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type ExceptionRiskLevel = (typeof EXCEPTION_RISK_LEVELS)[number];

// ---------------------------------------------------------------------------
// Remediation (Phase 3 vocabulary, preserved exactly)
// ---------------------------------------------------------------------------
export const REMEDIATION_STATUSES = [
  "OPEN",
  "TRIAGED",
  "PLANNED",
  "IN_PROGRESS",
  "BLOCKED",
  "READY_FOR_VERIFICATION",
  "VERIFIED",
  "CLOSED",
  "RISK_ACCEPTED",
] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export const REMEDIATION_VERIFICATION_STATUSES = [
  "NOT_VERIFIED",
  "PENDING",
  "VERIFIED",
  "FAILED",
] as const;
export type RemediationVerificationStatus =
  (typeof REMEDIATION_VERIFICATION_STATUSES)[number];

export const REMEDIATION_ACTION_STATUSES = [
  "PLANNED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RemediationActionStatus = (typeof REMEDIATION_ACTION_STATUSES)[number];

// ---------------------------------------------------------------------------
// Readiness (internal only — NEVER an external certification)
// ---------------------------------------------------------------------------
// The ONLY readiness states this layer may persist. There is deliberately no
// CERTIFIED / AUTHORIZED / COMPLIANT state.
export const READINESS_STATES = [
  "ASSESSMENT_INCOMPLETE",
  "CONTROLS_IMPLEMENTED",
  "VERIFICATION_PASSED",
  "EVIDENCE_STALE",
  "REVIEW_REQUIRED",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

// ---------------------------------------------------------------------------
// Runtime drift (verification / evidence drift)
// ---------------------------------------------------------------------------
export const DRIFT_TYPES = ["VERIFICATION_DRIFT", "EVIDENCE_DRIFT"] as const;
export type DriftType = (typeof DRIFT_TYPES)[number];

export const DRIFT_OUTCOMES = [
  "NO_DRIFT",
  "DRIFT_DETECTED",
  "NEEDS_REVIEW",
  "INSUFFICIENT_DATA",
] as const;
export type DriftOutcome = (typeof DRIFT_OUTCOMES)[number];

export const DRIFT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "SUPERSEDED"] as const;
export type DriftStatus = (typeof DRIFT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Record status (EXAMPLE vs REAL — carried from Phases 3–4)
// ---------------------------------------------------------------------------
export const RECORD_STATUSES = ["EXAMPLE", "REAL"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

// ---------------------------------------------------------------------------
// Idempotency scopes owned by this lane (subset of Chat 1's IDEMPOTENCY_SCOPES)
// ---------------------------------------------------------------------------
export const RUNTIME_IDEMPOTENCY_SCOPES = [
  "verification-submission",
  "evidence-receipt",
] as const;

// ---------------------------------------------------------------------------
// Engine identity (Phase 4 policy-verification engine, preserved)
// ---------------------------------------------------------------------------
export const RUNTIME_ENGINE_NAME = "fsts-compliance-runtime";
export const RUNTIME_ENGINE_VERSION = "1.0.0";
