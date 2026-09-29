// ARMA API Hub — Compliance Core transport client (Phase 7 · Chat 5 · FINAL).
//
// STATUS: FINALIZED against the converged Phase 7 Core tree
//         (FSTS-COMPLIANCE-CORE main @ c7ac04b2d40624bef1742f819a9f7eee43e3d12c).
//
// This module is the ARMA API Hub's TRANSPORT-side boundary to the FSTS
// Compliance Core. It CONSUMES the authoritative Core artifacts and never
// invents, renames, duplicates, or redistributes ownership of any governed
// contract, field, version, scope, failure code, or operation.
//
// LOCKED ARCHITECTURE (never weakened):
//   FSTS products -> ARMA API Hub -> FSTS Compliance Core.
//   * Compliance Core owns compliance authority + state.
//   * API Hub owns transport, routing, delivery, retries, external API limits,
//     connectors, vendor usage, and external API cost telemetry.
//   * The API Hub NEVER reads or writes the Compliance Core Convex database.
//   * There is NO second Core auth/authz decision engine inside the API Hub.
//
// The governed wire contract is owned by the Core and consumed verbatim from
// the vendored Core registry tree (see `contracts/compliance-core/core-handoff`
// and `tests/fixtures/core-handoff`, both pinned to the Core SHA above). The
// loaders below read those artifacts at runtime; nothing is restated by hand.
//
// The API Hub transports. The Compliance Core decides. A transport outcome is
// NEVER a compliance verdict.

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiError } from '@arma/contracts';

// ---------------------------------------------------------------------------
// Provenance — the exact Core revision this client is converged against.
// ---------------------------------------------------------------------------
export const COMPLIANCE_CORE_REPOSITORY = 'thefsts/FSTS-COMPLIANCE-CORE';
export const COMPLIANCE_CORE_MAIN_SHA = 'c7ac04b2d40624bef1742f819a9f7eee43e3d12c';
export const CORE_HANDOFF_MANIFEST_ID = 'FSTS-PHASE7-CORE-CONVERGENCE-HANDOFF';
export const CORE_HANDOFF_MANIFEST_VERSION = '1.0.0';
export const COMPLIANCE_CORE_INTEGRATION_STATUS = 'FINALIZED' as const;
export type ComplianceCoreIntegrationStatus = 'PENDING_DEPENDENCY' | 'FINALIZED';

// ---------------------------------------------------------------------------
// Authority split (locked). A concern is owned by exactly one side.
// ---------------------------------------------------------------------------
export const CORE_OWNED_CONCERNS = Object.freeze([
  'compliance-authority-state',
  'applicability',
  'controls',
  'verification',
  'evidence-metadata',
  'policy-governance',
  'legal-regulatory-governance',
  'release-adoption-state',
  'drift',
  'rollback',
  'core-authorization',
  'core-idempotency',
  'core-audit-linkage',
  'tenancy-authority',
  'onboarding-state',
] as const);

export const TRANSPORT_OWNED_CONCERNS = Object.freeze([
  'external-api-transport',
  'connectors',
  'webhooks',
  'delivery',
  'retry-execution',
  'external-vendor-rate-limits',
  'quotas',
  'vendor-api-usage-transport',
  'api-cost-telemetry-transport',
  'routing',
] as const);

// Cost ownership (locked, non-overlapping).
export const COST_OWNERSHIP = Object.freeze({
  'external-vendor-connector-transport-cost': 'ARMA_API_HUB',
  'model-token-agent-ai-execution-cost': 'AI_HUB',
  'profitability-margins-budgets': 'REGIVANTA',
} as const);

// ---------------------------------------------------------------------------
// Vendored Core registry tree — the authoritative artifacts consumed verbatim.
// ---------------------------------------------------------------------------
export const CORE_HANDOFF_VENDOR_DIR = 'contracts/compliance-core/core-handoff';

export interface CoreHandoffContract {
  readonly id: string;
  readonly lane: string;
  readonly title: string;
  readonly version: string;
  readonly authority: string;
  readonly sources: readonly string[];
}

export interface CoreHandoffManifest {
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly referenceDate: string;
  readonly singleBoundary: {
    readonly pipeline: string;
    readonly source: string;
    readonly portsBuilder: string;
    readonly portsSource: string;
    readonly note?: string;
  };
  readonly contracts: readonly CoreHandoffContract[];
  readonly honestyInvariants: readonly string[];
  readonly recordStatus: string;
}

export interface ScopeRegistry {
  readonly counts: { readonly coreScopes: number; readonly hubScopes: number };
  readonly coreScopes: readonly string[];
  readonly hubScopeToCoreScopes: Readonly<Record<string, readonly string[]>>;
}

export interface FailureCodeEntry {
  readonly code: string;
  readonly failureClass: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly message: string;
  readonly mandated: boolean;
}

export interface FailureTaxonomy {
  readonly counts: { readonly codes: number; readonly mandated: number };
  readonly mandatedFailureCodes: readonly string[];
  readonly codes: readonly FailureCodeEntry[];
}

export interface VersionNegotiation {
  readonly supportedApiVersions: readonly string[];
  readonly defaultApiVersion: string;
  readonly wireToCoreVersion: Readonly<Record<string, string>>;
  readonly unsupportedCode: string;
}

export interface IdempotencySemantics {
  readonly scope: string;
  readonly signedFields: readonly string[];
  readonly idempotencyFields: readonly string[];
  readonly freshnessWindowMs: number;
  readonly futureSkewMs: number;
}

export interface HealthReadinessContract {
  readonly health: {
    readonly statuses: readonly string[];
    readonly checks: readonly { readonly name: string }[];
  };
  readonly readiness: {
    readonly statuses: readonly string[];
    readonly checks: readonly { readonly name: string }[];
  };
  readonly complianceClaim: string;
  readonly certificationClaim: string;
}

export interface OperationRegistryEntry {
  readonly operationId: string;
  readonly kind: string;
  readonly requiredScope: string;
  readonly resourceType: string;
  readonly idempotencyScope: string | null;
  readonly evidenceSensitive: boolean;
  readonly governedAction: string | null;
}

export interface OperationRegistry {
  readonly counts: { readonly operations: number; readonly governedActions: number };
  readonly operations: readonly OperationRegistryEntry[];
  readonly governedActions: readonly {
    readonly action: string;
    readonly operations: readonly string[];
  }[];
}

function readJson<T>(dir: string, relative: string): T {
  return JSON.parse(readFileSync(join(dir, relative), 'utf8')) as T;
}

export function loadCoreHandoffManifest(dir: string): CoreHandoffManifest {
  return readJson<CoreHandoffManifest>(dir, 'handoff-manifest.json');
}
export function loadScopeRegistry(dir: string): ScopeRegistry {
  return readJson<ScopeRegistry>(dir, 'registry/service/scope-registry.json');
}
export function loadFailureTaxonomy(dir: string): FailureTaxonomy {
  return readJson<FailureTaxonomy>(dir, 'registry/service/failure-taxonomy.json');
}
export function loadVersionNegotiation(dir: string): VersionNegotiation {
  return readJson<VersionNegotiation>(dir, 'registry/service/version-negotiation.json');
}
export function loadIdempotencySemantics(dir: string): IdempotencySemantics {
  return readJson<IdempotencySemantics>(dir, 'registry/service/idempotency-semantics.json');
}
export function loadHealthReadinessContract(dir: string): HealthReadinessContract {
  return readJson<HealthReadinessContract>(dir, 'registry/service/health-readiness-contract.json');
}
export function loadOperationRegistry(dir: string): OperationRegistry {
  return readJson<OperationRegistry>(dir, 'registry/service/operation-registry.json');
}

// ---------------------------------------------------------------------------
// The 12 authoritative converged contracts (from the Core handoff manifest).
// ---------------------------------------------------------------------------
export const REQUIRED_PHASE7_CONTRACT_IDS = Object.freeze([
  'onboarding-identity',
  'governed-service-request-response',
  'operation-registry',
  'scope-registry',
  'failure-taxonomy',
  'version-negotiation',
  'replay-idempotency',
  'policy-delivery-adoption-drift',
  'legal-regulatory-change-transport',
  'audit-correlation',
  'credential-reference',
  'health-readiness',
] as const);
export type RequiredPhase7ContractId = (typeof REQUIRED_PHASE7_CONTRACT_IDS)[number];

export class ContractsUnavailableError extends Error {
  readonly code = 'COMPLIANCE_CORE_CONTRACTS_UNAVAILABLE';
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(
      `Compliance Core integration is not finalized: ${missing.length} required Phase 7 contract(s) unavailable (${missing.join(', ')})`,
    );
    this.name = 'ContractsUnavailableError';
    this.missing = Object.freeze([...missing]);
  }
}

/** Fail-closed guard: refuse to operate unless every converged contract is present. */
export function assertContractsAvailable(presentIds: readonly string[]): void {
  const present = new Set(presentIds);
  const missing = REQUIRED_PHASE7_CONTRACT_IDS.filter((id) => !present.has(id));
  if (missing.length > 0) throw new ContractsUnavailableError(missing);
}

export function isFinalized(status: ComplianceCoreIntegrationStatus): boolean {
  return status === 'FINALIZED';
}

// ---------------------------------------------------------------------------
// Governed envelope — matches the Core's authoritative `GovernedRequest` shape
// (convex/lib/apiRequest.ts). Field names and signing semantics are consumed
// verbatim; nothing is renamed.
// ---------------------------------------------------------------------------
export const SIGNED_FIELDS = Object.freeze([
  'apiVersion',
  'tenantId',
  'serviceIdentityId',
  'productId',
  'environment',
  'action',
  'resourceType',
  'resourceId',
  'timestamp',
  'nonce',
  'requestId',
  'correlationId',
  'idempotencyKey',
  'payloadHash',
] as const);

export const IDEMPOTENCY_FIELDS = Object.freeze([
  'apiVersion',
  'tenantId',
  'serviceIdentityId',
  'productId',
  'environment',
  'action',
  'resourceType',
  'resourceId',
  'payloadHash',
] as const);

export interface GovernedRequest {
  readonly apiVersion: string;
  readonly tenantId: string;
  readonly serviceIdentityId: string;
  readonly productId: string;
  readonly environment: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly signature: string;
}

export type GovernedRequestFields = Omit<GovernedRequest, 'signature'>;

// Deterministic canonical serialization (sorted keys, recursive) — identical to
// the Core's `canonicalize()` so signatures are byte-for-byte reproducible.
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortValue(src[key]);
    return out;
  }
  return value;
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function hmacSha256Hex(key: string, message: string): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalize(payload ?? null));
}

function projectFields(
  envelope: GovernedRequestFields,
  fields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = envelope as unknown as Record<string, unknown>;
  for (const field of fields) out[field] = src[field];
  return out;
}

export function computeRequestHash(envelope: GovernedRequestFields): string {
  return sha256Hex(canonicalize(projectFields(envelope, SIGNED_FIELDS)));
}

export function computeIdempotencyHash(envelope: GovernedRequestFields): string {
  return sha256Hex(canonicalize(projectFields(envelope, IDEMPOTENCY_FIELDS)));
}

export function computeRequestSignature(envelope: GovernedRequestFields, secret: string): string {
  return hmacSha256Hex(secret, computeRequestHash(envelope));
}

export interface BuildGovernedEnvelopeInput {
  readonly apiVersion: string;
  readonly tenantId: string;
  readonly serviceIdentityId: string;
  readonly productId: string;
  readonly environment: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  /** Resolved out-of-band; NEVER persisted in Git or in the Core database. */
  readonly secret: string;
}

/** Build a signed governed envelope for the real Core boundary. */
export function buildGovernedEnvelope(input: BuildGovernedEnvelopeInput): GovernedRequest {
  const base: GovernedRequestFields = {
    apiVersion: input.apiVersion,
    tenantId: input.tenantId,
    serviceIdentityId: input.serviceIdentityId,
    productId: input.productId,
    environment: input.environment,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    requestId: input.requestId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payloadHash: hashPayload(input.payload),
  };
  return { ...base, signature: computeRequestSignature(base, input.secret) };
}

const NONCE_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export interface EnvelopeValidation {
  readonly ok: boolean;
  readonly code?: string;
}

/** Structural validation mirroring the Core's fail-closed envelope checks. */
export function validateGovernedEnvelope(envelope: unknown): EnvelopeValidation {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, code: 'VALIDATION_FAILED' };
  }
  const e = envelope as Record<string, unknown>;
  for (const field of [...SIGNED_FIELDS, 'signature']) {
    if (e[field] === undefined || e[field] === null || e[field] === '') {
      return { ok: false, code: 'VALIDATION_FAILED' };
    }
  }
  if (typeof e['timestamp'] !== 'number' || !Number.isFinite(e['timestamp'])) {
    return { ok: false, code: 'VALIDATION_FAILED' };
  }
  if (typeof e['nonce'] !== 'string' || !NONCE_PATTERN.test(e['nonce'])) {
    return { ok: false, code: 'VALIDATION_FAILED' };
  }
  if (typeof e['correlationId'] !== 'string' || !ID_PATTERN.test(e['correlationId'])) {
    return { ok: false, code: 'VALIDATION_FAILED' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scope mapping — the Hub transports its least-privilege vocabulary; the Core
// authorizes against its OWN scopes. Mappings are consumed from the registry.
// ---------------------------------------------------------------------------
export function mapHubScopesToCoreScopes(
  hubScopes: readonly string[],
  registry: ScopeRegistry,
): readonly string[] {
  const out = new Set<string>();
  for (const scope of hubScopes) {
    const mapped = registry.hubScopeToCoreScopes[scope];
    if (!mapped) {
      // Fail closed: an unmapped Hub scope is never silently widened.
      throw new Error(`hub scope "${scope}" has no Core scope mapping`);
    }
    for (const core of mapped) out.add(core);
  }
  return Object.freeze([...out].sort());
}

// ---------------------------------------------------------------------------
// Failure taxonomy — bounded, closed. Unknown codes fail closed to
// INTERNAL_FAILURE. Raw internal error text is never surfaced.
// ---------------------------------------------------------------------------
export function classifyCoreFailure(code: string, taxonomy: FailureTaxonomy): FailureCodeEntry {
  const found = taxonomy.codes.find((entry) => entry.code === code);
  if (found) return found;
  const fallback = taxonomy.codes.find((entry) => entry.code === 'INTERNAL_FAILURE');
  if (!fallback) throw new Error('failure taxonomy is missing the INTERNAL_FAILURE fallback');
  return fallback;
}

// ---------------------------------------------------------------------------
// Version negotiation — unsupported versions fail closed. No silent downgrade.
// ---------------------------------------------------------------------------
export type VersionNegotiationResult =
  | { readonly ok: true; readonly apiVersion: string }
  | { readonly ok: false; readonly code: string };

export function negotiateApiVersion(
  requested: string | undefined,
  registry: VersionNegotiation,
): VersionNegotiationResult {
  if (typeof requested !== 'string' || requested.length === 0) {
    return { ok: false, code: registry.unsupportedCode };
  }
  if (registry.supportedApiVersions.includes(requested)) {
    return { ok: true, apiVersion: requested };
  }
  const mapped = registry.wireToCoreVersion[requested];
  if (mapped !== undefined && registry.supportedApiVersions.includes(mapped)) {
    return { ok: true, apiVersion: mapped };
  }
  return { ok: false, code: registry.unsupportedCode };
}

// ---------------------------------------------------------------------------
// Production identity / onboarding — APPROVED != ACTIVE, PROVISIONED != VERIFIED,
// VERIFIED != CERTIFIED. Only ACTIVE onboarding produces consumable traffic.
// ---------------------------------------------------------------------------
export const ONBOARDING_STATES = Object.freeze([
  'PROPOSED',
  'REVIEWED',
  'APPROVED',
  'PROVISIONED',
  'VERIFIED',
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
  'REJECTED',
] as const);
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const ONBOARDING_INVARIANTS = Object.freeze([
  'APPROVED != ACTIVE',
  'PROVISIONED != VERIFIED',
  'VERIFIED != CERTIFIED',
] as const);

export function producesConsumableTraffic(state: string): boolean {
  return state === 'ACTIVE';
}

/** Fail closed unless onboarding is ACTIVE. Transport success is not authorization. */
export function assertConsumableTraffic(state: string): void {
  if (!producesConsumableTraffic(state)) {
    throw new Error(
      `onboarding state ${state} does not produce consumable traffic (only ACTIVE does)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Legal-change transport — FSTS-COMPLIANCE-CORE-API-HUB::LEGAL-CHANGE-TRANSPORT
// v1.0.0. TRANSPORT-ONLY: a notification is a SIGNAL, never an INSTRUCTION.
// ---------------------------------------------------------------------------
export const LEGAL_CHANGE_TRANSPORT_CONTRACT = Object.freeze({
  id: 'FSTS-COMPLIANCE-CORE-API-HUB::LEGAL-CHANGE-TRANSPORT',
  version: '1.0.0',
  direction: 'OUTBOUND',
  transportOnly: true,
  carriesComplianceAuthority: false,
} as const);

export const LEGAL_CHANGE_NOTIFICATION_KINDS = Object.freeze([
  'LEGAL_CHANGE_DETECTED',
  'LEGAL_CHANGE_REVIEW_REQUIRED',
  'LEGAL_CHANGE_REVIEW_RESOLVED',
  'LEGAL_CHANGE_CANONICAL_UPDATE_APPROVED',
  'LEGAL_CHANGE_APPLICABILITY_RAISED',
  'LEGAL_CHANGE_IMPACT_PROPOSED',
  'LEGAL_CHANGE_WITHDRAWN',
  'LEGAL_CHANGE_SUPERSEDED',
  'LEGAL_CHANGE_HISTORICAL',
] as const);

export const LEGAL_CHANGE_PIPELINE_STAGES = Object.freeze([
  'DETECTED',
  'REVIEW_REQUIRED',
  'HUMAN_LEGAL_REVIEW',
  'APPROVED_CANONICAL_UPDATE',
  'APPLICABILITY_REVIEW',
  'CONTROL_POLICY_IMPACT_REVIEW',
] as const);

export const FORBIDDEN_AUTHORITY_FIELDS = Object.freeze([
  'enforcement',
  'enforce',
  'enforcementChange',
  'controlActivation',
  'activateControl',
  'productBehaviorChange',
  'applyChange',
  'applied',
  'canonicalRewrite',
  'autoApply',
  'autoEnforce',
  'complianceState',
  'authoritativeState',
  'override',
  'bypass',
] as const);

const CORE_OPERATION_BY_NOTIFICATION: Readonly<Record<string, string>> = Object.freeze({
  LEGAL_CHANGE_DETECTED: 'legal-change-candidate.create',
  LEGAL_CHANGE_REVIEW_REQUIRED: 'legal-change-review.open',
  LEGAL_CHANGE_REVIEW_RESOLVED: 'legal-change-review.resolve',
  LEGAL_CHANGE_CANONICAL_UPDATE_APPROVED: 'legal-canonical-update.get',
  LEGAL_CHANGE_APPLICABILITY_RAISED: 'legal-applicability-trigger.get',
  LEGAL_CHANGE_IMPACT_PROPOSED: 'legal-impact-proposal.get',
  LEGAL_CHANGE_WITHDRAWN: 'legal-withdrawal.get',
  LEGAL_CHANGE_SUPERSEDED: 'legal-source-supersession.propose',
  LEGAL_CHANGE_HISTORICAL: 'legal-historical-state.get',
});

export interface LegalChangeNotification {
  readonly notificationId: string;
  readonly kind: string;
  readonly changeRef: string;
  readonly sourceId: string;
  readonly jurisdictionId: string;
  readonly issuedAt: number;
  readonly correlationId: string;
  readonly transportOnly: true;
  readonly carriesComplianceAuthority: false;
  readonly authoritative: false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertNoComplianceStateAuthority(notification: unknown): true {
  if (!isPlainObject(notification)) {
    throw new Error('legal-change notification must be a plain object');
  }
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    const value = notification[field];
    if (value !== undefined && value !== null) {
      throw new Error(
        `legal-change notification must not carry "${field}" (no raw authority to alter compliance state)`,
      );
    }
  }
  return true;
}

export function assertTransportOnlyNotification(notification: unknown): true {
  if (!isPlainObject(notification)) {
    throw new Error('legal-change notification must be a plain object');
  }
  if (notification['transportOnly'] !== true) {
    throw new Error('legal-change notification must be marked transportOnly=true');
  }
  if (notification['carriesComplianceAuthority'] !== false) {
    throw new Error('legal-change notification must not carry compliance authority');
  }
  if (notification['authoritative'] === true) {
    throw new Error('a legal-change notification is never authoritative');
  }
  return assertNoComplianceStateAuthority(notification);
}

export function coreOperationForNotification(kind: string): string {
  const operation = CORE_OPERATION_BY_NOTIFICATION[kind];
  if (operation === undefined) {
    throw new Error(`no governed Core operation for notification kind ${kind}`);
  }
  return operation;
}

/** A notification must be acted on ONLY through the governed Core legal API. */
export function assertNotificationRequiresCoreGovernance(
  notification: unknown,
  action: string,
): true {
  assertTransportOnlyNotification(notification);
  const kind = (notification as Record<string, unknown>)['kind'];
  if (typeof kind !== 'string') throw new Error('legal-change notification kind must be a string');
  const required = coreOperationForNotification(kind);
  if (action !== required) {
    throw new Error(
      `a legal-change notification must be acted on through the governed Core legal API (${required})`,
    );
  }
  return true;
}

export function buildLegalChangeNotification(input: {
  readonly kind: string;
  readonly changeRef: string;
  readonly sourceId: string;
  readonly jurisdictionId: string;
  readonly issuedAt?: number;
  readonly correlationId?: string;
}): LegalChangeNotification {
  if (!LEGAL_CHANGE_NOTIFICATION_KINDS.includes(input.kind as never)) {
    throw new Error(`kind must be one of ${LEGAL_CHANGE_NOTIFICATION_KINDS.join(', ')}`);
  }
  const issuedAt = input.issuedAt ?? 0;
  const correlationId =
    input.correlationId ??
    sha256Hex(canonicalize({ kind: input.kind, changeRef: input.changeRef })).slice(0, 32);
  const notification: LegalChangeNotification = {
    notificationId: sha256Hex(
      canonicalize({
        kind: input.kind,
        changeRef: input.changeRef,
        sourceId: input.sourceId,
        jurisdictionId: input.jurisdictionId,
        correlationId,
      }),
    ).slice(0, 32),
    kind: input.kind,
    changeRef: input.changeRef,
    sourceId: input.sourceId,
    jurisdictionId: input.jurisdictionId,
    issuedAt,
    correlationId,
    transportOnly: true,
    carriesComplianceAuthority: false,
    authoritative: false,
  };
  assertTransportOnlyNotification(notification);
  return Object.freeze(notification);
}

// ---------------------------------------------------------------------------
// Policy delivery / adoption / drift — transport success never manufactures
// authoritative Core states. DRIFTED / ROLLED_BACK are distinct.
// ---------------------------------------------------------------------------
export const POLICY_DELIVERY_STATES = Object.freeze([
  'APPROVED',
  'RELEASED',
  'DISTRIBUTED',
  'RECEIVED',
  'APPLIED',
  'VERIFIED',
  'DRIFTED',
  'ROLLED_BACK',
] as const);

export const POLICY_DELIVERY_INVARIANTS = Object.freeze([
  'APPROVED != RELEASED',
  'RELEASED != ADOPTED',
  'RECEIVED != APPLIED',
] as const);

// States the API Hub may NEVER manufacture from a transport outcome.
const CORE_ONLY_POLICY_STATES = Object.freeze(['RECEIVED', 'APPLIED', 'VERIFIED']);

/**
 * Fail closed if a transport outcome attempts to assert an authoritative Core
 * policy state. Delivery success is transport; adoption is Core authority.
 */
export function assertTransportDoesNotManufactureCoreState(claimedState: string): void {
  if (CORE_ONLY_POLICY_STATES.includes(claimedState as never)) {
    throw new Error(
      `transport must not manufacture authoritative Core policy state "${claimedState}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Health / readiness — HEALTHY != COMPLIANT and READY != CERTIFIED. Both carry
// complianceClaim=NONE and certificationClaim=NONE.
// ---------------------------------------------------------------------------
export interface CoreHealthReport {
  readonly status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  readonly complianceClaim: 'NONE';
  readonly certificationClaim: 'NONE';
}

export interface CoreReadinessReport {
  readonly status: 'READY' | 'NOT_READY';
  readonly complianceClaim: 'NONE';
  readonly certificationClaim: 'NONE';
}

export function buildCoreHealthReport(status: CoreHealthReport['status']): CoreHealthReport {
  return { status, complianceClaim: 'NONE', certificationClaim: 'NONE' };
}

export function buildCoreReadinessReport(
  status: CoreReadinessReport['status'],
): CoreReadinessReport {
  return { status, complianceClaim: 'NONE', certificationClaim: 'NONE' };
}

// ---------------------------------------------------------------------------
// Fail-closed guards.
// ---------------------------------------------------------------------------

/**
 * Assert a source text contains NO direct Compliance Core Convex database path.
 * The API Hub must never import `convex/_generated` or a Convex client to reach
 * the Core database.
 */
export function assertNoDirectCoreDatabaseAccess(sourceText: string): void {
  const forbidden: readonly RegExp[] = [
    /_generated/,
    /from\s+['"]convex/,
    /ConvexHttpClient/,
    /new\s+ConvexReactClient/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(sourceText)) {
      throw new Error(`direct Compliance Core Convex database access is forbidden (${pattern})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Transport result + adapter interface (transport-only; never decides compliance).
// ---------------------------------------------------------------------------
export type TransportResult =
  | { readonly ok: true; readonly body: string; readonly correlationId: string }
  | { readonly ok: false; readonly error: ApiError; readonly retryable: boolean };

export interface TransportHealth {
  readonly status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly killSwitchEngaged: boolean;
  readonly contractVersion: string | null;
}

export interface ComplianceCoreTransport {
  /** Forward a signed governed request; return a bounded response or bounded failure. */
  forward(signed: GovernedRequest, governedBody: string): Promise<TransportResult>;
  /** Connector health for the Compliance Core connection. */
  health(): Promise<TransportHealth>;
}

// ---------------------------------------------------------------------------
// Governed dispatch boundary \u2014 the single choke point that enforces the Hub's
// onboarding routing gate BEFORE any transport to the Compliance Core.
//
// The Hub transports; the Core decides. This boundary makes the routing gate
// MANDATORY: a request that is not explicitly ALLOWED by the server-derived
// routing gate is never forwarded, and a transport outcome is never turned into
// a compliance verdict. `routing` is a transport-owned concern (see
// TRANSPORT_OWNED_CONCERNS), so the gate is composed here rather than
// re-implemented.
// ---------------------------------------------------------------------------

/** The resolved route an ALLOW carries (authority-bearing fields only). */
export interface RoutingRoute {
  readonly productId: string;
  readonly tenantId: string;
  readonly environment: string;
  readonly hubRoutingIdentity: string;
  readonly operation: string;
  readonly scope: string;
  readonly contractVersion: string;
  readonly apiVersion: string;
  readonly credentialReference: string;
}

/** The request the Hub asks the routing gate to decide. */
export interface RoutingGateRequest {
  readonly productId: string;
  readonly tenantId: string;
  readonly environment: string;
  readonly hubRoutingIdentity: string;
  readonly operation: string;
  readonly scope: string;
  readonly contractVersion: string;
  readonly apiVersion: string;
}

export type RoutingDecision =
  | { readonly allowed: true; readonly route: RoutingRoute }
  | { readonly allowed: false; readonly code: string };

/**
 * The server-derived routing gate. In production this is the Hub's Convex
 * `productOnboardings.route` internal query, which loads the onboarding from
 * durable server-side records and enforces the caller's service scope. It is
 * injected so the dispatch boundary never re-implements the decision.
 */
export type RoutingGate = (request: RoutingGateRequest) => Promise<RoutingDecision>;

export interface GovernedDispatchInput {
  readonly request: RoutingGateRequest;
  /** The signed governed envelope forwarded to the Core. */
  readonly signed: GovernedRequest;
  /** The governed body (canonical serialization of the payload). */
  readonly governedBody: string;
}

export type GovernedDispatchResult =
  | {
      readonly dispatched: true;
      /** The bounded transport result. Never a compliance verdict. */
      readonly transport: TransportResult;
      readonly correlationId: string;
    }
  | { readonly dispatched: false; readonly code: string };

export interface GovernedDispatcher {
  dispatch(input: GovernedDispatchInput): Promise<GovernedDispatchResult>;
}

/**
 * Build the governed dispatch boundary. `dispatch` consults the routing gate
 * first and forwards to the transport ONLY on an explicit ALLOW whose resolved
 * route matches the signed envelope on the authority-bearing isolation
 * dimensions (product, tenant, environment). Every denial short-circuits before
 * any transport call, so a governed request can never bypass onboarding or
 * authorization.
 */
export function createGovernedDispatcher(deps: {
  readonly gate: RoutingGate;
  readonly transport: ComplianceCoreTransport;
}): GovernedDispatcher {
  return {
    async dispatch(input: GovernedDispatchInput): Promise<GovernedDispatchResult> {
      let decision: RoutingDecision;
      try {
        decision = await deps.gate(input.request);
      } catch {
        // A gate that cannot produce a decision fails closed: never forward.
        return { dispatched: false, code: 'ROUTING_GATE_ERROR' };
      }
      if (!decision.allowed) {
        // Fail closed: the transport is never touched on a denial.
        return { dispatched: false, code: decision.code };
      }
      // Defense in depth: the resolved route must match the signed envelope on
      // every authority-bearing isolation dimension. A gate that allowed a
      // different product/tenant/environment than the envelope carries is a
      // mismatch and fails closed.
      const route = decision.route;
      const signed = input.signed;
      if (
        route.productId !== signed.productId ||
        route.tenantId !== signed.tenantId ||
        route.environment !== signed.environment
      ) {
        return { dispatched: false, code: 'ROUTE_ENVELOPE_MISMATCH' };
      }
      const transport = await deps.transport.forward(signed, input.governedBody);
      return { dispatched: true, transport, correlationId: signed.correlationId };
    },
  };
}
