// FSTS Compliance Core — Phase 7 (Chat 4) — API HUB LEGAL-CHANGE TRANSPORT.
//
// LEGAL-CHANGE NOTIFICATION / TRANSPORT CONTRACT.
//
// The API Hub transports legal-change NOTIFICATIONS only. It carries NO raw
// authority to alter compliance state. The Compliance Core retains the
// AUTHORITATIVE legal governance state; a product that receives a legal-change
// notification MUST NOT change its compliance state from the notification — it
// must go THROUGH the governed Core legal API (convex/legalApi.ts ->
// runLegalGovernedOperation), which authenticates, authorizes, resolves the
// tenant server-side, and records correlated audit.
//
// HARD RULES (never weakened):
//   * A legal-change notification is a SIGNAL, never an INSTRUCTION.
//   * No notification carries enforcement / control-activation / product-
//     behavior / canonical-rewrite authority.
//   * A product never receives raw authority to alter compliance state from an
//     API Hub legal-change event.
//   * The Hub transports; the Core decides.
//
// TRANSPORT-ONLY (locked): this module is the API HUB TRANSPORT-side reference
// implementation of the legal-change notification contract. It does NOT replace,
// duplicate, weaken, or bypass the Core's authoritative legal governance state.
// ---------------------------------------------------------------------------

export const TRANSPORT_ONLY = true;
export const TRANSPORT_ROLE = 'API_HUB_TRANSPORT_REFERENCE';

import { sha256Of } from './hash.mjs';

// The legal-change notification KINDS the Hub may transport. Each corresponds to
// a governed pipeline stage or terminal outcome; none is an enforcement action.
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
]);

// The transport contract statement (surfaced to consumers as the guarantee).
export const LEGAL_CHANGE_TRANSPORT_CONTRACT = Object.freeze({
  id: 'FSTS-COMPLIANCE-CORE-API-HUB::LEGAL-CHANGE-TRANSPORT',
  version: '1.0.0',
  direction: 'OUTBOUND',
  transportOnly: true,
  carriesComplianceAuthority: false,
  statement:
    'The API Hub transports legal-change notifications only. It carries no raw authority to alter compliance state; the Compliance Core retains authoritative legal governance state and every state change flows through the governed Core legal API.',
});

// Fields a notification MUST NOT carry. Any of these would be an attempt to
// smuggle compliance-state authority through the transport boundary.
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
]);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function requireKind(value) {
  if (typeof value !== 'string' || !LEGAL_CHANGE_NOTIFICATION_KINDS.includes(value)) {
    throw new Error(`kind must be one of ${LEGAL_CHANGE_NOTIFICATION_KINDS.join(', ')}`);
  }
  return value;
}

/**
 * Build a TRANSPORT-ONLY legal-change notification. The notification id is
 * DERIVED deterministically from stable inputs (no wall clock, no randomness).
 * The notification carries NO compliance-state authority.
 */
export function buildLegalChangeNotification(input = {}) {
  const kind = requireKind(input.kind);
  const changeRef = requireNonEmptyString(input.changeRef, 'changeRef');
  const sourceId = requireNonEmptyString(input.sourceId, 'sourceId');
  const jurisdictionId = requireNonEmptyString(input.jurisdictionId, 'jurisdictionId');
  const issuedAt = typeof input.issuedAt === 'number' ? input.issuedAt : 0;
  const correlationId =
    typeof input.correlationId === 'string' && input.correlationId.length > 0
      ? input.correlationId
      : sha256Of({ kind, changeRef, sourceId, jurisdictionId, issuedAt }).slice(0, 32);

  const notification = {
    notificationId: sha256Of({ kind, changeRef, sourceId, jurisdictionId, correlationId }).slice(0, 32),
    kind,
    changeRef,
    sourceId,
    jurisdictionId,
    authorityTier: input.authorityTier ?? null,
    stage: input.stage ?? null,
    issuedAt,
    correlationId,
    // Transport-only markers — a notification is a SIGNAL, never an INSTRUCTION.
    transportOnly: true,
    carriesComplianceAuthority: false,
    authoritative: false,
  };
  assertTransportOnlyNotification(notification);
  return Object.freeze(notification);
}

/**
 * Assert a notification is transport-only and carries no compliance-state
 * authority. Throws (fail-closed) otherwise.
 */
export function assertTransportOnlyNotification(notification) {
  if (!isPlainObject(notification)) {
    throw new Error('legal-change notification must be a plain object');
  }
  if (notification.transportOnly !== true) {
    throw new Error('legal-change notification must be marked transportOnly=true');
  }
  if (notification.carriesComplianceAuthority !== false) {
    throw new Error('legal-change notification must not carry compliance authority');
  }
  if (notification.authoritative === true) {
    throw new Error('a legal-change notification is never authoritative');
  }
  assertNoComplianceStateAuthority(notification);
  return true;
}

/**
 * Assert a notification carries no field that could alter compliance state.
 * This is the boundary guard: a product can never receive raw authority to
 * alter compliance state from a legal-change event.
 */
export function assertNoComplianceStateAuthority(notification) {
  if (!isPlainObject(notification)) {
    throw new Error('legal-change notification must be a plain object');
  }
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (field in notification && notification[field] !== null && notification[field] !== undefined) {
      throw new Error(
        `legal-change notification must not carry "${field}" (no raw authority to alter compliance state)`,
      );
    }
  }
  return true;
}

/**
 * Assert a consumer must apply a notification ONLY through the governed Core
 * legal API — never directly. Returns the governed Core operation a consumer
 * must call to act on the signal (fail-closed: unknown kind has no path).
 */
export function coreOperationForNotification(kind) {
  const map = {
    LEGAL_CHANGE_DETECTED: 'legal-change-candidate.create',
    LEGAL_CHANGE_REVIEW_REQUIRED: 'legal-change-review.open',
    LEGAL_CHANGE_REVIEW_RESOLVED: 'legal-change-review.resolve',
    LEGAL_CHANGE_CANONICAL_UPDATE_APPROVED: 'legal-canonical-update.get',
    LEGAL_CHANGE_APPLICABILITY_RAISED: 'legal-applicability-trigger.get',
    LEGAL_CHANGE_IMPACT_PROPOSED: 'legal-impact-proposal.get',
    LEGAL_CHANGE_WITHDRAWN: 'legal-withdrawal.get',
    LEGAL_CHANGE_SUPERSEDED: 'legal-source-supersession.propose',
    LEGAL_CHANGE_HISTORICAL: 'legal-historical-state.get',
  };
  const operation = map[kind];
  if (!operation) {
    throw new Error(`no governed Core operation for notification kind ${String(kind)}`);
  }
  return operation;
}

/**
 * Assert that a product acting on a notification does so through the governed
 * Core legal API. `action` must be the governed Core operation id.
 */
export function assertNotificationRequiresCoreGovernance(notification, action) {
  assertTransportOnlyNotification(notification);
  const required = coreOperationForNotification(notification.kind);
  if (action !== required) {
    throw new Error(
      `a legal-change notification must be acted on through the governed Core legal API (${required})`,
    );
  }
  return true;
}

// Deterministic digest of the transport contract — lets consumers detect drift.
export function legalChangeTransportFingerprint() {
  const lines = LEGAL_CHANGE_NOTIFICATION_KINDS.map((k) => `${k}->${coreOperationForNotification(k)}`);
  return `${LEGAL_CHANGE_TRANSPORT_CONTRACT.version}::${lines.join(';')}`;
}
