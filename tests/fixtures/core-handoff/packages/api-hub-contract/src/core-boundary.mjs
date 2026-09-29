// FSTS Compliance Core — Phase 6 (Chat 5) — API HUB TRANSPORT CONTRACT.
//
// CORE BOUNDARY ADAPTER.
//
// This module does NOT implement a Compliance Core authentication,
// authorization, idempotency, audit, or tenancy engine. It is a thin adapter
// that CONSUMES the AUTHORITATIVE Chat 1 governed pipeline
// (`convex/lib/apiPipeline.ts` -> `runGovernedPipeline`) so that the API Hub
// transport contract can certify against the REAL integrated boundary rather
// than a simulated parallel one.
//
// Ownership (locked):
//   COMPLIANCE CORE decides  — authority/state, applicability, controls,
//                              verification, evidence metadata, policy/legal
//                              governance, release/adoption state, drift,
//                              rollback, Core authorization, Core idempotency,
//                              Core audit linkage.
//   ARMA API HUB transports  — external transport, connectors, webhooks,
//                              delivery, retry execution, external/vendor rate
//                              limits, quotas, vendor/API usage & cost
//                              telemetry transport.
//
// The Hub transports. The Core decides. A transport outcome is NEVER a
// compliance verdict.

import { runGovernedPipeline, IDEMPOTENCY_SCOPE_API } from '../../../convex/lib/apiPipeline.ts';
import {
  hashPayload,
  computeRequestSignature,
  validateRequestEnvelope,
  verifyRequestIntegrity,
} from '../../../convex/lib/apiRequest.ts';
import { assertVersionCompatible, CURRENT_API_VERSION } from '../../../convex/lib/apiVersion.ts';
import { toApiError, API_ERROR_CODES } from '../../../convex/lib/apiErrors.ts';

export const CORE_NOW = 1_700_000_000_000;
export const CORE_SECRET = 'reference-api-hub-secret';
export const CORE_IDEMPOTENCY_SCOPE = IDEMPOTENCY_SCOPE_API;

// The governed contract used by the certification harness. A read-scope action
// so the SERVICE_IDENTITY role is authorized by default (mirrors the Chat 3
// convergence harness). `api:invoke` is the Chat 1 default governed scope.
export const CORE_CONTRACT = Object.freeze({
  contractId: 'v1::compliance.verify',
  apiVersion: 'v1',
  action: 'compliance.verify',
  method: 'POST',
  resourceType: 'verificationExecution',
  status: 'ACTIVE',
  requiredScope: 'api:invoke',
  allowedEnvironments: ['PROD'],
  rateLimit: 600,
  rateWindowMs: 60000,
});

export const CORE_BASE = Object.freeze({
  tenantId: 'SYNTH-TENANT-A',
  serviceIdentityId: 'SVC-EXAMPLE-0001',
  productId: 'SYNTH-PRODUCT-A',
  principalId: 'PR-EXAMPLE-0001',
  environment: 'PROD',
});

// A signed governed envelope for the REAL Core boundary. Callers may override
// any field; the signature is (re)computed over the canonical signed fields so
// tampering must be requested explicitly via `over.tamper`.
export function coreEnvelope(over = {}) {
  const payload = over.payload ?? { asOf: '2026-09-16', resourceId: over.resourceId ?? 'RES-1' };
  const base = {
    apiVersion: over.apiVersion ?? 'v1',
    tenantId: over.tenantId ?? CORE_BASE.tenantId,
    serviceIdentityId: over.serviceIdentityId ?? CORE_BASE.serviceIdentityId,
    productId: over.productId ?? CORE_BASE.productId,
    environment: over.environment ?? CORE_BASE.environment,
    action: over.action ?? CORE_CONTRACT.action,
    resourceType: over.resourceType ?? CORE_CONTRACT.resourceType,
    resourceId: over.resourceId ?? 'RES-1',
    timestamp: over.timestamp ?? CORE_NOW,
    nonce: over.nonce ?? 'nonce-0123456789abcdef',
    requestId: over.requestId ?? 'req-00000001',
    correlationId: over.correlationId ?? 'corr-0000001',
    idempotencyKey: over.idempotencyKey ?? 'idem-0000001',
    payloadHash: hashPayload(payload),
    payload,
  };
  const secret = over.secret ?? CORE_SECRET;
  base.signature = computeRequestSignature(base, secret);
  if (over.tamper) {
    // Deliberately corrupt a signed field AFTER signing.
    base[over.tamper] = over.tamperValue ?? '__tampered__';
  }
  if (over.dropField) delete base[over.dropField];
  return base;
}

// In-memory ports mirroring convex/apiService.ts wiring. The Core decides; the
// Hub only supplies the transport-side port implementations.
export function makeCorePorts(over = {}) {
  const store = { nonces: new Map(), idem: new Map(), rl: new Map(), audit: [] };
  const identity = {
    serviceIdentityId: CORE_BASE.serviceIdentityId,
    tenantId: CORE_BASE.tenantId,
    productId: CORE_BASE.productId,
    principalId: CORE_BASE.principalId,
    scope: 'api:invoke',
    status: 'ACTIVE',
    ...(over.identity ?? {}),
  };
  const principal = { principalId: CORE_BASE.principalId, kind: 'SERVICE', status: 'ACTIVE', ...(over.principal ?? {}) };
  const memberships = over.memberships ?? [{ tenantId: CORE_BASE.tenantId, principalId: CORE_BASE.principalId, status: 'ACTIVE' }];
  const roles = over.roles ?? [{ role: 'SERVICE_IDENTITY', status: 'ACTIVE', scopeType: 'TENANT', scopeId: CORE_BASE.tenantId }];
  const contract = over.contract === null ? null : { ...CORE_CONTRACT, ...(over.contract ?? {}) };
  const ports = {
    now: () => over.now ?? CORE_NOW,
    loadServiceIdentity: async () => identity,
    loadPrincipal: async () => principal,
    loadMemberships: async () => memberships,
    loadRoleAssignments: async () => roles,
    loadContract: async () => contract,
    resolveSecret: async () => (over.secret === null ? null : (over.secret ?? CORE_SECRET)),
    getNonce: async (t, s, n) => store.nonces.get(`${t}::${s}::${n}`) ?? null,
    putNonce: async (r) => store.nonces.set(`${r.tenantId}::${r.serviceIdentityId}::${r.nonce}`, { requestHash: r.requestHash }),
    getIdempotency: async (t, s, k) => store.idem.get(`${t}::${s}::${k}`) ?? null,
    putIdempotency: async (r) => store.idem.set(`${r.tenantId}::${r.scope}::${r.idempotencyKey}`, { requestHash: r.requestHash, status: r.status, resultRef: r.resultRef }),
    getRateCount: async (b) => store.rl.get(b) ?? 0,
    bumpRateCount: async (b) => store.rl.set(b, (store.rl.get(b) ?? 0) + 1),
    appendAudit: async (e) => store.audit.push(e),
    dispatch: async (req) => ({ acknowledged: true, action: req.action, resourceId: req.resourceId }),
    ...(over.ports ?? {}),
  };
  return { store, ports, identity, principal };
}

// Run a governed request through the REAL Chat 1 boundary. Returns a bounded
// outcome (never throws for expected rejections): `{ ok, code?, outcome? }`.
//
// `over.ports` may carry a PRE-BUILT ports object (from `makeCorePorts`) so a
// caller can persist nonce/idempotency/rate state across calls (replay,
// idempotency-conflict, rate-limit scenarios). When omitted, fresh in-memory
// ports are constructed from `over`.
export async function runCoreBoundary(envelope, over = {}) {
  const built = over.ports ? null : makeCorePorts(over);
  const ports = over.ports ?? built.ports;
  const store = over.store ?? built?.store ?? null;
  try {
    const outcome = await runGovernedPipeline(envelope, ports);
    return { ok: true, outcome, store, ports };
  } catch (e) {
    const apiErr = toApiError(e);
    return { ok: false, code: apiErr.code, message: apiErr.message, store, ports };
  }
}

// Structural assertion that the API Hub transport contract never re-implements
// the Core boundary. Used by the validator + tests.
export function assertCoreBoundaryConsumed() {
  if (typeof runGovernedPipeline !== 'function') throw new Error('Chat 1 runGovernedPipeline is not consumable');
  if (CURRENT_API_VERSION !== 'v1') throw new Error(`unexpected CURRENT_API_VERSION ${CURRENT_API_VERSION}`);
  if (!Array.isArray(API_ERROR_CODES) || API_ERROR_CODES.length === 0) throw new Error('Chat 1 error taxonomy is empty');
  // Re-exported helpers must be the real Chat 1 implementations.
  if (typeof validateRequestEnvelope !== 'function' || typeof verifyRequestIntegrity !== 'function') {
    throw new Error('Chat 1 request primitives are not consumable');
  }
  return true;
}

export { runGovernedPipeline, hashPayload, computeRequestSignature, validateRequestEnvelope, verifyRequestIntegrity, assertVersionCompatible, toApiError, API_ERROR_CODES, CURRENT_API_VERSION };
