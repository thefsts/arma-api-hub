// FSTS Compliance Core — Phase 6
// API Hub Contract — authenticated service-to-service exchange.
// ---------------------------------------------------------------------------
// Service identities are least-privilege and product-bound. Authorization is
// evaluated server-side against the registered identity — never against a
// client-supplied claim. Cross-tenant and cross-product access are denied by
// construction. The credential itself is NEVER stored: only a reference (name)
// and a digest of the presented secret. Signature verification uses a key
// injected at call time.
//
// TRANSPORT-ONLY (locked): this module is the API HUB TRANSPORT-side reference
// implementation of authenticated service-to-service exchange. It is NOT the
// authoritative Compliance Core authorization engine and does NOT replace,
// duplicate, weaken, or bypass the Chat 1 governed pipeline's service-identity
// authentication + authorization (convex/lib/apiPipeline.ts). The Hub
// transports; the Core decides.
// ---------------------------------------------------------------------------

export const TRANSPORT_ONLY = true;
export const TRANSPORT_ROLE = 'API_HUB_TRANSPORT_REFERENCE';

import { ACTION_SCOPES, SERVICE_IDENTITY_STATUSES } from './constants.mjs';
import { hmacSha256, digestEquals, sha256OfText } from './hash.mjs';

/**
 * Build a service identity record (metadata only). `credentialDigest` is the
 * SHA-256 of the presented secret — never the secret. `credentialReference` is
 * a NAME (env var / secret-store path), never a value.
 */
export function buildServiceIdentity(input) {
  return {
    serviceIdentityId: input.serviceIdentityId,
    tenantId: input.tenantId,
    productId: input.productId,
    status: input.status ?? 'ACTIVE',
    scopes: Array.isArray(input.scopes) ? [...input.scopes].sort() : [],
    credentialReference: input.credentialReference ?? null,
    credentialDigest: input.credentialDigest ?? null,
    issuedAt: input.issuedAt ?? null,
    expiresAt: input.expiresAt ?? null,
  };
}

/** Canonical signing material: the envelope minus its own signature fields. */
export function signingMaterial(envelope) {
  const clone = {};
  for (const key of Object.keys(envelope)) {
    if (key === 'signatureDigest' || key === 'signatureReference' || key === 'signatureAlgorithm') continue;
    clone[key] = envelope[key];
  }
  return clone;
}

/**
 * Authenticate + authorize an inbound envelope. Returns a bounded decision:
 *   { ok: true, identity, scope }
 *   { ok: false, code }
 * `now` is explicit (no wall clock). `signingKey` is injected at call time.
 */
export function authenticate({ envelope, identities, presentedCredential, signingKey, now }) {
  const list = Array.isArray(identities) ? identities : [];

  // 1. Credential presence.
  if (typeof presentedCredential !== 'string' || presentedCredential.length === 0) {
    return { ok: false, code: 'AUTH_MISSING_CREDENTIAL' };
  }

  // 2. Identity lookup by the claimed service identity id.
  const identity = list.find((i) => i && i.serviceIdentityId === envelope.serviceIdentityId) ?? null;
  if (!identity) {
    return { ok: false, code: 'AUTH_INVALID_CREDENTIAL' };
  }

  // 3. Credential digest match (constant-time-ish).
  const presentedDigest = sha256OfText(presentedCredential);
  if (!identity.credentialDigest || !digestEquals(presentedDigest, identity.credentialDigest)) {
    return { ok: false, code: 'AUTH_INVALID_CREDENTIAL' };
  }

  // 4. Identity status.
  if (!SERVICE_IDENTITY_STATUSES.includes(identity.status) || identity.status !== 'ACTIVE') {
    return { ok: false, code: 'AUTH_IDENTITY_INACTIVE' };
  }

  // 5. Credential expiry.
  if (typeof identity.expiresAt === 'number' && typeof now === 'number' && now > identity.expiresAt) {
    return { ok: false, code: 'AUTH_EXPIRED' };
  }

  // 6. Signature verification (key injected at call time; never stored).
  if (typeof signingKey === 'string' && signingKey.length > 0 && envelope.signatureDigest) {
    const expected = hmacSha256(signingKey, signingMaterial(envelope));
    if (!digestEquals(expected, envelope.signatureDigest)) {
      return { ok: false, code: 'AUTH_SIGNATURE_INVALID' };
    }
  } else if (envelope.signatureDigest) {
    // A signature was presented but no key is available to verify it: fail closed.
    return { ok: false, code: 'AUTH_SIGNATURE_INVALID' };
  }

  // 7. Tenant binding (cross-tenant denied by construction).
  if (identity.tenantId !== envelope.tenantId) {
    return { ok: false, code: 'TENANT_MISMATCH' };
  }

  // 8. Product binding (cross-product denied by construction).
  if (identity.productId !== envelope.productId) {
    return { ok: false, code: 'PRODUCT_MISMATCH' };
  }

  // 9. Scope escalation: a request may not assert scopes beyond the identity.
  const asserted = Array.isArray(envelope.claimedScopes) ? envelope.claimedScopes : [];
  const escalation = asserted.find((s) => !identity.scopes.includes(s));
  if (escalation) {
    return { ok: false, code: 'SCOPE_ESCALATION_DENIED' };
  }

  // 10. Action scope requirement.
  const requiredScope = ACTION_SCOPES[envelope.action];
  if (!requiredScope) {
    return { ok: false, code: 'VALIDATION_UNKNOWN_ACTION' };
  }
  if (!identity.scopes.includes(requiredScope)) {
    return { ok: false, code: 'SCOPE_INSUFFICIENT' };
  }

  return { ok: true, identity, scope: requiredScope };
}

/**
 * A product integration identity must never gain access to another product.
 * Mirrors convex/lib/products.ts assertProductIsolation for the contract layer.
 */
export function assertProductIsolation(identity, targetProductId) {
  const bound = identity && typeof identity.productId === 'string' ? identity.productId : null;
  if (bound === null || bound !== targetProductId) {
    return { ok: false, code: 'PRODUCT_MISMATCH' };
  }
  return { ok: true, code: null };
}
