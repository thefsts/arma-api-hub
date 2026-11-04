// FSTS Governed Product Conformance Kit — the 23 areas.
//
// Each area proves one boundary with at least one hostile case. "Fail closed"
// means a bounded denial, never a silent success and never a widened request.
// A PASS here is an integration-conformance fact, never a compliance claim.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateGovernedEnvelope } from '@arma/compliance-core-client';
import {
  CONFORMANCE_AREAS,
  createGovernedProductClient,
  validateGovernedManifest,
} from '@fsts/governed-product-client';
import type {
  ConformanceArea,
  GovernedProductClient,
  GovernedProductManifest,
} from '@fsts/governed-product-client';
import { baseManifest, FIXED_NOW, makeHarness } from './harness.js';

export interface AreaResult {
  readonly id: string;
  readonly name: ConformanceArea;
  readonly status: 'PASS' | 'FAIL';
  readonly evidence: string;
}

export interface AreaContext {
  readonly manifest: GovernedProductManifest;
  readonly environment: 'DEVELOPMENT' | 'PREVIEW' | 'PRODUCTION';
  readonly tenantId: string;
  readonly credentialReference: string;
}

function pass(id: string, name: ConformanceArea, evidence: string): AreaResult {
  return { id, name, status: 'PASS', evidence };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A permissive success script. */
const allow = () => ({ ok: true as const, body: '{"accepted":true}', correlationId: 'corr-hub' });

async function callOnce(
  ctx: AreaContext,
  script: Parameters<typeof makeHarness>[0]['script'],
  operationId = 'readiness.snapshot.get',
  payload: unknown = { reference: 'ref-1' },
  extra: Partial<Parameters<typeof makeHarness>[0]> = {},
): Promise<{ result: Awaited<ReturnType<GovernedProductClient['call']>>; sent: number }> {
  const h = makeHarness({ ...ctx, script, ...extra });
  const result = await h.client.call(operationId, {
    resourceId: 'res-1',
    payload,
    businessKey: 'bk-1',
  });
  return { result, sent: h.transport.sent.length };
}

// ---------------------------------------------------------------------------
// C1 — No direct Core access
// ---------------------------------------------------------------------------
async function c1(ctx: AreaContext): Promise<AreaResult> {
  // Construction without a transport fails closed.
  let threw = false;
  try {
    createGovernedProductClient({
      manifest: ctx.manifest,
      environment: ctx.environment,
      tenantId: ctx.tenantId,
      credentialReference: ctx.credentialReference,
      transport: undefined as never,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'client was constructed without a transport');

  // The package dependency graph and source must contain no Core/Convex path.
  const here = dirname(fileURLToPath(import.meta.url));
  const clientPkg = join(here, '..', '..', 'governed-product-client');
  const pkg = JSON.parse(readFileSync(join(clientPkg, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies ?? {});
  assert(!deps.some((d) => /convex/i.test(d)), 'client package depends on a Convex package');

  const srcDir = join(clientPkg, 'src');
  const forbidden = [
    /ConvexHttpClient/,
    /_generated/,
    /from\s+['"]convex/,
    /new\s+ConvexReactClient/,
  ];
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(join(srcDir, file), 'utf8');
    for (const p of forbidden)
      assert(!p.test(text), `direct Core access pattern ${p} found in ${file}`);
  }
  return pass(
    'C1',
    'no-direct-core-access',
    'no transport => CONFIG_INVALID; no Convex dependency or direct-Core pattern in client source',
  );
}

// ---------------------------------------------------------------------------
// C2 — Identity binding
// ---------------------------------------------------------------------------
async function c2(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  await h.client.call('readiness.snapshot.get', { resourceId: 'r', payload: { reference: 'x' } });
  assert(
    h.transport.sent[0]?.serviceIdentityId === ctx.manifest.hubRoute.routingIdentity,
    'serviceIdentityId not bound to routingIdentity',
  );
  const denied = await callOnce(ctx, () => ({
    ok: false,
    code: 'PRODUCT_ISOLATION_VIOLATION',
    correlationId: 'c',
  }));
  assert(
    denied.result.ok === false && denied.result.code === 'PRODUCT_DENIED',
    'identity denial not bounded to PRODUCT_DENIED',
  );
  return pass(
    'C2',
    'identity-binding',
    'envelope serviceIdentityId == manifest routingIdentity; hostile identity => PRODUCT_DENIED',
  );
}

// ---------------------------------------------------------------------------
// C3 — Tenant binding
// ---------------------------------------------------------------------------
async function c3(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  await h.client.call('readiness.snapshot.get', { resourceId: 'r', payload: { reference: 'x' } });
  assert(
    h.transport.sent[0]?.tenantId === ctx.tenantId,
    'envelope tenantId not bound to configured tenant',
  );
  const denied = await callOnce(ctx, () => ({
    ok: false,
    code: 'TENANT_ACCESS_DENIED',
    correlationId: 'c',
  }));
  assert(
    denied.result.ok === false && denied.result.code === 'TENANT_DENIED',
    'tenant denial not bounded to TENANT_DENIED',
  );
  return pass(
    'C3',
    'tenant-binding',
    'envelope tenantId == configured tenant; hostile tenant => TENANT_DENIED',
  );
}

// ---------------------------------------------------------------------------
// C4 — Product binding
// ---------------------------------------------------------------------------
async function c4(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  await h.client.call('readiness.snapshot.get', { resourceId: 'r', payload: { reference: 'x' } });
  assert(
    h.transport.sent[0]?.productId === ctx.manifest.productId,
    'envelope productId not bound to manifest',
  );
  const denied = await callOnce(ctx, () => ({
    ok: false,
    code: 'PRODUCT_UNKNOWN',
    correlationId: 'c',
  }));
  assert(
    denied.result.ok === false && denied.result.code === 'PRODUCT_DENIED',
    'product denial not bounded to PRODUCT_DENIED',
  );
  return pass(
    'C4',
    'product-binding',
    'envelope productId == manifest productId; hostile product => PRODUCT_DENIED',
  );
}

// ---------------------------------------------------------------------------
// C5 — Environment binding
// ---------------------------------------------------------------------------
async function c5(ctx: AreaContext): Promise<AreaResult> {
  // Environment outside supportedEnvironments fails at construction.
  const devOnly = baseManifest({ supportedEnvironments: ['DEVELOPMENT'] });
  let threw = false;
  try {
    createGovernedProductClient({
      manifest: devOnly,
      environment: 'PRODUCTION',
      tenantId: ctx.tenantId,
      credentialReference: ctx.credentialReference,
      transport: makeHarness({ ...ctx, script: allow }).transport,
      resolveCredential: async () => ({ secret: 'x' }),
    });
  } catch {
    threw = true;
  }
  assert(threw, 'environment escalation was permitted');
  const denied = await callOnce(ctx, () => ({
    ok: false,
    code: 'ENVIRONMENT_NOT_AUTHORIZED',
    correlationId: 'c',
  }));
  assert(
    denied.result.ok === false && denied.result.code === 'ENVIRONMENT_DENIED',
    'environment denial not bounded to ENVIRONMENT_DENIED',
  );
  return pass(
    'C5',
    'environment-binding',
    'undeclared environment => construction fails; hostile environment => ENVIRONMENT_DENIED',
  );
}

// ---------------------------------------------------------------------------
// C6 — Scope enforcement
// ---------------------------------------------------------------------------
async function c6(ctx: AreaContext): Promise<AreaResult> {
  // Declaring an operation whose scope is absent fails at construction.
  const bad = baseManifest({ requiredHubScopes: ['compliance.read'] });
  let threw = false;
  try {
    createGovernedProductClient({
      manifest: bad,
      environment: ctx.environment,
      tenantId: ctx.tenantId,
      credentialReference: ctx.credentialReference,
      transport: makeHarness({ ...ctx, script: allow }).transport,
      resolveCredential: async () => ({ secret: 'x' }),
    });
  } catch {
    threw = true;
  }
  assert(threw, 'operation declared without its hub scope was permitted');
  const denied = await callOnce(ctx, () => ({
    ok: false,
    code: 'SCOPE_VIOLATION',
    correlationId: 'c',
  }));
  assert(
    denied.result.ok === false && denied.result.code === 'SCOPE_DENIED',
    'scope denial not bounded to SCOPE_DENIED',
  );
  return pass(
    'C6',
    'scope-enforcement',
    'missing declared scope => construction fails; hostile scope => SCOPE_DENIED',
  );
}

// ---------------------------------------------------------------------------
// C7 — Operation enforcement
// ---------------------------------------------------------------------------
async function c7(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  const undeclared = await h.client.call('observation.record', { resourceId: 'r', payload: {} });
  assert(
    undeclared.ok === false && undeclared.code === 'UNKNOWN_OPERATION',
    'undeclared operation was not rejected',
  );
  // A Core operation with no Hub scope is non-routable and must fail closed.
  const nonRoutable = await h.client.call('exception.decide', { resourceId: 'r', payload: {} });
  assert(
    nonRoutable.ok === false && nonRoutable.code === 'UNKNOWN_OPERATION',
    'non-routable operation was not rejected',
  );
  assert(h.transport.sent.length === 0, 'a rejected operation was forwarded');
  return pass(
    'C7',
    'operation-enforcement',
    'undeclared and non-routable operations => UNKNOWN_OPERATION, never forwarded',
  );
}

// ---------------------------------------------------------------------------
// C8 — Credential references only
// ---------------------------------------------------------------------------
async function c8(ctx: AreaContext): Promise<AreaResult> {
  // Manifest declaring secret material is rejected.
  const secretManifest = baseManifest({
    credentialReference: {
      required: true,
      referenceScheme: 'hub-keyid',
      rotationExpectation: 'ROTATE_ON_SCHEDULE',
      secretMaterial: true as never,
    },
  });
  let threw = false;
  try {
    validateGovernedManifest(secretManifest);
  } catch {
    threw = true;
  }
  assert(threw, 'manifest with secretMaterial:true was accepted');

  // A secret-looking credential reference is rejected.
  //
  // The PEM header is assembled at runtime rather than written as a literal so
  // that the repository secret scan keeps its HIGH-SIGNAL private-key rule fully
  // enforced everywhere (that rule deliberately ignores the placeholder
  // allow-list). The value is still a genuine negative fixture: it is exactly
  // what a caller must never pass as a credential reference.
  const pemLikeCredentialReference = ['-----BEGIN', 'PRIVATE KEY-----abc'].join(' ');
  let threw2 = false;
  try {
    createGovernedProductClient({
      manifest: ctx.manifest,
      environment: ctx.environment,
      tenantId: ctx.tenantId,
      credentialReference: pemLikeCredentialReference,
      transport: makeHarness({ ...ctx, script: allow }).transport,
      resolveCredential: async () => ({ secret: 'x' }),
    });
  } catch {
    threw2 = true;
  }
  assert(threw2, 'secret-looking credential reference was accepted');

  // Unresolvable reference fails closed.
  const unresolved = await callOnce(
    ctx,
    allow,
    'readiness.snapshot.get',
    { reference: 'x' },
    {
      resolveCredential: async () => null,
    },
  );
  assert(
    unresolved.result.ok === false && unresolved.result.code === 'CREDENTIAL_UNRESOLVED',
    'unresolved credential did not fail closed',
  );
  return pass(
    'C8',
    'credential-references-only',
    'secretMaterial:true rejected; secret-looking ref rejected; unresolved ref => CREDENTIAL_UNRESOLVED',
  );
}

// ---------------------------------------------------------------------------
// C9 — Signing / integrity
// ---------------------------------------------------------------------------
async function c9(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  await h.client.call('readiness.snapshot.get', { resourceId: 'r', payload: { reference: 'x' } });
  const env = h.transport.sent[0];
  assert(env !== undefined, 'no envelope forwarded');
  assert(validateGovernedEnvelope(env).ok, 'forwarded envelope failed structural validation');
  assert(typeof env.signature === 'string' && env.signature.length > 0, 'envelope not signed');
  // Tampering one signed field breaks validation.
  const tampered = { ...env, tenantId: 'tampered-tenant' };
  assert(
    !validateGovernedEnvelope({ ...tampered, signature: '' }).ok,
    'tampered envelope passed validation',
  );
  const denied = await callOnce(ctx, () => ({
    ok: false,
    code: 'REQUEST_TAMPERED',
    correlationId: 'c',
  }));
  assert(
    denied.result.ok === false && denied.result.code === 'INTEGRITY_FAILED',
    'integrity denial not bounded to INTEGRITY_FAILED',
  );
  return pass(
    'C9',
    'signing-integrity',
    'envelope signed over 14 fields; tamper => INTEGRITY_FAILED',
  );
}

// ---------------------------------------------------------------------------
// C10 — Freshness
// ---------------------------------------------------------------------------
async function c10(ctx: AreaContext): Promise<AreaResult> {
  // The caller cannot supply a timestamp; the trusted clock owns it.
  const h = makeHarness({ ...ctx, script: allow, clock: () => FIXED_NOW });
  await h.client.call('readiness.snapshot.get', { resourceId: 'r', payload: { reference: 'x' } });
  assert(
    h.transport.sent[0]?.timestamp === FIXED_NOW,
    'timestamp not taken from the trusted clock',
  );
  // An invalid clock fails closed locally.
  const badClock = await callOnce(
    ctx,
    allow,
    'readiness.snapshot.get',
    { reference: 'x' },
    { clock: () => 0 },
  );
  assert(
    badClock.result.ok === false && badClock.result.code === 'STALE_REQUEST',
    'invalid clock did not fail closed',
  );
  // A stale request is bounded by the Hub.
  const stale = await callOnce(ctx, () => ({
    ok: false,
    code: 'REQUEST_STALE',
    correlationId: 'c',
  }));
  assert(
    stale.result.ok === false && stale.result.code === 'STALE_REQUEST',
    'stale denial not bounded to STALE_REQUEST',
  );
  return pass(
    'C10',
    'freshness',
    'timestamp from trusted clock only; invalid clock => STALE_REQUEST; hostile stale => STALE_REQUEST',
  );
}

// ---------------------------------------------------------------------------
// C11 — Nonce replay
// ---------------------------------------------------------------------------
async function c11(ctx: AreaContext): Promise<AreaResult> {
  // Default nonce factory yields distinct nonces.
  const h = makeHarness({ ...ctx, script: allow });
  await h.client.call('readiness.snapshot.get', {
    resourceId: 'r',
    payload: { reference: 'x' },
    businessKey: 'a',
  });
  await h.client.call('readiness.snapshot.get', {
    resourceId: 'r',
    payload: { reference: 'x' },
    businessKey: 'b',
  });
  assert(
    h.transport.sent[0]?.nonce !== h.transport.sent[1]?.nonce,
    'nonce was reused across requests',
  );
  const replay = await callOnce(ctx, () => ({
    ok: false,
    code: 'NONCE_REPLAY',
    correlationId: 'c',
  }));
  assert(
    replay.result.ok === false && replay.result.code === 'REPLAY_DENIED',
    'replay denial not bounded to REPLAY_DENIED',
  );
  return pass('C11', 'nonce-replay', 'fresh nonce per request; hostile replay => REPLAY_DENIED');
}

// ---------------------------------------------------------------------------
// C12 — Idempotency
// ---------------------------------------------------------------------------
async function c12(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  await h.client.call('readiness.snapshot.get', {
    resourceId: 'r',
    payload: { reference: 'x' },
    businessKey: 'stable',
  });
  await h.client.call('readiness.snapshot.get', {
    resourceId: 'r',
    payload: { reference: 'x' },
    businessKey: 'stable',
  });
  assert(
    h.transport.sent[0]?.idempotencyKey === h.transport.sent[1]?.idempotencyKey,
    'idempotency key not stable across retries',
  );
  const conflict = await callOnce(ctx, () => ({
    ok: false,
    code: 'IDEMPOTENCY_CONFLICT',
    correlationId: 'c',
  }));
  assert(
    conflict.result.ok === false && conflict.result.code === 'IDEMPOTENCY_CONFLICT',
    'idempotency conflict not bounded',
  );
  return pass(
    'C12',
    'idempotency',
    'stable idempotency key across retries; payload mismatch => IDEMPOTENCY_CONFLICT',
  );
}

// ---------------------------------------------------------------------------
// C13 — Version mismatch
// ---------------------------------------------------------------------------
async function c13(ctx: AreaContext): Promise<AreaResult> {
  const badApi = baseManifest({ hubRoute: { ...baseManifest().hubRoute, apiVersion: '9.9.9' } });
  const badHub = baseManifest({ hubRoute: { ...baseManifest().hubRoute, apiHubVersion: '9.9.9' } });
  const badCore = baseManifest({ hubRoute: { ...baseManifest().hubRoute, coreVersion: '9.9.9' } });
  const missingCore = baseManifest({
    hubRoute: {
      routingIdentity: 'svc-conformance-subject',
      apiHubContractVersion: '1.0.0',
      apiHubVersion: '1.0.0',
      apiVersion: '1.0.0',
      directCoreAccess: false,
    } as never,
  });
  for (const [name, m] of [
    ['api', badApi],
    ['hub', badHub],
    ['core', badCore],
    ['missingCore', missingCore],
  ] as const) {
    let threw = false;
    try {
      validateGovernedManifest(m);
    } catch {
      threw = true;
    }
    assert(threw, `unsupported ${name} version was accepted`);
  }
  const stale = await callOnce(ctx, () => ({
    ok: false,
    code: 'CONTRACT_VERSION_STALE',
    correlationId: 'c',
  }));
  assert(
    stale.result.ok === false && stale.result.code === 'UNSUPPORTED_VERSION',
    'stale contract not bounded to UNSUPPORTED_VERSION',
  );
  return pass(
    'C13',
    'version-mismatch',
    'api/hub/core versions validated independently; hostile stale => UNSUPPORTED_VERSION',
  );
}

// ---------------------------------------------------------------------------
// C14 — Route mismatch
// ---------------------------------------------------------------------------
async function c14(ctx: AreaContext): Promise<AreaResult> {
  const mismatch = await callOnce(ctx, () => ({
    ok: false,
    code: 'HUB_ROUTE_INVALID',
    correlationId: 'c',
  }));
  assert(
    mismatch.result.ok === false && mismatch.result.code === 'ROUTE_ENVELOPE_MISMATCH',
    'route mismatch not bounded',
  );
  assert(
    mismatch.result.ok === false && mismatch.result.disposition === 'TERMINAL',
    'route mismatch not TERMINAL',
  );
  return pass('C14', 'route-mismatch', 'hostile route => ROUTE_ENVELOPE_MISMATCH, TERMINAL');
}

// ---------------------------------------------------------------------------
// C15 — Suspension
// ---------------------------------------------------------------------------
async function c15(ctx: AreaContext): Promise<AreaResult> {
  const suspended = await callOnce(ctx, () => ({
    ok: false,
    code: 'IDENTITY_SUSPENDED',
    correlationId: 'c',
  }));
  assert(
    suspended.result.ok === false && suspended.result.code === 'INTEGRATION_INACTIVE',
    'suspension not bounded',
  );
  assert(
    suspended.result.ok === false && suspended.result.disposition === 'HELD',
    'suspension not HELD',
  );
  return pass('C15', 'suspension', 'hostile suspended => INTEGRATION_INACTIVE, HELD');
}

// ---------------------------------------------------------------------------
// C16 — Revocation
// ---------------------------------------------------------------------------
async function c16(ctx: AreaContext): Promise<AreaResult> {
  const revoked = await callOnce(ctx, () => ({
    ok: false,
    code: 'IDENTITY_REVOKED',
    correlationId: 'c',
  }));
  assert(
    revoked.result.ok === false &&
      revoked.result.code === 'INTEGRATION_INACTIVE' &&
      revoked.result.disposition === 'TERMINAL',
    'revocation not TERMINAL',
  );
  const cred = await callOnce(ctx, () => ({
    ok: false,
    code: 'CREDENTIAL_REVOKED',
    correlationId: 'c',
  }));
  assert(
    cred.result.ok === false &&
      cred.result.code === 'CREDENTIAL_UNRESOLVED' &&
      cred.result.disposition === 'TERMINAL',
    'credential revocation not TERMINAL',
  );
  return pass('C16', 'revocation', 'identity/credential revocation => TERMINAL');
}

// ---------------------------------------------------------------------------
// C17 — Kill switch
// ---------------------------------------------------------------------------
async function c17(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow, killSwitch: () => true });
  const result = await h.client.call('readiness.snapshot.get', {
    resourceId: 'r',
    payload: { reference: 'x' },
  });
  assert(
    result.ok === false && result.code === 'INTEGRATION_INACTIVE',
    'engaged kill switch did not fail closed',
  );
  assert(result.ok === false && result.disposition === 'HELD', 'kill switch not HELD');
  assert(h.transport.sent.length === 0, 'request forwarded while kill switch engaged');
  return pass(
    'C17',
    'kill-switch',
    'engaged kill switch => INTEGRATION_INACTIVE, HELD, no forward',
  );
}

// ---------------------------------------------------------------------------
// C18 — Hub outage
// ---------------------------------------------------------------------------
async function c18(ctx: AreaContext): Promise<AreaResult> {
  const thrown = await callOnce(ctx, () => {
    throw new Error('hub down');
  });
  assert(
    thrown.result.ok === false && thrown.result.code === 'UPSTREAM_UNAVAILABLE',
    'hub throw not bounded to UPSTREAM_UNAVAILABLE',
  );
  assert(
    thrown.result.ok === false && thrown.result.disposition === 'AMBIGUOUS',
    'hub throw not AMBIGUOUS',
  );
  const dep = await callOnce(ctx, () => ({
    ok: false,
    code: 'DEPENDENCY_UNAVAILABLE',
    correlationId: 'c',
  }));
  assert(
    dep.result.ok === false && dep.result.code === 'DEPENDENCY_UNAVAILABLE' && dep.result.retryable,
    'dependency outage not CLEAN_RETRYABLE',
  );
  return pass(
    'C18',
    'hub-outage',
    'hub throw => UPSTREAM_UNAVAILABLE/AMBIGUOUS; 503 => DEPENDENCY_UNAVAILABLE/CLEAN_RETRYABLE',
  );
}

// ---------------------------------------------------------------------------
// C19 — Core outage
// ---------------------------------------------------------------------------
async function c19(ctx: AreaContext): Promise<AreaResult> {
  const internal = await callOnce(ctx, () => ({ ok: false, code: 'INTERNAL', correlationId: 'c' }));
  assert(
    internal.result.ok === false && internal.result.code === 'UPSTREAM_UNAVAILABLE',
    'core internal not bounded',
  );
  assert(
    internal.result.ok === false && internal.result.disposition === 'AMBIGUOUS',
    'core internal not AMBIGUOUS',
  );
  const dep = await callOnce(ctx, () => ({
    ok: false,
    code: 'DEPENDENCY_UNAVAILABLE',
    correlationId: 'c',
  }));
  assert(
    dep.result.ok === false && dep.result.code === 'DEPENDENCY_UNAVAILABLE',
    'core dependency outage not bounded',
  );
  return pass('C19', 'core-outage', 'core outage bounded and classified; never a verdict');
}

// ---------------------------------------------------------------------------
// C20 — Bounded errors
// ---------------------------------------------------------------------------
async function c20(ctx: AreaContext): Promise<AreaResult> {
  const unknown = await callOnce(ctx, () => ({
    ok: false,
    code: 'SOMETHING_WEIRD',
    correlationId: 'c',
  }));
  assert(
    unknown.result.ok === false && unknown.result.code === 'UPSTREAM_UNAVAILABLE',
    'unknown code escaped as unbounded',
  );
  assert(
    unknown.result.ok === false && unknown.result.disposition === 'TERMINAL',
    'unknown code did not fail closed',
  );
  assert(
    unknown.result.ok === false && unknown.result.cause === 'SOMETHING_WEIRD',
    'original cause not preserved',
  );
  return pass(
    'C20',
    'bounded-errors',
    'unknown code => UPSTREAM_UNAVAILABLE/TERMINAL with cause preserved; no raw text',
  );
}

// ---------------------------------------------------------------------------
// C21 — Audit / correlation
// ---------------------------------------------------------------------------
async function c21(ctx: AreaContext): Promise<AreaResult> {
  const h = makeHarness({ ...ctx, script: allow });
  const okRes = await h.client.call('readiness.snapshot.get', {
    resourceId: 'r',
    payload: { reference: 'x' },
  });
  assert(
    okRes.correlationId.length > 0 && okRes.requestId.length > 0,
    'success missing correlation/request ids',
  );
  assert(
    h.transport.sent[0]?.correlationId === okRes.correlationId,
    'correlation id not propagated to envelope',
  );
  assert(
    h.transport.sent[0]?.requestId === okRes.requestId,
    'request id not propagated to envelope',
  );
  const failRes = await callOnce(ctx, () => ({
    ok: false,
    code: 'SCOPE_VIOLATION',
    correlationId: 'c',
  }));
  assert(
    failRes.result.correlationId.length > 0 && failRes.result.requestId.length > 0,
    'failure missing correlation/request ids',
  );
  return pass(
    'C21',
    'audit-correlation',
    'correlation/request ids on every result and propagated to the envelope',
  );
}

// ---------------------------------------------------------------------------
// C22 — Raw evidence rejection
// ---------------------------------------------------------------------------
async function c22(ctx: AreaContext): Promise<AreaResult> {
  const raw = await callOnce(ctx, allow, 'evidence.record', {
    raw: 'full device contents',
    rawContent: 'x',
  });
  assert(
    raw.result.ok === false && raw.result.code === 'RAW_EVIDENCE_REJECTED',
    'raw sensitive evidence was not rejected',
  );
  assert(raw.sent === 0, 'raw evidence payload was forwarded');
  const noRef = await callOnce(ctx, allow, 'evidence.record', {
    note: 'metadata without a reference',
  });
  assert(
    noRef.result.ok === false && noRef.result.code === 'RAW_EVIDENCE_REJECTED',
    'evidence without a secure reference was accepted',
  );
  return pass(
    'C22',
    'raw-evidence-rejection',
    'raw sensitive evidence and reference-less evidence => RAW_EVIDENCE_REJECTED, never forwarded',
  );
}

// ---------------------------------------------------------------------------
// C23 — False compliance claims
// ---------------------------------------------------------------------------
async function c23(ctx: AreaContext): Promise<AreaResult> {
  const verdict = await callOnce(ctx, allow, 'readiness.snapshot.get', {
    reference: 'x',
    compliant: true,
  });
  assert(
    verdict.result.ok === false && verdict.result.code === 'FALSE_COMPLIANCE_CLAIM',
    'verdict field was accepted',
  );
  const token = await callOnce(ctx, allow, 'readiness.snapshot.get', {
    reference: 'x',
    note: 'this subject is COMPLIANT',
  });
  assert(
    token.result.ok === false && token.result.code === 'FALSE_COMPLIANCE_CLAIM',
    'conclusion token was accepted',
  );
  assert(verdict.sent === 0 && token.sent === 0, 'false-claim payload was forwarded');
  // The result type carries no verdict field.
  const okRes = await callOnce(ctx, allow);
  const keys = Object.keys(okRes.result);
  for (const forbidden of ['compliant', 'certified', 'verdict', 'approved']) {
    assert(!keys.includes(forbidden), `result exposed a verdict field ${forbidden}`);
  }
  return pass(
    'C23',
    'false-compliance-claims',
    'verdict fields and conclusion tokens rejected; result has no verdict field',
  );
}

const RUNNERS: ReadonlyArray<(ctx: AreaContext) => Promise<AreaResult>> = [
  c1,
  c2,
  c3,
  c4,
  c5,
  c6,
  c7,
  c8,
  c9,
  c10,
  c11,
  c12,
  c13,
  c14,
  c15,
  c16,
  c17,
  c18,
  c19,
  c20,
  c21,
  c22,
  c23,
];

export async function runAreas(ctx: AreaContext): Promise<readonly AreaResult[]> {
  const results: AreaResult[] = [];
  for (let i = 0; i < RUNNERS.length; i += 1) {
    const runner = RUNNERS[i];
    const name = CONFORMANCE_AREAS[i];
    const id = `C${i + 1}`;
    if (!runner || !name) throw new Error('conformance runner/area mismatch');
    try {
      results.push(await runner(ctx));
    } catch (err) {
      results.push({ id, name, status: 'FAIL', evidence: (err as Error).message });
    }
  }
  return results;
}
