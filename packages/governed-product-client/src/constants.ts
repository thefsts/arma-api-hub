// FSTS Governed Product Client — closed vocabularies.
//
// Every constant here is consumed from, or aligned verbatim to, an authoritative
// Compliance Core / ARMA API Hub contract. Nothing is invented. Where the frozen
// Phase 9 design (4ac26e0) diverged from the merged Phase 8 contracts, the
// POST-PHASE-8 CONTRACT RECONCILIATION AMENDMENT (see contracts/governed-product/
// AMENDMENTS.md) corrected it to match the Core. The corrections are marked
// `AMENDMENT 1..4` inline so the provenance is auditable and the original design
// is never silently rewritten.
//
// PASS != COMPLIANT. A conformance pass is an integration fact, never a
// compliance or certification claim.

// ---------------------------------------------------------------------------
// Environments — mirrors productRouting.ROUTING_ENVIRONMENTS and the manifest
// schema. A request in any other environment fails closed.
// ---------------------------------------------------------------------------
export const ENVIRONMENTS = Object.freeze(['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'] as const);
export type Environment = (typeof ENVIRONMENTS)[number];

// ---------------------------------------------------------------------------
// Versions.
//
// AMENDMENT 2 — VERSION COMPATIBILITY.
// Core `versionCompatibility.ts` gates on a THREE-way triple:
//   apiContractVersion + apiHubVersion + coreVersion.
// The frozen design carried only `apiHubContractVersion` + `apiVersion`. The
// governed manifest now declares all three distinct dimensions. They are NOT
// interchangeable merely because the current values all happen to be 1.0.0.
// ---------------------------------------------------------------------------
export const SUPPORTED_API_VERSIONS = Object.freeze(['1.0.0', '1.1.0'] as const);
export const SUPPORTED_CONTRACT_VERSIONS = Object.freeze(['1.0.0'] as const);
export const SUPPORTED_API_HUB_VERSIONS = Object.freeze(['1.0.0'] as const);
export const SUPPORTED_CORE_VERSIONS = Object.freeze(['1.0.0'] as const);

export const MANIFEST_VERSION = '1.0.0';
export const CONFORMANCE_SUITE_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Hub scopes — the 8-scope least-privilege transport vocabulary.
// ---------------------------------------------------------------------------
export const HUB_SCOPES = Object.freeze([
  'compliance.read',
  'compliance.write',
  'verification.submit',
  'evidence.metadata.write',
  'policy.distribute',
  'adoption.receipt.submit',
  'rollback.request',
  'telemetry.write',
] as const);
export type HubScope = (typeof HUB_SCOPES)[number];

// ---------------------------------------------------------------------------
// Evidence classifications — metadata/reference only by default.
// ---------------------------------------------------------------------------
export const EVIDENCE_CLASSIFICATIONS = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PROTECTED',
  'REGULATED',
] as const);
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

// ---------------------------------------------------------------------------
// Product types + ownership classes.
// ---------------------------------------------------------------------------
export const PRODUCT_TYPES = Object.freeze([
  'SECURITY_OPERATIONS',
  'PRIVACY',
  'LEGAL_ASSURANCE',
  'QUALITY_ASSURANCE',
  'CRM',
  'EVENTS',
  'CLIENT_PORTAL',
  'CANNABIS_LOGISTICS',
  'OTHER_APPROVED',
] as const);
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const OWNERSHIP_CLASSES = Object.freeze([
  'FSTS_OWNED',
  'CLIENT_OWNED',
  'PARTNER_OWNED',
] as const);
export type OwnershipClass = (typeof OWNERSHIP_CLASSES)[number];

// ---------------------------------------------------------------------------
// Bounded SDK failure codes — the ONLY codes a GovernedResult may carry.
//
// The 16 CONSUMED_FAILURE_CODES are the subset of the Hub/Core failure taxonomy
// a governed product may legitimately observe. UPSTREAM_UNAVAILABLE is the
// fail-closed collapse target. The LOCAL_DENIAL_CODES are produced client-side
// before any byte leaves the process.
// ---------------------------------------------------------------------------
export const CONSUMED_FAILURE_CODES = Object.freeze([
  'AUTHENTICATION_FAILED',
  'AUTHORIZATION_DENIED',
  'TENANT_DENIED',
  'PRODUCT_DENIED',
  'ENVIRONMENT_DENIED',
  'SCOPE_DENIED',
  'INTEGRATION_INACTIVE',
  'REPLAY_DENIED',
  'STALE_REQUEST',
  'INTEGRITY_FAILED',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'UNSUPPORTED_VERSION',
  'UNKNOWN_OPERATION',
  'VALIDATION_FAILED',
  'DEPENDENCY_UNAVAILABLE',
] as const);
export type ConsumedFailureCode = (typeof CONSUMED_FAILURE_CODES)[number];

export const LOCAL_DENIAL_CODES = Object.freeze([
  'CONFIG_INVALID',
  'CREDENTIAL_UNRESOLVED',
  'ROUTE_ENVELOPE_MISMATCH',
  'RAW_EVIDENCE_REJECTED',
  'FALSE_COMPLIANCE_CLAIM',
] as const);
export type LocalDenialCode = (typeof LOCAL_DENIAL_CODES)[number];

/** The single fail-closed collapse code. Never a verdict. */
export const UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE' as const;

export const BOUNDED_FAILURE_CODES = Object.freeze([
  ...CONSUMED_FAILURE_CODES,
  ...LOCAL_DENIAL_CODES,
  UPSTREAM_UNAVAILABLE,
] as const);
export type BoundedFailureCode = (typeof BOUNDED_FAILURE_CODES)[number];

// ---------------------------------------------------------------------------
// Retry dispositions — the exact four-way classification proven in the Phase 8
// worker (apps/worker/src/retry.ts). Behaviour is consistent across Hub and
// product.
// ---------------------------------------------------------------------------
export const RETRY_DISPOSITIONS = Object.freeze([
  'CLEAN_RETRYABLE',
  'AMBIGUOUS',
  'TERMINAL',
  'HELD',
] as const);
export type RetryDisposition = (typeof RETRY_DISPOSITIONS)[number];

/** The Phase 8 worker retry schedule. ORDER IS PRESERVED — never canonical-sorted. */
export const RETRY_SCHEDULE_MS = Object.freeze([1000, 5000, 30000, 120000, 600000] as const);
export const MAX_RETRY_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Health — AMENDMENT 3. Core owns authoritative derivation. These are the states
// the Core may report; the SDK NEVER manufactures them. It only observes.
// ---------------------------------------------------------------------------
export const HEALTH_STATUSES = Object.freeze([
  'HEALTHY',
  'DEGRADED',
  'UNHEALTHY',
  'UNKNOWN',
] as const);
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_ADMISSIONS = Object.freeze(['ALLOW', 'ALLOW_BOUNDED', 'BLOCK'] as const);
export const HEALTH_WINDOW_SIZE = 20;
export const MIN_HEALTH_SAMPLES = 5;
export const DEGRADED_FAILURE_RATE = 0.25;
export const UNHEALTHY_FAILURE_RATE = 0.5;
export const CONSECUTIVE_FAILURE_THRESHOLD = 5;

// ---------------------------------------------------------------------------
// Kill-switch / rollout scopes.
//
// AMENDMENT 1 — KILL-SWITCH / ROLLOUT SCOPES.
// Core `rolloutControls.ts` ROLLOUT_SCOPES is the authority:
//   GLOBAL | PRODUCT | TENANT | ENVIRONMENT.
// The frozen design invented `SERVICE` (Core can never engage it) and omitted
// `ENVIRONMENT` (Core does enforce it). Adopted verbatim from the Core.
// ---------------------------------------------------------------------------
export const KILL_SWITCH_SCOPES = Object.freeze([
  'GLOBAL',
  'PRODUCT',
  'TENANT',
  'ENVIRONMENT',
] as const);
export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

export const ROLLOUT_STATES = Object.freeze(['FULL', 'PARTIAL', 'PAUSED', 'KILLED'] as const);
export type RolloutState = (typeof ROLLOUT_STATES)[number];

/** A scope other than GLOBAL requires a scopeRef. GLOBAL must omit it. */
export const SCOPES_REQUIRING_REF = Object.freeze(['PRODUCT', 'TENANT', 'ENVIRONMENT'] as const);

// ---------------------------------------------------------------------------
// False-compliance guards. A governed payload may never carry a conclusion.
// ---------------------------------------------------------------------------
export const FORBIDDEN_CONCLUSION_TOKENS = Object.freeze([
  'COMPLIANT',
  'CERTIFIED',
  'AUTHORIZED',
  'ATTESTED',
] as const);

export const FORBIDDEN_VERDICT_FIELDS = Object.freeze([
  'compliant',
  'certified',
  'compliantStatus',
  'complianceStatus',
  'verdict',
  'certification',
  'attestation',
  'approved',
] as const);

// ---------------------------------------------------------------------------
// Freshness — consumed from the Core version-negotiation contract.
// ---------------------------------------------------------------------------
export const FRESHNESS_WINDOW_MS = 300_000;
export const FUTURE_SKEW_MS = 30_000;

// ---------------------------------------------------------------------------
// The 23 conformance areas. Order is the canonical C1..C23 order.
// ---------------------------------------------------------------------------
export const CONFORMANCE_AREAS = Object.freeze([
  'no-direct-core-access',
  'identity-binding',
  'tenant-binding',
  'product-binding',
  'environment-binding',
  'scope-enforcement',
  'operation-enforcement',
  'credential-references-only',
  'signing-integrity',
  'freshness',
  'nonce-replay',
  'idempotency',
  'version-mismatch',
  'route-mismatch',
  'suspension',
  'revocation',
  'kill-switch',
  'hub-outage',
  'core-outage',
  'bounded-errors',
  'audit-correlation',
  'raw-evidence-rejection',
  'false-compliance-claims',
] as const);
export type ConformanceArea = (typeof CONFORMANCE_AREAS)[number];

export const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
export const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const PRODUCT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
