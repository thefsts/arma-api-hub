// FSTS Compliance Core — Phase 6
// API Hub Contract — audit linkage.
// ---------------------------------------------------------------------------
// Every governed exchange must produce an audit linkage: an auditEventId tied
// to the correlation id and request id. An exchange that cannot be audited must
// NOT silently succeed — an audit gap fails closed (AUDIT_GAP).
// ---------------------------------------------------------------------------

import { sha256Of } from './hash.mjs';

/** Derive a deterministic audit event id from the exchange identity. */
export function deriveAuditEventId({ correlationId, requestId, action }) {
  const hex = sha256Of({ correlationId, requestId, action });
  return `AUD-${hex.slice(0, 24)}`;
}

/**
 * Build an audit linkage record for a governed exchange. This is metadata that
 * the Convex audit ledger (Chat 1-owned) persists; it is never a rewrite of a
 * historical audit record.
 */
export function buildAuditLinkage({ envelope, response, now }) {
  const auditEventId = deriveAuditEventId({
    correlationId: envelope.correlationId,
    requestId: envelope.requestId,
    action: envelope.action,
  });
  return {
    auditEventId,
    tenantId: envelope.tenantId,
    serviceIdentityId: envelope.serviceIdentityId,
    action: envelope.action,
    resourceType: 'apiHubExchange',
    resourceId: envelope.requestId,
    correlationId: envelope.correlationId,
    requestId: envelope.requestId,
    status: response.status,
    failureCode: response.failureCode ?? null,
    timestamp: now,
    source: 'packages/api-hub-contract',
  };
}

/**
 * Verify audit linkage completeness for a set of exchanges. An exchange with no
 * linkage is an AUDIT_GAP. Returns { ok, gaps }.
 */
export function verifyAuditLinkage({ exchanges, linkages }) {
  const links = Array.isArray(linkages) ? linkages : [];
  const linkedRequestIds = new Set(links.map((l) => l && l.requestId));
  const gaps = (Array.isArray(exchanges) ? exchanges : [])
    .filter((e) => e && !linkedRequestIds.has(e.requestId))
    .map((e) => e.requestId);
  return { ok: gaps.length === 0, gaps };
}
