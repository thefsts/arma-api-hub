// FSTS Compliance Core — legal status + effective-date model (Phase 5, Chat 4)
//
// Pure, dependency-free, fail-closed. Mirrors the Git-canonical legal schemas
// (schemas/legal-source.schema.json, schemas/legal-provision.schema.json) so
// operational state can never drift into an unmodeled legal status.
//
// HARD RULES:
//   * Only EFFECTIVE instruments are enforceable law.
//   * HISTORICAL / SUPERSEDED / REPEALED instruments are NON_ENFORCING.
//   * An EFFECTIVE record must never also be superseded (contradiction).
//   * Effective dates are an explicit, multi-dimensional model. Unknown values
//     are UNKNOWN / NEEDS_REVIEW — never guessed.
//   * Federal and state authority tiers are kept separate.
//   * Ann Arbor Chapter 95 is HISTORICAL / SUPERSEDED / NON_ENFORCING /
//     NOT_APPLICABLE — never presented as current law.
//
// This module NEVER authors or rewrites canonical law. It validates and
// normalizes operational state derived from Git.

import {
  ValidationError,
  requireNonEmptyString,
  requireEnum,
  compact,
} from "./validation.ts";

// ---------------------------------------------------------------------------
// Closed enums (mirror convex/schema.ts + the Git legal schemas)
// ---------------------------------------------------------------------------
export const LEGAL_STATUSES = [
  "EFFECTIVE",
  "PROPOSED",
  "PENDING",
  "SUPERSEDED",
  "REPEALED",
  "ENJOINED",
  "SUSPENDED",
  "HISTORICAL",
  "NEEDS_REVIEW",
] as const;

export const LEGAL_ENFORCEABILITY = [
  "ENFORCING",
  "NON_ENFORCING",
  "PARTIALLY_ENFORCING",
  "UNKNOWN",
] as const;

export const LEGAL_AUTHORITY_TIERS = ["FEDERAL", "STATE", "LOCAL", "TRIBAL"] as const;

export const LEGAL_APPLICABILITY = [
  "APPLICABLE",
  "POTENTIALLY_APPLICABLE",
  "NOT_APPLICABLE",
  "FUTURE",
  "NEEDS_REVIEW",
] as const;

export const LEGAL_COVERAGE_STATUSES = [
  "SOURCE_VERIFIED",
  "STRUCTURAL_ONLY",
  "RESEARCHING",
  "NEEDS_REVIEW",
] as const;

export const LEGAL_RESEARCH_STATUSES = [
  "COMPLETE",
  "IN_PROGRESS",
  "NOT_STARTED",
  "NEEDS_REVIEW",
] as const;

// Effective-date dimensions. Kept SEPARATE — never collapsed into one date.
export const EFFECTIVE_DATE_KINDS = [
  "PUBLISHED",
  "OBSERVED",
  "ENACTED",
  "ADOPTED",
  "EFFECTIVE",
  "ENFORCEMENT_START",
  "EXPIRATION",
  "REPEAL",
  "SUPERSESSION",
  "HISTORICAL",
] as const;

export const UNKNOWN_DATE = "UNKNOWN";

// ---------------------------------------------------------------------------
// Enforceability
// ---------------------------------------------------------------------------
// Only EFFECTIVE instruments are enforceable law.
export function isEnforceable(legalStatus: unknown): boolean {
  return legalStatus === "EFFECTIVE";
}

// Fail-closed derivation of enforceability from legal status. An unrecognized
// status yields UNKNOWN (never ENFORCING).
export function deriveEnforceability(legalStatus: unknown): string {
  switch (legalStatus) {
    case "EFFECTIVE":
      return "ENFORCING";
    case "HISTORICAL":
    case "SUPERSEDED":
    case "REPEALED":
      return "NON_ENFORCING";
    case "ENJOINED":
    case "SUSPENDED":
      return "PARTIALLY_ENFORCING";
    case "PROPOSED":
    case "PENDING":
      return "NON_ENFORCING";
    default:
      return "UNKNOWN";
  }
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------
// HISTORICAL => NON_ENFORCING; SUPERSEDED/REPEALED => not ENFORCING.
export function assertHistoricalInvariant(record: {
  legalStatus?: unknown;
  enforceability?: unknown;
}): void {
  const status = record?.legalStatus;
  const enforce = record?.enforceability;
  if (status === "HISTORICAL" && enforce !== "NON_ENFORCING") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `HISTORICAL instrument must be NON_ENFORCING (got ${String(enforce)})`,
    );
  }
  if ((status === "SUPERSEDED" || status === "REPEALED") && enforce === "ENFORCING") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `${String(status)} instrument must not be ENFORCING`,
    );
  }
}

// An EFFECTIVE record must never also be superseded.
export function assertNoEffectiveSuperseded(record: {
  legalStatus?: unknown;
  supersededBy?: unknown;
}): void {
  if (record?.legalStatus === "EFFECTIVE" && record?.supersededBy) {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `EFFECTIVE instrument must not carry supersededBy (${String(record.supersededBy)})`,
    );
  }
}

// HISTORICAL provisions are NOT_APPLICABLE.
export function assertHistoricalProvisionInvariant(record: {
  legalStatus?: unknown;
  applicability?: unknown;
}): void {
  if (record?.legalStatus === "HISTORICAL" && record?.applicability !== "NOT_APPLICABLE") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `HISTORICAL provision must be NOT_APPLICABLE (got ${String(record?.applicability)})`,
    );
  }
}

// Federal authority tier belongs only to the federal jurisdiction.
export function assertFederalStateSeparation(record: {
  jurisdictionId?: unknown;
  authorityTier?: unknown;
}): void {
  const tier = record?.authorityTier;
  const jurisdiction = record?.jurisdictionId;
  if (tier === "FEDERAL" && jurisdiction !== "US-FED") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `FEDERAL authorityTier is reserved for US-FED (got ${String(jurisdiction)})`,
    );
  }
  if (jurisdiction === "US-FED" && tier !== "FEDERAL") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `US-FED sources must carry FEDERAL authorityTier (got ${String(tier)})`,
    );
  }
}

// Ann Arbor Chapter 95 lineage invariant (explicit PM requirement).
export const ANN_ARBOR_CH95_SOURCE_ID = "LS-MI-ANNARBOR-CH95";
export const ANN_ARBOR_CH95_SUPERSEDED_BY = "LS-MI-ANNARBOR-CH96";

export function assertAnnArborCh95Invariant(record: {
  sourceId?: unknown;
  legalStatus?: unknown;
  enforceability?: unknown;
  supersededBy?: unknown;
}): void {
  if (record?.sourceId !== ANN_ARBOR_CH95_SOURCE_ID) return;
  if (record.legalStatus !== "HISTORICAL") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `Ann Arbor Ch.95 legalStatus must be HISTORICAL (got ${String(record.legalStatus)})`,
    );
  }
  if (record.enforceability !== "NON_ENFORCING") {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `Ann Arbor Ch.95 enforceability must be NON_ENFORCING (got ${String(record.enforceability)})`,
    );
  }
  if (record.supersededBy !== ANN_ARBOR_CH95_SUPERSEDED_BY) {
    throw new ValidationError(
      "LEGAL_INVARIANT",
      `Ann Arbor Ch.95 supersededBy must be ${ANN_ARBOR_CH95_SUPERSEDED_BY} (got ${String(record.supersededBy)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Effective-date model
// ---------------------------------------------------------------------------
// A multi-dimensional, effective-dated model. Each dimension is a date string
// (YYYY-MM-DD) or UNKNOWN. Unknown values are NEVER guessed.
export function buildEffectiveDateModel(input: Record<string, unknown>): Record<string, string> {
  const model: Record<string, string> = {};
  for (const kind of EFFECTIVE_DATE_KINDS) {
    const raw = input?.[kind];
    if (raw === undefined || raw === null || raw === "") {
      model[kind] = UNKNOWN_DATE;
    } else {
      const value = requireNonEmptyString(raw, kind);
      if (value !== UNKNOWN_DATE && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ValidationError(
          "INVALID_DATE",
          `${kind} must be YYYY-MM-DD or ${UNKNOWN_DATE} (got ${value})`,
        );
      }
      model[kind] = value;
    }
  }
  return model;
}

// The operative date for a status: EFFECTIVE uses the EFFECTIVE dimension;
// HISTORICAL uses HISTORICAL; REPEALED uses REPEAL; SUPERSEDED uses
// SUPERSESSION. Unknown when the relevant dimension is UNKNOWN.
export function resolveOperativeDate(
  legalStatus: unknown,
  model: Record<string, string>,
): string {
  const m = model ?? {};
  switch (legalStatus) {
    case "EFFECTIVE":
      return m.EFFECTIVE ?? UNKNOWN_DATE;
    case "HISTORICAL":
      return m.HISTORICAL ?? UNKNOWN_DATE;
    case "REPEALED":
      return m.REPEAL ?? UNKNOWN_DATE;
    case "SUPERSEDED":
      return m.SUPERSESSION ?? UNKNOWN_DATE;
    default:
      return UNKNOWN_DATE;
  }
}

// Fail-closed: an EFFECTIVE instrument with an UNKNOWN effective date is
// NEEDS_REVIEW, not silently treated as in force.
export function assertEffectiveDateResolvable(
  legalStatus: unknown,
  model: Record<string, string>,
): void {
  if (legalStatus === "EFFECTIVE" && resolveOperativeDate(legalStatus, model) === UNKNOWN_DATE) {
    throw new ValidationError(
      "EFFECTIVE_DATE_UNKNOWN",
      "EFFECTIVE instrument requires a known EFFECTIVE date (else NEEDS_REVIEW)",
    );
  }
}

// ---------------------------------------------------------------------------
// Runtime builders
// ---------------------------------------------------------------------------
export function buildLegalSourceRuntime(input: Record<string, unknown>): Record<string, unknown> {
  const sourceId = requireNonEmptyString(input.sourceId, "sourceId");
  const jurisdictionId = requireNonEmptyString(input.jurisdictionId, "jurisdictionId");
  const authorityTier = requireEnum(input.authorityTier, LEGAL_AUTHORITY_TIERS, "authorityTier");
  const legalStatusValue = requireEnum(input.legalStatus, LEGAL_STATUSES, "legalStatus");
  const enforceability = requireEnum(
    input.enforceability ?? deriveEnforceability(legalStatusValue),
    LEGAL_ENFORCEABILITY,
    "enforceability",
  );
  const coverageStatus = requireEnum(
    input.coverageStatus ?? "NEEDS_REVIEW",
    LEGAL_COVERAGE_STATUSES,
    "coverageStatus",
  );
  const researchStatus = requireEnum(
    input.researchStatus ?? "NEEDS_REVIEW",
    LEGAL_RESEARCH_STATUSES,
    "researchStatus",
  );
  const record = compact({
    sourceId,
    jurisdictionId,
    authorityTier,
    instrumentType: requireNonEmptyString(input.instrumentType, "instrumentType"),
    legalStatus: legalStatusValue,
    enforceability,
    counselReviewRequired: input.counselReviewRequired === true,
    coverageStatus,
    researchStatus,
    monitoringStatus: input.monitoringStatus ?? "ACTIVE",
    officialSource: requireNonEmptyString(input.officialSource, "officialSource"),
    effectiveDate: input.effectiveDate ?? null,
    enactedDate: input.enactedDate ?? null,
    sunsetDate: input.sunsetDate ?? null,
    supersedes: input.supersedes ?? null,
    supersededBy: input.supersededBy ?? null,
    registryVersion: input.registryVersion ?? null,
    gitCommit: input.gitCommit ?? null,
  });
  assertHistoricalInvariant(record);
  assertNoEffectiveSuperseded(record);
  assertFederalStateSeparation(record);
  assertAnnArborCh95Invariant(record);
  return record;
}

export function buildLegalProvisionRuntime(input: Record<string, unknown>): Record<string, unknown> {
  const legalStatusValue = requireEnum(input.legalStatus, LEGAL_STATUSES, "legalStatus");
  const applicability = requireEnum(input.applicability, LEGAL_APPLICABILITY, "applicability");
  const record = compact({
    provisionId: requireNonEmptyString(input.provisionId, "provisionId"),
    sourceId: requireNonEmptyString(input.sourceId, "sourceId"),
    jurisdictionId: requireNonEmptyString(input.jurisdictionId, "jurisdictionId"),
    parentProvisionId: input.parentProvisionId ?? null,
    reference: requireNonEmptyString(input.reference, "reference"),
    provisionType: requireNonEmptyString(input.provisionType, "provisionType"),
    mandatoryOrGuidance: requireNonEmptyString(input.mandatoryOrGuidance, "mandatoryOrGuidance"),
    applicability,
    legalStatus: legalStatusValue,
    textPolicy: requireNonEmptyString(input.textPolicy, "textPolicy"),
    version: requireNonEmptyString(input.version, "version"),
    effectiveDate: input.effectiveDate ?? null,
    sunsetDate: input.sunsetDate ?? null,
    registryVersion: input.registryVersion ?? null,
    gitCommit: input.gitCommit ?? null,
  });
  assertHistoricalProvisionInvariant(record);
  return record;
}

export function buildLegalJurisdictionRuntime(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return compact({
    jurisdictionId: requireNonEmptyString(input.jurisdictionId, "jurisdictionId"),
    name: requireNonEmptyString(input.name, "name"),
    type: requireNonEmptyString(input.type, "type"),
    parent: input.parent ?? null,
    coverageStatus: requireEnum(
      input.coverageStatus ?? "NEEDS_REVIEW",
      LEGAL_COVERAGE_STATUSES,
      "coverageStatus",
    ),
    researchStatus: requireEnum(
      input.researchStatus ?? "NEEDS_REVIEW",
      LEGAL_RESEARCH_STATUSES,
      "researchStatus",
    ),
    sourceCount: typeof input.sourceCount === "number" ? input.sourceCount : 0,
    provisionCount: typeof input.provisionCount === "number" ? input.provisionCount : 0,
    registryVersion: input.registryVersion ?? null,
    gitCommit: input.gitCommit ?? null,
  });
}
