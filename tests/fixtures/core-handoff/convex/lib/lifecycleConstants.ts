// FSTS Compliance Core — policy release / distribution / adoption service
// vocabulary (Phase 6, Chat 3).
//
// This module is the TypeScript-side single source of truth for the governed
// service/API layer that persists and queries the policy release lifecycle. It
// mirrors — and never redefines — the Phase 5 (Chat 3) operational vocabulary in
// packages/policy-lifecycle/src/constants.mjs and the accepted Phase 4 lifecycle
// semantics. Tenancy, products, service identities, authorization, audit, and
// idempotency are OWNED BY CHAT 1 and are consumed here, never recreated.
//
// Locked lifecycle (never reordered, never short-circuited):
//   APPLICABILITY → CONTROL ACTIVATION → POLICY PACK → APPROVAL → SIGNED RELEASE
//   → DISTRIBUTION → PRODUCT ADOPTION → VERIFICATION → EVIDENCE → ASSESSMENT
//   → DRIFT / EXCEPTION / ROLLBACK
//
// Hard invariants encoded here (never weakened):
//   APPROVED != RELEASED
//   RELEASED != ADOPTED
//   RECEIVED != APPLIED
//   PASS != COMPLIANT

// The frozen deterministic reference date for this lane. No service function
// derives a temporal decision from the wall clock; expiry is evaluated against
// an explicit reference date.
export const REFERENCE_DATE = "2026-09-15";

// Master pack/release lifecycle (accepted Phase 4 vocabulary — unchanged).
export const LIFECYCLE_STATES = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "RELEASED",
  "ADOPTING",
  "ADOPTED",
  "SUPERSEDED",
  "WITHDRAWN",
  "ROLLED_BACK",
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

// Pre-approval states: activation fields must be null.
export const PRE_APPROVAL_STATES = ["DRAFT", "REVIEW"] as const;

// Issued states (released or later).
export const ISSUED_STATES = [
  "RELEASED",
  "ADOPTING",
  "ADOPTED",
  "SUPERSEDED",
  "ROLLED_BACK",
] as const;

// Terminal-but-immutable states. History is never deleted.
export const TERMINAL_STATES = ["SUPERSEDED", "WITHDRAWN", "ROLLED_BACK"] as const;

// Approval decisions (accepted Phase 4 vocabulary — unchanged).
export const APPROVAL_DECISIONS = [
  "APPROVED",
  "REJECTED",
  "APPROVED_WITH_CONDITIONS",
] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

// Decisions that authorize a release. REJECTED never does.
export const RELEASE_AUTHORIZING_DECISIONS = [
  "APPROVED",
  "APPROVED_WITH_CONDITIONS",
] as const;

// Distribution delivery state machine. Delivery is NOT adoption:
// DELIVERED/ACKNOWLEDGED prove only that bytes arrived, never that policy was
// applied.
export const DISTRIBUTION_STATES = [
  "PENDING",
  "DELIVERING",
  "DELIVERED",
  "ACKNOWLEDGED",
  "FAILED",
  "RETRYING",
  "CANCELLED",
] as const;
export type DistributionState = (typeof DISTRIBUTION_STATES)[number];

export const DISTRIBUTION_DELIVERED_STATES = ["DELIVERED", "ACKNOWLEDGED"] as const;
export const DISTRIBUTION_TERMINAL_STATES = ["ACKNOWLEDGED", "CANCELLED"] as const;

// Adoption state machine. RECEIVED != APPLIED is structural: a receipt may be
// RECEIVED/VALIDATED without ever being APPLIED.
export const ADOPTION_STATES = [
  "RECEIVED",
  "VALIDATED",
  "APPLIED",
  "REJECTED",
  "ROLLED_BACK",
  "SUPERSEDED",
] as const;
export type AdoptionState = (typeof ADOPTION_STATES)[number];

export const ADOPTION_APPLIED_STATES = ["APPLIED"] as const;
export const ADOPTION_TERMINAL_STATES = ["REJECTED", "ROLLED_BACK", "SUPERSEDED"] as const;

// The five drift categories. NEVER collapsed into one generic NONCOMPLIANT
// state. SOURCE_CHANGE requires review and never auto-rewrites policy.
export const DRIFT_KINDS = [
  "SOURCE_CHANGE",
  "POLICY_CHANGE",
  "IMPLEMENTATION_DRIFT",
  "EVIDENCE_STALENESS",
  "ADOPTION_DRIFT",
] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

export const DRIFT_DISPOSITIONS = [
  "OPEN",
  "UNDER_REVIEW",
  "ACCEPTED_RISK",
  "REMEDIATION_REQUIRED",
  "POLICY_REVIEW_TRIGGERED",
  "NO_ACTION",
  "RESOLVED",
] as const;
export type DriftDisposition = (typeof DRIFT_DISPOSITIONS)[number];

// Dispositions permitted for a SOURCE_CHANGE. A source change may only trigger
// review — never an automatic activation or rewrite.
export const SOURCE_CHANGE_ALLOWED_DISPOSITIONS = [
  "OPEN",
  "UNDER_REVIEW",
  "POLICY_REVIEW_TRIGGERED",
] as const;

// Rollback lifecycle state.
export const ROLLBACK_STATES = ["INITIATED", "IN_PROGRESS", "COMPLETED", "FAILED"] as const;
export type RollbackState = (typeof ROLLBACK_STATES)[number];

export const ROLLBACK_REASON_CATEGORIES = [
  "DEFECT",
  "POLICY_ERROR",
  "REGULATORY_CHANGE",
  "SECURITY_INCIDENT",
  "ADOPTION_FAILURE",
  "SUPERSEDED_BY_NEWER",
  "AUTHORITY_DIRECTIVE",
] as const;

// QUALIVANTA bridge handoff state (accepted Phase 4 vocabulary — unchanged).
export const HANDOFF_STATES = [
  "PREPARED",
  "SENT",
  "ACKNOWLEDGED",
  "ACCEPTED_FOR_REVIEW",
  "REJECTED",
  "CLOSED",
] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

// Provider-neutral verification results. PASS is a verification outcome only —
// never a compliance state.
export const VERIFICATION_RESULTS = [
  "PASS",
  "FAIL",
  "ERROR",
  "PENDING",
  "BLOCKED",
  "NOT_APPLICABLE",
] as const;

// Retention / legal-hold lifecycle state. An ACTIVE legal hold blocks ordinary
// deletion. A 50-day ARMA baseline is NOT a universal deletion policy;
// conflicting/uncertain requirements fail closed to NEEDS_REVIEW.
export const RETENTION_HOLD_STATES = [
  "ACTIVE",
  "RELEASED",
  "EXPIRED",
  "NEEDS_REVIEW",
] as const;
export type RetentionHoldState = (typeof RETENTION_HOLD_STATES)[number];

export const RETENTION_CLASSES = [
  "REGULATORY_MINIMUM",
  "CONTRACTUAL",
  "OPERATIONAL",
  "LEGAL_HOLD",
  "INDEFINITE",
] as const;

// Fail-closed release rejection reasons. A release that fails any of these is
// never eligible for distribution or adoption.
export const RELEASE_FAIL_CLOSED_REASONS = [
  "UNSIGNED_RELEASE",
  "SIGNATURE_HASH_MISMATCH",
  "UNAPPROVED_RELEASE",
  "EXPIRED_RELEASE",
  "WITHDRAWN_RELEASE",
  "UNKNOWN_RELEASE",
] as const;
export type ReleaseFailClosedReason = (typeof RELEASE_FAIL_CLOSED_REASONS)[number];

// Provider-neutral projection kinds. The projection is NOT the authority;
// authoritative records remain in Compliance Core.
export const PROJECTION_KINDS = [
  "TENANT_OVERVIEW",
  "PRODUCT_OVERVIEW",
  "FRAMEWORK_CONTROL_COVERAGE",
  "APPLICABILITY_SUMMARY",
  "VERIFICATION_SUMMARY",
  "EVIDENCE_FRESHNESS",
  "EXCEPTIONS_REMEDIATION",
  "POLICY_RELEASE",
  "PRODUCT_ADOPTION",
  "DRIFT",
  "LEGAL_CHANGE_STATUS",
  "EXTERNAL_ASSURANCE_STATUS",
] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

// The compliance claim is structurally pinned to NONE everywhere in this lane.
export const COMPLIANCE_CLAIM = "NONE" as const;

// Evidence candidates produced by verification are structurally pinned to
// PROPOSED. Chat 3 remains authoritative for evidence lifecycle/adjudication.
export const EVIDENCE_CANDIDATE_STATE = "PROPOSED" as const;

// Target types permitted while product intake is frozen.
export const TARGET_TYPES = ["PRODUCT", "TENANT", "ENVIRONMENT", "SYNTHETIC_TARGET"] as const;

// The only target type permitted while product intake is frozen.
export const FROZEN_TARGET_TYPE = "SYNTHETIC_TARGET" as const;

// Record status separation (EXAMPLE vs REAL).
export const RECORD_STATUSES = ["EXAMPLE", "REAL"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

// Convex table names owned by the Phase 5/6 Chat 3 lane. These are the ONLY
// tables this lane defines. Tenancy, products, service identities,
// authorization, audit, and idempotency are owned by Chat 1 and are referenced
// (never redefined) here.
export const CONVEX_TABLES = [
  "policyPackRuntime",
  "policyApprovals",
  "signedReleases",
  "releaseDistributions",
  "adoptionReceipts",
  "rollbackRecords",
  "driftRecords",
  "qualivantaHandoffs",
  "retentionHolds",
] as const;

// Chat 1-owned tables this lane REFERENCES but never defines.
export const CHAT1_REFERENCED_TABLES = [
  "tenants",
  "products",
  "serviceIdentities",
  "auditEvents",
  "idempotencyRecords",
] as const;

// Idempotency scopes owned by this lane (subset of Chat 1's IDEMPOTENCY_SCOPES).
// Every applicable write in convex/lifecycle.ts uses one of these.
export const LIFECYCLE_IDEMPOTENCY_SCOPES = [
  "policy-distribution",
  "adoption-receipt",
  "qualivanta-handoff",
] as const;
export type LifecycleIdempotencyScope = (typeof LIFECYCLE_IDEMPOTENCY_SCOPES)[number];

// Authorization actions consumed by the Phase 6 service layer. These are
// ADDITIVE to Chat 1's authorization engine (convex/lib/authorization.ts) and
// are granted to roles there. This lane never builds a competing engine.
export const LIFECYCLE_ACTIONS = [
  "lifecycle:read",
  "lifecycle:write",
  "lifecycle:approve",
  "lifecycle:release",
  "lifecycle:distribute",
  "lifecycle:adopt",
  "lifecycle:rollback",
  "lifecycle:hold",
] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

// The governed service/API surface: every operation exposed by
// convex/lifecycle.ts. Declared here so the boundary is machine-checkable.
export const LIFECYCLE_SERVICE_OPERATIONS = [
  "recordPolicyPackRuntime",
  "recordPolicyApproval",
  "recordSignedRelease",
  "distributeRelease",
  "acknowledgeDelivery",
  "recordAdoptionReceipt",
  "recordAdoptionState",
  "recordRollback",
  "recordDrift",
  "disposeDrift",
  "prepareQualivantaHandoff",
  "transitionHandoff",
  "placeRetentionHold",
  "releaseRetentionHold",
  "assertDeletionAllowed",
  "getPolicyReleaseProjection",
] as const;

// ---------------------------------------------------------------------------
// Governed API mapping (Phase 6 post-merge convergence)
// ---------------------------------------------------------------------------
// Governed-pipeline action -> lifecycle service operation. The governed
// lifecycle entrypoint (convex/lifecycleApi.ts) resolves a Chat 1 governed
// pipeline action to the exact lifecycle operation, so external/service
// invocation runs through the authoritative Phase 6 governed boundary
// (identity, tenancy, correlation, integrity, freshness, nonce replay, contract
// resolution, authorization, environment, rate limit, idempotency, audit)
// BEFORE dispatch. No competing auth/authz/tenancy/replay/audit/rate-limit
// foundation is created.
export const LIFECYCLE_GOVERNED_ACTIONS: Record<string, string> = {
  "lifecycle.pack.record": "recordPolicyPackRuntime",
  "lifecycle.approval.record": "recordPolicyApproval",
  "lifecycle.release.record": "recordSignedRelease",
  "lifecycle.distribution.deliver": "distributeRelease",
  "lifecycle.distribution.acknowledge": "acknowledgeDelivery",
  "lifecycle.adoption.receipt": "recordAdoptionReceipt",
  "lifecycle.adoption.state": "recordAdoptionState",
  "lifecycle.rollback.record": "recordRollback",
  "lifecycle.drift.record": "recordDrift",
  "lifecycle.drift.dispose": "disposeDrift",
  "lifecycle.handoff.prepare": "prepareQualivantaHandoff",
  "lifecycle.handoff.transition": "transitionHandoff",
  "lifecycle.hold.place": "placeRetentionHold",
  "lifecycle.hold.release": "releaseRetentionHold",
  "lifecycle.deletion.check": "assertDeletionAllowed",
  "lifecycle.projection.get": "getPolicyReleaseProjection",
};

// The Chat 1 RBAC action each governed lifecycle operation requires. The
// governed pipeline resolves the contract's requiredScope to this action; the
// lifecycle handler re-enforces it server-side (defense in depth).
export const LIFECYCLE_OPERATION_REQUIRED_ACTION: Record<string, string> = {
  recordPolicyPackRuntime: "lifecycle:write",
  recordPolicyApproval: "lifecycle:approve",
  recordSignedRelease: "lifecycle:release",
  distributeRelease: "lifecycle:distribute",
  acknowledgeDelivery: "lifecycle:distribute",
  recordAdoptionReceipt: "lifecycle:adopt",
  recordAdoptionState: "lifecycle:adopt",
  recordRollback: "lifecycle:rollback",
  recordDrift: "lifecycle:write",
  disposeDrift: "lifecycle:write",
  prepareQualivantaHandoff: "lifecycle:write",
  transitionHandoff: "lifecycle:write",
  placeRetentionHold: "lifecycle:hold",
  releaseRetentionHold: "lifecycle:hold",
  assertDeletionAllowed: "lifecycle:read",
  getPolicyReleaseProjection: "lifecycle:read",
};

// The two lifecycle operations that are READ-only (never write authoritative
// state). Used by the governed entrypoint to route to a read-only path.
export const LIFECYCLE_READ_OPERATIONS = [
  "assertDeletionAllowed",
  "getPolicyReleaseProjection",
] as const;
