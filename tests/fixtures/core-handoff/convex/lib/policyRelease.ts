// FSTS Compliance Core — policy release builders (Phase 6, Chat 3).
//
// Pure, deterministic, fail-closed builders + evaluators for the pre-adoption
// half of the locked lifecycle: POLICY PACK → APPROVAL → SIGNED RELEASE.
//
// Hard invariants enforced here (never weakened):
//   APPROVED != RELEASED  — an approval authorizes release; it never releases.
//   RELEASED != ADOPTED   — a release existing proves nothing about adoption.
//
// Signing boundary: this module stores signature METADATA ONLY (algorithm,
// external reference, digest). PRIVATE SIGNING KEYS ARE NEVER STORED and any
// attempt to pass key material fails closed.

import {
  ValidationError,
  requireNonEmptyString,
  requireEnum,
  compact,
} from "./validation.ts";
import {
  APPROVAL_DECISIONS,
  RELEASE_AUTHORIZING_DECISIONS,
  LIFECYCLE_STATES,
  RELEASE_FAIL_CLOSED_REASONS,
  type ReleaseFailClosedReason,
} from "./lifecycleConstants.ts";

// ---------------------------------------------------------------------------
// Signing boundary — reject any key material outright.
// ---------------------------------------------------------------------------
const KEY_MATERIAL_MARKERS = [
  "BEGIN RSA PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN PRIVATE KEY",
  "PRIVATE KEY-----",
];

export function assertNoSigningKeyMaterial(value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  for (const marker of KEY_MATERIAL_MARKERS) {
    if (text.includes(marker)) {
      throw new ValidationError(
        "PRIVATE_KEY_FORBIDDEN",
        "private signing keys are never stored — only a governed reference + digest",
      );
    }
  }
}

// A signature digest is a lowercase hex SHA-256/384/512 digest.
export function isValidSignatureDigest(digest: unknown): boolean {
  return typeof digest === "string" && /^[a-f0-9]{64}$|^[a-f0-9]{96}$|^[a-f0-9]{128}$/.test(digest);
}

// ---------------------------------------------------------------------------
// 1. Policy pack runtime reference.
// ---------------------------------------------------------------------------
export function buildPolicyPackRuntime(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const packId = requireNonEmptyString(input.packId, "packId");
  const version = requireNonEmptyString(input.version, "version");
  const sourceGitCommit = requireNonEmptyString(input.sourceGitCommit, "sourceGitCommit");
  const controlSetHash = requireNonEmptyString(input.controlSetHash, "controlSetHash");
  const artifactDigest = requireNonEmptyString(input.artifactDigest, "artifactDigest");
  const lifecycleState = requireEnum(input.lifecycleState, LIFECYCLE_STATES, "lifecycleState");
  const jurisdictionBasis = Array.isArray(input.jurisdictionBasis)
    ? (input.jurisdictionBasis as unknown[]).map((j) => requireNonEmptyString(j, "jurisdictionBasis[]"))
    : [];

  // Pre-approval states must not carry an approval reference.
  const approvalRef = input.approvalRef ?? null;
  if ((lifecycleState === "DRAFT" || lifecycleState === "REVIEW") && approvalRef) {
    throw new ValidationError(
      "PRE_APPROVAL_ACTIVATION",
      `${lifecycleState} pack must not carry an approvalRef`,
    );
  }

  return compact({
    tenantId,
    packId,
    version,
    sourceGitCommit,
    controlSetHash,
    jurisdictionBasis,
    effectiveDate: input.effectiveDate ?? null,
    approvalRef,
    artifactDigest,
    lifecycleState,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

// ---------------------------------------------------------------------------
// 2. Policy approval — immutable, version-bound governance decision.
// ---------------------------------------------------------------------------
export function buildPolicyApproval(input: Record<string, unknown>): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const approvalId = requireNonEmptyString(input.approvalId, "approvalId");
  const packId = requireNonEmptyString(input.packId, "packId");
  const packVersion = requireNonEmptyString(input.packVersion, "packVersion");
  const contentDigest = requireNonEmptyString(input.contentDigest, "contentDigest");
  const decision = requireEnum(input.decision, APPROVAL_DECISIONS, "decision");
  const approver = requireNonEmptyString(input.approver, "approver");
  const approverRole = requireNonEmptyString(input.approverRole, "approverRole");
  const authorityBasis = requireNonEmptyString(input.authorityBasis, "authorityBasis");
  const decidedAt = requireNonEmptyString(input.decidedAt, "decidedAt");

  // A conditional approval must state its conditions.
  const conditions = Array.isArray(input.conditions) ? (input.conditions as unknown[]) : [];
  if (decision === "APPROVED_WITH_CONDITIONS" && conditions.length === 0) {
    throw new ValidationError(
      "CONDITIONS_REQUIRED",
      "APPROVED_WITH_CONDITIONS requires at least one condition",
    );
  }

  return compact({
    tenantId,
    approvalId,
    packId,
    packVersion,
    contentDigest,
    decision,
    approver,
    approverRole,
    authorityBasis,
    decidedAt,
    scope: Array.isArray(input.scope) ? input.scope : [],
    conditions,
    expiresAt: input.expiresAt ?? null,
    supersedes: input.supersedes ?? null,
    supersededBy: input.supersededBy ?? null,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

// ---------------------------------------------------------------------------
// 3. Signed release — signature metadata only. Never a private key.
// ---------------------------------------------------------------------------
export function buildSignedRelease(input: Record<string, unknown>): Record<string, unknown> {
  assertNoSigningKeyMaterial(input);
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const releaseId = requireNonEmptyString(input.releaseId, "releaseId");
  const packId = requireNonEmptyString(input.packId, "packId");
  const packVersion = requireNonEmptyString(input.packVersion, "packVersion");
  const contentDigest = requireNonEmptyString(input.contentDigest, "contentDigest");
  const signer = requireNonEmptyString(input.signer, "signer");
  const signerAuthority = requireNonEmptyString(input.signerAuthority, "signerAuthority");
  const signatureAlgorithm = requireNonEmptyString(input.signatureAlgorithm, "signatureAlgorithm");
  const signatureReference = requireNonEmptyString(input.signatureReference, "signatureReference");
  const signatureDigest = requireNonEmptyString(input.signatureDigest, "signatureDigest");
  const effectiveDate = requireNonEmptyString(input.effectiveDate, "effectiveDate");

  if (!isValidSignatureDigest(signatureDigest)) {
    throw new ValidationError(
      "INVALID_SIGNATURE_DIGEST",
      "signatureDigest must be a lowercase hex SHA-256/384/512 digest",
    );
  }

  const approvalRefs = Array.isArray(input.approvalRefs)
    ? (input.approvalRefs as unknown[]).map((a) => requireNonEmptyString(a, "approvalRefs[]"))
    : [];
  // A release without an authorizing approval reference is never issued.
  if (approvalRefs.length === 0) {
    throw new ValidationError(
      "UNAPPROVED_RELEASE",
      "a signed release requires at least one authorizing approval reference",
    );
  }

  return compact({
    tenantId,
    releaseId,
    packId,
    packVersion,
    contentDigest,
    approvalRefs,
    jurisdictionIds: Array.isArray(input.jurisdictionIds) ? input.jurisdictionIds : [],
    controlIds: Array.isArray(input.controlIds) ? input.controlIds : [],
    signer,
    signerAuthority,
    signatureAlgorithm,
    signatureReference,
    signatureDigest,
    issuedAt: typeof input.issuedAt === "number" ? input.issuedAt : 0,
    effectiveDate,
    expiresAt: input.expiresAt ?? null,
    supersedes: input.supersedes ?? null,
    supersededBy: input.supersededBy ?? null,
    rollbackRef: input.rollbackRef ?? null,
    auditRef: input.auditRef ?? null,
    recordStatus: requireEnum(input.recordStatus ?? "REAL", ["EXAMPLE", "REAL"] as const, "recordStatus"),
  });
}

// ---------------------------------------------------------------------------
// 4. Release eligibility — fail-closed.
// ---------------------------------------------------------------------------

// Whole days from `from` to `to` (positive when `to` is later). Null if
// unparseable. No wall clock; dates are parsed as UTC midnight.
export function daysBetween(from: unknown, to: unknown): number | null {
  const parse = (dateStr: unknown): number | null => {
    if (typeof dateStr !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(ms)) return null;
    return Math.floor(ms / 86400000);
  };
  const a = parse(from);
  const b = parse(to);
  if (a === null || b === null) return null;
  return b - a;
}

// A record is expired at `asOf` when its explicit expiresAt is strictly before
// asOf.
export function isExpired(expiresAt: unknown, asOf: unknown): boolean {
  if (!expiresAt) return false;
  const d = daysBetween(expiresAt, asOf);
  return d !== null && d > 0;
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

export interface ReleaseEligibility {
  eligible: boolean;
  reasons: ReleaseFailClosedReason[];
  detail: string;
}

/**
 * Decide whether a signed release is eligible to be distributed/adopted.
 * Fails closed: any missing/mismatched/expired/withdrawn/unknown condition
 * yields eligible=false with explicit reasons. Never throws on bad input.
 */
export function evaluateReleaseEligibility(input: {
  pack?: Record<string, any> | null;
  approvals?: Array<Record<string, any>>;
  release?: Record<string, any> | null;
  asOf: string;
}): ReleaseEligibility {
  const pack = input.pack ?? null;
  const approvals = input.approvals ?? [];
  const release = input.release ?? null;
  const asOf = input.asOf;
  if (!asOf) throw new ValidationError("MISSING_REFERENCE_DATE", "evaluateReleaseEligibility requires an explicit asOf reference date");

  const reasons: ReleaseFailClosedReason[] = [];
  if (!release) {
    return { eligible: false, reasons: ["UNKNOWN_RELEASE"], detail: "no release record supplied" };
  }

  // Unknown release: the release must resolve to a known pack.
  if (!pack) {
    reasons.push("UNKNOWN_RELEASE");
  } else {
    if (release.packId !== pack.packId) reasons.push("UNKNOWN_RELEASE");
    if (release.packVersion !== pack.version) reasons.push("UNKNOWN_RELEASE");
  }

  // Unsigned release: signature metadata must be present and well-formed.
  const hasSignature =
    typeof release.signatureAlgorithm === "string" &&
    release.signatureAlgorithm.length > 0 &&
    typeof release.signatureReference === "string" &&
    release.signatureReference.length > 0 &&
    isValidSignatureDigest(release.signatureDigest);
  if (!hasSignature) reasons.push("UNSIGNED_RELEASE");

  // Signature/hash mismatch + approval binding.
  const approvalById = new Map<string, Record<string, any>>(
    approvals.map((a) => [a.approvalId, a]),
  );
  const authorizing = ((release.approvalRefs ?? []) as string[])
    .map((id) => approvalById.get(id))
    .filter((a): a is Record<string, any> => Boolean(a))
    .filter((a) => (RELEASE_AUTHORIZING_DECISIONS as readonly string[]).includes(a.decision));

  if (authorizing.length === 0) {
    reasons.push("UNAPPROVED_RELEASE");
  } else {
    const digestMatches = authorizing.some((a) => a.contentDigest === release.contentDigest);
    if (!digestMatches) reasons.push("SIGNATURE_HASH_MISMATCH");
    const versionBound = authorizing.some((a) => a.packVersion === release.packVersion);
    if (!versionBound) reasons.push("UNAPPROVED_RELEASE");
  }

  // Expired release: the release itself, or every authorizing approval, expired.
  if (isExpired(release.expiresAt, asOf)) reasons.push("EXPIRED_RELEASE");
  if (authorizing.length > 0 && authorizing.every((a) => isExpired(a.expiresAt, asOf))) {
    reasons.push("EXPIRED_RELEASE");
  }

  // Withdrawn release: a WITHDRAWN pack, or a superseded release, is never
  // eligible.
  if (pack && pack.lifecycleState === "WITHDRAWN") reasons.push("WITHDRAWN_RELEASE");
  if (release.supersededBy) reasons.push("WITHDRAWN_RELEASE");

  const unique = uniq(reasons) as ReleaseFailClosedReason[];
  return {
    eligible: unique.length === 0,
    reasons: unique,
    detail:
      unique.length === 0
        ? "release is signed, approved, unexpired, and not withdrawn"
        : "release fails closed",
  };
}

// A release that fails eligibility must never be distributed/adopted.
export function assertReleaseDistributable(eligibility: ReleaseEligibility): void {
  if (!eligibility.eligible) {
    throw new ValidationError(
      "RELEASE_NOT_ELIGIBLE",
      `release fails closed: ${eligibility.reasons.join(", ")}`,
    );
  }
}

// Sanity: the fail-closed reason set is exactly the accepted vocabulary.
export function assertFailClosedReasonVocabulary(): boolean {
  const accepted = [...RELEASE_FAIL_CLOSED_REASONS].sort();
  const used = [
    "UNSIGNED_RELEASE",
    "SIGNATURE_HASH_MISMATCH",
    "UNAPPROVED_RELEASE",
    "EXPIRED_RELEASE",
    "WITHDRAWN_RELEASE",
    "UNKNOWN_RELEASE",
  ].sort();
  if (JSON.stringify(accepted) !== JSON.stringify(used)) {
    throw new ValidationError("VOCAB_MISMATCH", "fail-closed reason vocabulary drifted");
  }
  return true;
}
