// FSTS Compliance Core — lifecycle governance builders (Phase 6, Chat 3).
//
// Pure, deterministic, fail-closed builders + evaluators for the governance
// surface of the locked lifecycle: DRIFT / EXCEPTION / ROLLBACK, QUALIVANTA
// handoffs, retention / legal holds, and provider-neutral projections.
//
// Hard invariants enforced here (never weakened):
//   PASS != COMPLIANT          — a verification PASS is never a compliance state.
//   SOURCE_CHANGE → REVIEW ONLY — a source change never auto-rewrites policy.
//   ACTIVE legal hold blocks ordinary deletion.
//   QUALIVANTA handoff is provider-neutral (no shared database).
//   The projection is NOT the authority; complianceClaim is pinned NONE.

import {
  ValidationError,
  requireNonEmptyString,
  requireEnum,
  compact,
} from "./validation.ts";
import {
  DRIFT_KINDS,
  DRIFT_DISPOSITIONS,
  SOURCE_CHANGE_ALLOWED_DISPOSITIONS,
  HANDOFF_STATES,
  RETENTION_HOLD_STATES,
  RETENTION_CLASSES,
  PROJECTION_KINDS,
  COMPLIANCE_CLAIM,
  EVIDENCE_CANDIDATE_STATE,
  FROZEN_TARGET_TYPE,
  REFERENCE_DATE,
} from "./lifecycleConstants.ts";
import { isExpired } from "./policyRelease.ts";

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// 1. Drift — five distinct categories. SOURCE_CHANGE is review-only.
// ---------------------------------------------------------------------------
export function buildDriftRecord(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const driftId = requireNonEmptyString(input.driftId, "driftId");
  const driftKind = requireEnum(input.driftKind, DRIFT_KINDS, "driftKind");
  const subjectRef = requireNonEmptyString(input.subjectRef, "subjectRef");
  const expectedState = requireNonEmptyString(input.expectedState, "expectedState");
  const observedState = requireNonEmptyString(input.observedState, "observedState");
  const severity = requireNonEmptyString(input.severity, "severity");
  const disposition = requireEnum(input.disposition ?? "OPEN", DRIFT_DISPOSITIONS, "disposition");
  const correlationId = requireNonEmptyString(input.correlationId, "correlationId");
  const referenceDate = requireNonEmptyString(input.referenceDate ?? REFERENCE_DATE, "referenceDate");

  // SOURCE_CHANGE may only carry a review disposition — never an automatic
  // activation or rewrite.
  if (
    driftKind === "SOURCE_CHANGE" &&
    !(SOURCE_CHANGE_ALLOWED_DISPOSITIONS as readonly string[]).includes(disposition)
  ) {
    throw new ValidationError(
      "SOURCE_CHANGE_MUST_BE_REVIEW_ONLY",
      `SOURCE_CHANGE disposition ${disposition} must be one of ${SOURCE_CHANGE_ALLOWED_DISPOSITIONS.join(", ")}`,
    );
  }

  // A disposition other than OPEN requires an authority + timestamp.
  const dispositionAuthority = input.dispositionAuthority ?? null;
  const dispositionAt = typeof input.dispositionAt === "number" ? input.dispositionAt : null;
  if (disposition !== "OPEN") {
    if (!dispositionAuthority) {
      throw new ValidationError("DISPOSITION_WITHOUT_AUTHORITY", "a non-OPEN disposition requires an authority");
    }
    if (dispositionAt === null) {
      throw new ValidationError("DISPOSITION_WITHOUT_TIMESTAMP", "a non-OPEN disposition requires a timestamp");
    }
  }

  return compact({
    tenantId,
    driftId,
    driftKind,
    detectedAt: typeof input.detectedAt === "number" ? input.detectedAt : 0,
    referenceDate,
    subjectRef,
    expectedState,
    observedState,
    severity,
    disposition,
    dispositionAuthority,
    dispositionAt,
    linkedRefs: Array.isArray(input.linkedRefs) ? input.linkedRefs : [],
    correlationId,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

export interface DriftDecision {
  valid: boolean;
  kind: string | null;
  autoRewritesPolicy: false;
  requiresReview: boolean;
  reasons: string[];
}

/**
 * Classify/validate a drift record. The five kinds are never collapsed. A
 * SOURCE_CHANGE may only carry a review disposition.
 */
export function classifyDrift(input: { drift: Record<string, any> | null }): DriftDecision {
  const drift = input.drift;
  const reasons: string[] = [];
  if (!drift) return { valid: false, kind: null, autoRewritesPolicy: false, requiresReview: false, reasons: ["NO_DRIFT"] };

  if (!(DRIFT_KINDS as readonly string[]).includes(drift.driftKind)) {
    reasons.push("UNKNOWN_DRIFT_KIND");
  }
  if (drift.driftKind === "SOURCE_CHANGE") {
    if (!(SOURCE_CHANGE_ALLOWED_DISPOSITIONS as readonly string[]).includes(drift.disposition)) {
      reasons.push("SOURCE_CHANGE_MUST_BE_REVIEW_ONLY");
    }
  }
  if (drift.disposition && drift.disposition !== "OPEN") {
    if (!drift.dispositionAuthority) reasons.push("DISPOSITION_WITHOUT_AUTHORITY");
    if (!drift.dispositionAt) reasons.push("DISPOSITION_WITHOUT_TIMESTAMP");
  }

  return {
    valid: reasons.length === 0,
    kind: drift.driftKind ?? null,
    autoRewritesPolicy: false,
    requiresReview: drift.driftKind === "SOURCE_CHANGE",
    reasons: uniq(reasons),
  };
}

// ---------------------------------------------------------------------------
// 2. QUALIVANTA handoff — provider-neutral, isolated.
// ---------------------------------------------------------------------------
export function buildQualivantaHandoff(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const handoffId = requireNonEmptyString(input.handoffId, "handoffId");
  const handoffState = requireEnum(input.handoffState ?? "PREPARED", HANDOFF_STATES, "handoffState");
  const releaseId = requireNonEmptyString(input.releaseId, "releaseId");
  const packId = requireNonEmptyString(input.packId, "packId");
  const packVersion = requireNonEmptyString(input.packVersion, "packVersion");
  const targetRef = requireNonEmptyString(input.targetRef, "targetRef");
  const targetType = requireNonEmptyString(input.targetType, "targetType");
  const correlationId = requireNonEmptyString(input.correlationId, "correlationId");
  const integrityHash = requireNonEmptyString(input.integrityHash, "integrityHash");
  const integrityAlgorithm = requireNonEmptyString(input.integrityAlgorithm, "integrityAlgorithm");

  // Product intake frozen.
  if (targetType !== FROZEN_TARGET_TYPE) {
    throw new ValidationError("PRODUCT_INTAKE_FROZEN", `targetType ${targetType} is not ${FROZEN_TARGET_TYPE}`);
  }
  if (!targetRef.startsWith("SYNTH-")) {
    throw new ValidationError("PRODUCT_INTAKE_FROZEN", `targetRef ${targetRef} is not SYNTH-*`);
  }

  // No shared database: raw QA evidence payloads are never carried.
  if (input.rawEvidencePayload !== undefined) {
    throw new ValidationError("RAW_EVIDENCE_PAYLOAD_FORBIDDEN", "handoffs carry references + digests only");
  }

  // Evidence references stay PROPOSED — the bridge never promotes evidence.
  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? (input.evidenceRefs as Array<Record<string, unknown>>).map((e) => {
        const state = e.evidenceCandidateState ?? EVIDENCE_CANDIDATE_STATE;
        if (state !== EVIDENCE_CANDIDATE_STATE) {
          throw new ValidationError("EVIDENCE_REF_PROMOTED", "handoff evidence refs must remain PROPOSED");
        }
        return compact({
          evidenceId: requireNonEmptyString(e.evidenceId, "evidenceRefs[].evidenceId"),
          evidenceCandidateState: EVIDENCE_CANDIDATE_STATE,
          artifactDigest: e.artifactDigest ?? null,
        });
      })
    : [];

  return compact({
    tenantId,
    handoffId,
    handoffState,
    releaseId,
    packId,
    packVersion,
    controlIds: Array.isArray(input.controlIds) ? input.controlIds : [],
    verificationRefs: Array.isArray(input.verificationRefs) ? input.verificationRefs : [],
    evidenceRefs,
    assuranceResultRefs: Array.isArray(input.assuranceResultRefs) ? input.assuranceResultRefs : [],
    targetRef,
    targetType,
    correlationId,
    preparedAt: typeof input.preparedAt === "number" ? input.preparedAt : 0,
    sentAt: input.sentAt ?? null,
    acknowledgedAt: input.acknowledgedAt ?? null,
    // Structurally pinned: the bridge never asserts compliance.
    complianceClaim: COMPLIANCE_CLAIM,
    evidenceHandoffState: EVIDENCE_CANDIDATE_STATE,
    integrityHash,
    integrityAlgorithm,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

export interface HandoffDecision {
  valid: boolean;
  isolated: true;
  promotesCompliance: false;
  reasons: string[];
}

/**
 * Validate a QUALIVANTA handoff. complianceClaim is pinned NONE and
 * evidenceHandoffState is pinned PROPOSED. No shared database; references only.
 */
export function evaluateHandoff(input: { handoff: Record<string, any> | null }): HandoffDecision {
  const handoff = input.handoff;
  const reasons: string[] = [];
  if (!handoff) return { valid: false, isolated: true, promotesCompliance: false, reasons: ["NO_HANDOFF"] };

  if (!(HANDOFF_STATES as readonly string[]).includes(handoff.handoffState)) reasons.push("UNKNOWN_HANDOFF_STATE");
  if (handoff.complianceClaim !== COMPLIANCE_CLAIM) reasons.push("COMPLIANCE_CLAIM_NOT_NONE");
  if (handoff.evidenceHandoffState !== EVIDENCE_CANDIDATE_STATE) reasons.push("EVIDENCE_STATE_NOT_PROPOSED");
  for (const e of handoff.evidenceRefs ?? []) {
    if (e.evidenceCandidateState !== EVIDENCE_CANDIDATE_STATE) reasons.push("EVIDENCE_REF_PROMOTED");
  }
  if (handoff.rawEvidencePayload !== undefined) reasons.push("RAW_EVIDENCE_PAYLOAD_PRESENT");

  return { valid: reasons.length === 0, isolated: true, promotesCompliance: false, reasons: uniq(reasons) };
}

// ---------------------------------------------------------------------------
// 3. Retention / legal hold — active hold blocks ordinary deletion.
// ---------------------------------------------------------------------------
export function buildRetentionHold(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const holdId = requireNonEmptyString(input.holdId, "holdId");
  const subjectRef = requireNonEmptyString(input.subjectRef, "subjectRef");
  const retentionClass = requireEnum(input.retentionClass, RETENTION_CLASSES, "retentionClass");
  const holdState = requireEnum(input.holdState ?? "ACTIVE", RETENTION_HOLD_STATES, "holdState");
  const basis = requireNonEmptyString(input.basis, "basis");
  const authority = requireNonEmptyString(input.authority, "authority");
  const correlationId = requireNonEmptyString(input.correlationId, "correlationId");

  // An ACTIVE or NEEDS_REVIEW hold blocks ordinary deletion.
  const blockingStates = ["ACTIVE", "NEEDS_REVIEW"];
  const deletionBlocked = blockingStates.includes(holdState);

  return compact({
    tenantId,
    holdId,
    subjectRef,
    retentionClass,
    holdState,
    basis,
    authority,
    placedAt: typeof input.placedAt === "number" ? input.placedAt : 0,
    releasedAt: input.releasedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    deletionBlocked,
    correlationId,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

export interface LegalHoldDecision {
  blocked: boolean;
  state: string | null;
  universalDeletionPolicy: false;
  reasons: string[];
}

/**
 * Decide whether an ordinary deletion is blocked by a legal hold. An ACTIVE
 * hold blocks deletion. Conflicting/uncertain requirements fail closed to
 * NEEDS_REVIEW (which also blocks deletion).
 */
export function evaluateLegalHold(input: {
  hold: Record<string, any> | null;
  operation?: string;
}): LegalHoldDecision {
  const { hold, operation = "DELETE" } = input;
  const reasons: string[] = [];
  if (!hold) return { blocked: false, state: null, universalDeletionPolicy: false, reasons: [] };

  if (!(RETENTION_HOLD_STATES as readonly string[]).includes(hold.holdState)) reasons.push("UNKNOWN_HOLD_STATE");
  const blockingStates = ["ACTIVE", "NEEDS_REVIEW"];
  const blocked = operation === "DELETE" && blockingStates.includes(hold.holdState);

  return {
    blocked,
    state: hold.holdState ?? null,
    universalDeletionPolicy: false,
    reasons: uniq(reasons),
  };
}

// ---------------------------------------------------------------------------
// 4. Projection — provider-neutral read contract. NOT the authority.
// ---------------------------------------------------------------------------
export interface ProjectionInput {
  kind: string;
  referenceDate: string;
  registries?: Record<string, Array<Record<string, any>>>;
}

export function projectLifecycle(input: ProjectionInput): Record<string, unknown> {
  const kind = requireEnum(input.kind, PROJECTION_KINDS, "projectionKind");
  const referenceDate = requireNonEmptyString(input.referenceDate, "referenceDate");
  const r = input.registries ?? {};
  const packs = r.packs ?? [];
  const approvals = r.approvals ?? [];
  const releases = r.releases ?? [];
  const distributions = r.distributions ?? [];
  const adoptionReceipts = r.adoptionReceipts ?? [];
  const rollbacks = r.rollbacks ?? [];
  const driftRecords = r.driftRecords ?? [];
  const handoffs = r.handoffs ?? [];
  const retentionHolds = r.retentionHolds ?? [];

  const base = {
    projectionKind: kind,
    referenceDate,
    generatedAt: `${referenceDate}T00:00:00Z`,
    complianceClaim: COMPLIANCE_CLAIM,
    authority: "COMPLIANCE_CORE",
    isAuthority: false,
    counts: {
      packs: packs.length,
      approvals: approvals.length,
      releases: releases.length,
      distributions: distributions.length,
      adoptionReceipts: adoptionReceipts.length,
      rollbacks: rollbacks.length,
      driftRecords: driftRecords.length,
      handoffs: handoffs.length,
      retentionHolds: retentionHolds.length,
    },
  };

  switch (kind) {
    case "POLICY_RELEASE":
      return {
        ...base,
        rows: [...releases]
          .sort((a, b) => (a.releaseId < b.releaseId ? -1 : 1))
          .map((rel) => ({
            releaseId: rel.releaseId,
            packId: rel.packId,
            packVersion: rel.packVersion,
            expired: isExpired(rel.expiresAt, referenceDate),
            withdrawn: Boolean(rel.supersededBy),
            adopted: adoptionReceipts.some((a) => a.releaseId === rel.releaseId && a.resultingState === "APPLIED"),
          })),
      };
    case "PRODUCT_ADOPTION":
      return {
        ...base,
        rows: [...adoptionReceipts]
          .sort((a, b) => (a.receiptId < b.receiptId ? -1 : 1))
          .map((a) => ({
            receiptId: a.receiptId,
            releaseId: a.releaseId,
            targetRef: a.targetRef,
            targetType: a.targetType,
            received: Boolean(a.receivedAt),
            applied: Boolean(a.appliedAt),
            state: a.resultingState,
          })),
      };
    case "DRIFT":
      return {
        ...base,
        rows: [...driftRecords]
          .sort((a, b) => (a.driftId < b.driftId ? -1 : 1))
          .map((d) => ({
            driftId: d.driftId,
            driftKind: d.driftKind,
            severity: d.severity,
            disposition: d.disposition,
            requiresReview: d.driftKind === "SOURCE_CHANGE",
          })),
      };
    case "LEGAL_CHANGE_STATUS":
      return {
        ...base,
        rows: [...driftRecords]
          .filter((d) => d.driftKind === "SOURCE_CHANGE")
          .sort((a, b) => (a.driftId < b.driftId ? -1 : 1))
          .map((d) => ({
            driftId: d.driftId,
            subjectRef: d.subjectRef,
            disposition: d.disposition,
            autoRewritesPolicy: false,
          })),
      };
    case "EXTERNAL_ASSURANCE_STATUS":
      return {
        ...base,
        rows: [...handoffs]
          .sort((a, b) => (a.handoffId < b.handoffId ? -1 : 1))
          .map((h) => ({
            handoffId: h.handoffId,
            handoffState: h.handoffState,
            complianceClaim: h.complianceClaim,
            evidenceHandoffState: h.evidenceHandoffState,
          })),
      };
    case "EVIDENCE_FRESHNESS":
      return {
        ...base,
        rows: [...handoffs]
          .flatMap((h) => (h.evidenceRefs ?? []).map((e: Record<string, any>) => ({
            handoffId: h.handoffId,
            evidenceId: e.evidenceId,
            evidenceCandidateState: e.evidenceCandidateState,
          })))
          .sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : 1)),
      };
    case "TENANT_OVERVIEW":
    case "PRODUCT_OVERVIEW":
    case "FRAMEWORK_CONTROL_COVERAGE":
    case "APPLICABILITY_SUMMARY":
    case "VERIFICATION_SUMMARY":
    case "EXCEPTIONS_REMEDIATION":
      // Declared as contracts; their row sources live in other lanes' registries.
      return { ...base, rows: [] };
    default:
      throw new ValidationError("UNKNOWN_PROJECTION_KIND", `unknown projection kind: ${kind}`);
  }
}
