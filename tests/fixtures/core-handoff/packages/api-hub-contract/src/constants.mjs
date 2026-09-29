// FSTS Compliance Core — Phase 6
// API Hub Integration / Security / Final Certification — vocabularies.
// ---------------------------------------------------------------------------
// This package owns the GOVERNED CONTRACT between Compliance Core and the ARMA
// API Hub. It is deliberately transport-neutral: the API Hub owns external API
// transport, connectors, webhooks, retries, rate limits, quotas, and vendor/API
// usage/cost transport; Compliance Core owns compliance authority/state,
// applicability, controls, verification/evidence metadata, policy governance,
// legal/regulatory governance, and adoption/drift/rollback.
//
// Hard invariants encoded here (never weakened):
//   PASS != COMPLIANT
//   IMPLEMENTED != CERTIFIED
//   READY != CERTIFIED
//   APPROVED != RELEASED
//   RELEASED != ADOPTED
//   RECEIVED != APPLIED
// ---------------------------------------------------------------------------
// No product ever receives direct Compliance Core Convex access. Every exchange
// is authenticated service-to-service and mediated by this contract.

// The frozen deterministic reference date for the Phase 6 lane. No engine in
// this package ever reads the wall clock or the network; every temporal
// derivation is made against an explicit referenceDate / issuedAt.
export const REFERENCE_DATE = '2026-09-16';

// Frozen reference epoch (ms) used by deterministic examples. Aligns with
// REFERENCE_DATE at 00:00:00Z.
export const REFERENCE_EPOCH_MS = Date.parse('2026-09-16T00:00:00Z');

// ---------------------------------------------------------------------------
// Contract identity
// ---------------------------------------------------------------------------
export const CONTRACT_ID = 'FSTS-COMPLIANCE-CORE-API-HUB';
export const CONTRACT_VERSION = '1.0.0';

// API versions this contract can negotiate. Requested versions outside this
// set fail closed (VERSION_UNSUPPORTED); negotiation selects the highest
// mutually supported version.
export const SUPPORTED_API_VERSIONS = Object.freeze(['1.0.0', '1.1.0']);
export const DEFAULT_API_VERSION = '1.1.0';

// Envelope versions for the wire envelope itself.
export const SUPPORTED_ENVELOPE_VERSIONS = Object.freeze(['1.0.0']);
export const ENVELOPE_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Direction + status
// ---------------------------------------------------------------------------
export const DIRECTIONS = Object.freeze(['INBOUND', 'OUTBOUND']);

// Response status is deliberately tri-state. DEGRADED is a first-class outcome
// so safe degradation is observable and never silently upgraded to OK.
export const RESPONSE_STATUSES = Object.freeze(['OK', 'FAIL', 'DEGRADED']);

// ---------------------------------------------------------------------------
// Governed actions (Compliance Core authority surface exposed via the Hub).
// Every action maps to exactly one authority owner. The Hub never owns these.
// ---------------------------------------------------------------------------
export const GOVERNED_ACTIONS = Object.freeze([
  'compliance.applicability.read',
  'compliance.controls.read',
  'compliance.verification.submit',
  'compliance.evidence.metadata.write',
  'compliance.policy.distribute',
  'compliance.adoption.receipt.submit',
  'compliance.assessment.read',
  'compliance.drift.read',
  'compliance.rollback.request',
  'compliance.legal.change.read',
  'compliance.health.read',
]);

// Authority owner per concern (locked split — never reassigned).
export const AUTHORITY_OWNERS = Object.freeze({
  'external-api-transport': 'API_HUB',
  connectors: 'API_HUB',
  webhooks: 'API_HUB',
  retries: 'API_HUB',
  'rate-limits': 'API_HUB',
  quotas: 'API_HUB',
  'vendor-api-usage-cost-transport': 'API_HUB',
  'compliance-authority-state': 'COMPLIANCE_CORE',
  applicability: 'COMPLIANCE_CORE',
  controls: 'COMPLIANCE_CORE',
  'verification-evidence-metadata': 'COMPLIANCE_CORE',
  'policy-governance': 'COMPLIANCE_CORE',
  'legal-regulatory-governance': 'COMPLIANCE_CORE',
  'adoption-drift-rollback': 'COMPLIANCE_CORE',
});

// ---------------------------------------------------------------------------
// Scopes (least privilege). A service identity carries an explicit scope set.
// ---------------------------------------------------------------------------
export const SCOPES = Object.freeze([
  'compliance.read',
  'compliance.write',
  'verification.submit',
  'evidence.metadata.write',
  'policy.distribute',
  'adoption.receipt.submit',
  'rollback.request',
  'telemetry.write',
]);

// Required scope per governed action (fail-closed: unmapped action = no scope).
export const ACTION_SCOPES = Object.freeze({
  'compliance.applicability.read': 'compliance.read',
  'compliance.controls.read': 'compliance.read',
  'compliance.verification.submit': 'verification.submit',
  'compliance.evidence.metadata.write': 'evidence.metadata.write',
  'compliance.policy.distribute': 'policy.distribute',
  'compliance.adoption.receipt.submit': 'adoption.receipt.submit',
  'compliance.assessment.read': 'compliance.read',
  'compliance.drift.read': 'compliance.read',
  'compliance.rollback.request': 'rollback.request',
  'compliance.legal.change.read': 'compliance.read',
  'compliance.health.read': 'compliance.read',
});

// ---------------------------------------------------------------------------
// Service identity status
// ---------------------------------------------------------------------------
export const SERVICE_IDENTITY_STATUSES = Object.freeze(['ACTIVE', 'SUSPENDED', 'REVOKED']);

// ---------------------------------------------------------------------------
// Failure taxonomy — bounded, closed. Every non-OK response carries exactly one
// code from this set. Classes drive retry semantics.
// ---------------------------------------------------------------------------
export const FAILURE_CLASSES = Object.freeze([
  'AUTH',
  'AUTHORIZATION',
  'VALIDATION',
  'CONFLICT',
  'IDEMPOTENCY',
  'REPLAY',
  'RATE_LIMIT',
  'QUOTA',
  'VERSION',
  'DEPENDENCY',
  'TIMEOUT',
  'INTEGRITY',
  'AUDIT',
  'DEGRADATION',
  'INTERNAL',
]);

// code -> { failureClass, retryable, description }
export const FAILURE_TAXONOMY = Object.freeze({
  AUTH_MISSING_CREDENTIAL: { failureClass: 'AUTH', retryable: false, description: 'No service credential was presented.' },
  AUTH_INVALID_CREDENTIAL: { failureClass: 'AUTH', retryable: false, description: 'Presented credential did not match the registered identity.' },
  AUTH_EXPIRED: { failureClass: 'AUTH', retryable: false, description: 'Presented credential is expired.' },
  AUTH_SIGNATURE_INVALID: { failureClass: 'AUTH', retryable: false, description: 'Request signature did not verify against the referenced key.' },
  AUTH_IDENTITY_INACTIVE: { failureClass: 'AUTH', retryable: false, description: 'Service identity is not ACTIVE.' },
  SCOPE_INSUFFICIENT: { failureClass: 'AUTHORIZATION', retryable: false, description: 'Identity lacks the scope required by the action.' },
  SCOPE_ESCALATION_DENIED: { failureClass: 'AUTHORIZATION', retryable: false, description: 'Request attempted to assert a scope the identity does not hold.' },
  TENANT_MISMATCH: { failureClass: 'AUTHORIZATION', retryable: false, description: 'Request tenant does not match the identity tenant (cross-tenant denied).' },
  PRODUCT_MISMATCH: { failureClass: 'AUTHORIZATION', retryable: false, description: 'Request product does not match the product-bound identity (cross-product denied).' },
  VALIDATION_MALFORMED: { failureClass: 'VALIDATION', retryable: false, description: 'Envelope or payload is malformed.' },
  VALIDATION_MISSING_FIELD: { failureClass: 'VALIDATION', retryable: false, description: 'A required field is absent.' },
  VALIDATION_OVERSIZED: { failureClass: 'VALIDATION', retryable: false, description: 'Payload exceeds the governed size limit.' },
  VALIDATION_UNKNOWN_ACTION: { failureClass: 'VALIDATION', retryable: false, description: 'Action is not a governed action.' },
  CONFLICT_STATE: { failureClass: 'CONFLICT', retryable: false, description: 'Request conflicts with current authoritative state.' },
  IDEMPOTENCY_CONFLICT: { failureClass: 'IDEMPOTENCY', retryable: false, description: 'Idempotency key reused with a different payload.' },
  IDEMPOTENCY_IN_PROGRESS: { failureClass: 'IDEMPOTENCY', retryable: true, description: 'An identical request is in flight; retry later (no duplicate execution).' },
  REPLAY_DETECTED: { failureClass: 'REPLAY', retryable: false, description: 'Nonce was already seen (replay denied).' },
  REQUEST_STALE: { failureClass: 'REPLAY', retryable: false, description: 'Request is outside its validity window.' },
  RATE_LIMIT_EXCEEDED: { failureClass: 'RATE_LIMIT', retryable: true, description: 'Rate limit exceeded; retry after the indicated delay.' },
  RETRY_STORM: { failureClass: 'RATE_LIMIT', retryable: true, description: 'Retry budget exhausted; back off before retrying.' },
  QUOTA_EXCEEDED: { failureClass: 'QUOTA', retryable: false, description: 'Period quota exhausted; not retryable until reset.' },
  VERSION_UNSUPPORTED: { failureClass: 'VERSION', retryable: false, description: 'Requested API version is not supported.' },
  VERSION_NEGOTIATION_FAILED: { failureClass: 'VERSION', retryable: false, description: 'No mutually supported API version exists.' },
  DEPENDENCY_UNAVAILABLE: { failureClass: 'DEPENDENCY', retryable: true, description: 'A required dependency is unavailable.' },
  DEPENDENCY_TIMEOUT: { failureClass: 'TIMEOUT', retryable: true, description: 'A dependency did not respond in time.' },
  PARTIAL_FAILURE: { failureClass: 'DEPENDENCY', retryable: true, description: 'Only part of the operation completed; the rest is deferred.' },
  INTEGRITY_MISMATCH: { failureClass: 'INTEGRITY', retryable: false, description: 'Payload or envelope integrity hash did not match (tampering denied).' },
  AUDIT_GAP: { failureClass: 'AUDIT', retryable: false, description: 'A required audit linkage could not be established.' },
  DEGRADED_READ_ONLY: { failureClass: 'DEGRADATION', retryable: true, description: 'Operating read-only; writes are deferred.' },
  DEGRADED_QUEUED: { failureClass: 'DEGRADATION', retryable: true, description: 'Write accepted for deferred processing; not yet applied.' },
  INTERNAL_ERROR: { failureClass: 'INTERNAL', retryable: true, description: 'Unclassified internal error.' },
});

export const FAILURE_CODES = Object.freeze(Object.keys(FAILURE_TAXONOMY));

// ---------------------------------------------------------------------------
// Rate limits + quotas (governed defaults; per (tenant, product, action)).
// ---------------------------------------------------------------------------
export const DEFAULT_RATE_LIMIT = Object.freeze({ limit: 600, windowMs: 60_000 });
export const DEFAULT_QUOTA = Object.freeze({ limit: 1_000_000, period: 'MONTHLY' });

// Retry budget: the maximum number of retries the Hub may attempt for a single
// logical request before a RETRY_STORM is declared (protects Core from storms).
export const RETRY_BUDGET = 5;
// Base backoff (ms) for retryable failures; capped exponential with a ceiling.
export const RETRY_BASE_MS = 250;
export const RETRY_MAX_MS = 30_000;

// Governed payload size limit (bytes, canonical JSON) for an inbound envelope.
export const MAX_PAYLOAD_BYTES = 262_144; // 256 KiB

// Request validity window (ms) relative to issuedAt for stale-request defense.
export const REQUEST_TTL_MS = 300_000; // 5 minutes

// ---------------------------------------------------------------------------
// Degradation modes (safe degradation). Never fabricate compliance state.
// ---------------------------------------------------------------------------
export const DEGRADATION_MODES = Object.freeze([
  'NONE',
  'READ_ONLY',
  'QUEUED_WRITES',
  'TELEMETRY_ONLY',
]);

// ---------------------------------------------------------------------------
// Usage / cost telemetry (transport owned by the Hub; metadata shaped by Core).
// ---------------------------------------------------------------------------
export const TELEMETRY_UNITS = Object.freeze(['REQUEST', 'RESPONSE', 'COMPUTE', 'STORAGE']);
export const COST_CURRENCIES = Object.freeze(['USD']);

// ---------------------------------------------------------------------------
// Security certification matrix — the 32 mandated attack classes. Each must be
// DENIED (fail closed) with an expected failure code.
//
// PROVENANCE: every class is exercised against the AUTHORITATIVE Compliance Core
// governed pipeline (convex/lib/apiPipeline.ts -> runGovernedPipeline), the real
// Chat 4 legal/regulatory guards (convex/lib/legalApi.ts), or the API Hub's own
// TRANSPORT-side primitives (retry/degradation/audit/oversize). The Hub
// TRANSPORTS; the Core DECIDES. A transport outcome is never a compliance
// verdict.
// ---------------------------------------------------------------------------
export const SECURITY_ATTACK_CLASSES = Object.freeze([
  // --- Core governed-boundary decisions (authoritative) --------------------
  'CROSS_TENANT_ATTACK',
  'CROSS_PRODUCT_ATTACK',
  'AUTH_BYPASS',
  'REVOKED_IDENTITY',
  'SUSPENDED_IDENTITY',
  'SCOPE_ESCALATION',
  'FORGED_TENANT',
  'FORGED_ROLE_PRINCIPAL',
  'REPLAY',
  'NONCE_REUSE',
  'TAMPERING',
  'INVALID_HMAC',
  'STALE_REQUEST',
  'DUPLICATE_DELIVERY',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_RACE',
  'MALFORMED_PAYLOAD',
  'UNSUPPORTED_VERSION',
  'UNKNOWN_OPERATION',
  'RATE_LIMIT_ABUSE',
  'ENVIRONMENT_NOT_AUTHORIZED',
  // --- API Hub transport-side defenses (never the authority) ---------------
  'OVERSIZED_PAYLOAD',
  'RETRY_STORM',
  'PARTIAL_FAILURE',
  'DEPENDENCY_OUTAGE',
  'AUDIT_GAP',
  // --- Chat 4 legal/regulatory governance guards (real domain guards) ------
  'ATTEMPTED_AUTO_ENFORCEMENT',
  'ATTEMPTED_CANONICAL_LAW_AUTHORING',
  'PRODUCT_INTAKE_ATTEMPT',
  'UNRESOLVED_CONFLICT_AUTO_RESOLUTION',
  'HISTORICAL_ANN_ARBOR_AS_CURRENT',
  'DETECTED_LEGAL_CHANGE_DIRECT_PRODUCT_CHANGE',
]);

// ---------------------------------------------------------------------------
// End-to-end certification chain (ordered). Each stage asserts the transition
// invariant that must hold. The chain consumes the REAL integrated Chat 1-4
// service surfaces (legal API guards, governed pipeline, policy release,
// distribution/adoption, lifecycle governance) — never a simulated parallel
// lifecycle.
// ---------------------------------------------------------------------------
export const E2E_STAGES = Object.freeze([
  'LEGAL_CHANGE',
  'HUMAN_LEGAL_REVIEW',
  'CANONICAL_LEGAL_UPDATE',
  'APPLICABILITY_REVIEW',
  'CONTROL_ACTIVATION',
  'POLICY_REVIEW_PACK',
  'APPROVAL',
  'SIGNED_RELEASE',
  'DISTRIBUTION',
  'RECEIPT',
  'APPLICATION_ADOPTION',
  'VERIFICATION',
  'EVIDENCE_METADATA',
  'ASSESSMENT',
  'DRIFT_EXCEPTION_ROLLBACK',
]);

// Transition invariants proven across the chain (never weakened).
export const E2E_INVARIANTS = Object.freeze([
  'PASS != COMPLIANT',
  'IMPLEMENTED != CERTIFIED',
  'READY != CERTIFIED',
  'APPROVED != RELEASED',
  'RELEASED != ADOPTED',
  'RECEIVED != APPLIED',
]);

// ---------------------------------------------------------------------------
// Six API Hub tables — RUNTIME vs CONTRACT-ONLY decision.
//
// DECISION: CONTRACT-ONLY (non-runtime). The six tables below are a governed
// REFERENCE definition of the Hub's transport-contract data form. They are NOT
// composed into the runtime `convex/schema.ts` and are NOT deployed as live
// Convex tables. Rationale: the AUTHORITATIVE runtime equivalents already exist
// and are owned by Chat 1 (`apiNonces`, `apiRateLimitCounters`,
// `apiServiceContracts`, plus `auditEvents`/`idempotencyRecords`). Composing
// these six would create COMPETING / DUPLICATE Compliance Core tables and a
// parallel tenancy/auth/idempotency surface — which the convergence rules
// forbid. The Hub transports; the Core decides and persists. The generated
// `convex/apiHubSchema.ts` therefore documents the data form as a non-runtime
// reference artifact and is never wired into the single Convex database.
// ---------------------------------------------------------------------------
export const CONVEX_TABLES = Object.freeze([
  'apiHubExchanges',
  'apiHubNonces',
  'apiHubRateBuckets',
  'apiHubQuotaLedgers',
  'apiUsageTelemetry',
  'apiHubSecurityRuns',
]);

// The six-table runtime decision. `false` = CONTRACT-ONLY (non-runtime).
export const CONVEX_TABLES_RUNTIME = false;
export const CONVEX_TABLES_DECISION = 'CONTRACT_ONLY';
export const CONVEX_TABLES_DECISION_RATIONALE =
  'Chat 1 already owns the authoritative runtime equivalents (apiNonces, apiRateLimitCounters, apiServiceContracts, auditEvents, idempotencyRecords); composing the six would create competing/duplicate Core tables and a parallel tenancy/auth/idempotency surface.';

// Transport wire API version -> Compliance Core governed API version. The Hub
// transports a wire version; the Core decides against its own governed version.
export const TRANSPORT_TO_CORE_VERSION = Object.freeze({
  '1.0.0': 'v1',
  '1.1.0': 'v1',
});

// Chat 1-owned tables this lane REFERENCES (never redefines).
export const CHAT1_REFERENCED_TABLES = Object.freeze([
  'tenants',
  'products',
  'productInstances',
  'serviceIdentities',
  'idempotencyRecords',
  'auditEvents',
]);

// Compliance verdict tokens that must never appear as a stored value in this
// lane's artifacts (PASS != COMPLIANT, IMPLEMENTED != CERTIFIED, READY != CERTIFIED).
export const FORBIDDEN_VERDICT_TOKENS = Object.freeze(['COMPLIANT', 'CERTIFIED', 'AUTHORIZED']);
