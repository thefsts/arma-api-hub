// POST-PHASE-8 CONTRACT RECONCILIATION AMENDMENT TESTS.
//
// Four amendments were approved after the frozen design (4ac26e0) was reconciled
// against the merged Phase 8 contracts. Each amendment gets explicit tests here
// IN ADDITION to its conformance area, so a regression in the amendment is
// caught even if the area still passes.

import { describe, expect, it } from 'vitest';
import {
  CORE_DENIAL_CODES,
  DENIAL_MAPPING,
  HUB_DENIAL_CODES,
  KILL_SWITCH_SCOPES,
  SCOPES_REQUIRING_REF,
  UPSTREAM_UNAVAILABLE,
  assertCountersNotState,
  isDenialMappingComplete,
  mapCoreDenial,
  observeHealth,
  unmappedDenialCodes,
  validateGovernedManifest,
} from '@fsts/governed-product-client';
import { baseManifest, FIXED_NOW, makeHarness } from './harness.js';

const ctx = {
  manifest: baseManifest(),
  environment: 'PRODUCTION' as const,
  tenantId: 'tenant-conformance',
  credentialReference: 'hub-keyid:conformance-subject',
};
const allow = () => ({ ok: true as const, body: '{"accepted":true}', correlationId: 'corr-hub' });

// ===========================================================================
// AMENDMENT 1 — kill-switch / rollout scopes adopt Core's vocabulary verbatim
// ===========================================================================
describe('AMENDMENT 1 — authoritative rollout scopes', () => {
  it("adopts Core's vocabulary verbatim: GLOBAL | PRODUCT | TENANT | ENVIRONMENT", () => {
    expect([...KILL_SWITCH_SCOPES]).toEqual(['GLOBAL', 'PRODUCT', 'TENANT', 'ENVIRONMENT']);
  });

  it('does NOT include SERVICE — it is not an authoritative rollout scope', () => {
    expect((KILL_SWITCH_SCOPES as readonly string[]).includes('SERVICE')).toBe(false);
  });

  it('rejects SERVICE as a kill-switch scope', () => {
    const manifest = baseManifest({
      killSwitch: { required: true, scope: 'SERVICE' as never, scopeRef: 'conformance-subject' },
    });
    expect(() => validateGovernedManifest(manifest)).toThrow(/not an authoritative rollout scope/);
  });

  it('requires scopeRef for every non-GLOBAL scope', () => {
    for (const scope of ['PRODUCT', 'TENANT', 'ENVIRONMENT'] as const) {
      expect(SCOPES_REQUIRING_REF).toContain(scope);
      const missing = baseManifest({ killSwitch: { required: true, scope } as never });
      expect(() => validateGovernedManifest(missing), `${scope} without scopeRef`).toThrow(
        /requires scopeRef/,
      );

      const present = baseManifest({ killSwitch: { required: true, scope, scopeRef: 'ref-1' } });
      expect(() => validateGovernedManifest(present), `${scope} with scopeRef`).not.toThrow();
    }
  });

  it('forbids scopeRef on GLOBAL', () => {
    const bad = baseManifest({
      killSwitch: { required: true, scope: 'GLOBAL', scopeRef: 'ref-1' },
    });
    expect(() => validateGovernedManifest(bad)).toThrow(
      /GLOBAL kill switch must not carry scopeRef/,
    );
    const ok = baseManifest({ killSwitch: { required: true, scope: 'GLOBAL' } });
    expect(() => validateGovernedManifest(ok)).not.toThrow();
  });

  it('ENFORCES an ENVIRONMENT-scoped rollout control at call time', async () => {
    // An engaged kill switch bound to the calling environment fails closed and
    // never forwards the request.
    const h = makeHarness({
      ...ctx,
      manifest: baseManifest({
        killSwitch: { required: true, scope: 'ENVIRONMENT', scopeRef: 'PRODUCTION' },
      }),
      script: allow,
      killSwitch: () => true,
    });
    const res = await h.client.call('readiness.snapshot.get', {
      resourceId: 'r',
      payload: { reference: 'x' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('INTEGRATION_INACTIVE');
      expect(res.disposition).toBe('HELD');
    }
    expect(h.transport.sent).toHaveLength(0);
  });

  it('allows traffic when the ENVIRONMENT control is not engaged', async () => {
    const h = makeHarness({
      ...ctx,
      manifest: baseManifest({
        killSwitch: { required: true, scope: 'ENVIRONMENT', scopeRef: 'PRODUCTION' },
      }),
      script: allow,
      killSwitch: () => false,
    });
    const res = await h.client.call('readiness.snapshot.get', {
      resourceId: 'r',
      payload: { reference: 'x' },
    });
    expect(res.ok).toBe(true);
    expect(h.transport.sent).toHaveLength(1);
  });
});

// ===========================================================================
// AMENDMENT 2 — complete version compatibility dimensions
// ===========================================================================
describe('AMENDMENT 2 — distinct apiVersion / apiHubVersion / coreVersion', () => {
  const withRoute = (patch: Record<string, unknown>) =>
    baseManifest({ hubRoute: { ...baseManifest().hubRoute, ...patch } as never });

  it('carries three distinct version dimensions', () => {
    const route = baseManifest().hubRoute;
    expect(route.apiVersion).toBe('1.0.0');
    expect(route.apiHubVersion).toBe('1.0.0');
    expect(route.coreVersion).toBe('1.0.0');
    expect(route.apiHubContractVersion).toBe('1.0.0');
  });

  it('rejects a MISSING apiHubVersion', () => {
    const { apiHubVersion: _drop, ...rest } = baseManifest().hubRoute;
    expect(() => validateGovernedManifest(baseManifest({ hubRoute: rest as never }))).toThrow(
      /apiHubVersion/,
    );
  });

  it('rejects a MISSING coreVersion', () => {
    const { coreVersion: _drop, ...rest } = baseManifest().hubRoute;
    expect(() => validateGovernedManifest(baseManifest({ hubRoute: rest as never }))).toThrow(
      /coreVersion/,
    );
  });

  it('rejects a MISMATCHED (unsupported) apiHubVersion', () => {
    expect(() => validateGovernedManifest(withRoute({ apiHubVersion: '2.0.0' }))).toThrow(
      /unsupported apiHubVersion/,
    );
  });

  it('rejects a MISMATCHED (unsupported) coreVersion', () => {
    expect(() => validateGovernedManifest(withRoute({ coreVersion: '9.9.9' }))).toThrow(
      /unsupported coreVersion/,
    );
  });

  it('rejects a non-semver apiHubVersion / coreVersion', () => {
    expect(() => validateGovernedManifest(withRoute({ apiHubVersion: 'v1' }))).toThrow(
      /must be semver/,
    );
    expect(() => validateGovernedManifest(withRoute({ coreVersion: '1' }))).toThrow(
      /must be semver/,
    );
  });

  it('does not treat the three dimensions as interchangeable', () => {
    // A valid apiVersion does not excuse an invalid apiHubVersion or coreVersion.
    expect(() =>
      validateGovernedManifest(withRoute({ apiVersion: '1.1.0', apiHubVersion: '1.1.0' })),
    ).toThrow(/unsupported apiHubVersion/);
  });

  it('fails closed on a stale contract version at the Hub boundary', async () => {
    const h = makeHarness({
      ...ctx,
      script: () => ({ ok: false, code: 'CONTRACT_VERSION_STALE', correlationId: 'c' }),
    });
    const res = await h.client.call('readiness.snapshot.get', {
      resourceId: 'r',
      payload: { reference: 'x' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNSUPPORTED_VERSION');
  });
});

// ===========================================================================
// AMENDMENT 3 — Core owns health; the SDK cannot manufacture a state
// ===========================================================================
describe('AMENDMENT 3 — Core owns authoritative health', () => {
  it('reports UNKNOWN when there is no Core observation', async () => {
    const h = makeHarness({ ...ctx, script: allow });
    const report = await h.client.health();
    expect(report.status).toBe('UNKNOWN');
    expect(report.source).toBe('NO_CORE_OBSERVATION');
  });

  it('echoes a fresh Core-derived state without deriving its own', async () => {
    const h = makeHarness({
      ...ctx,
      script: allow,
      healthProbe: async () => ({ status: 'DEGRADED', observedAt: FIXED_NOW - 1000 }),
    });
    const report = await h.client.health();
    expect(report.status).toBe('DEGRADED');
    expect(report.source).toBe('CORE_OBSERVED');
  });

  it('never upgrades a STALE Core observation to HEALTHY', () => {
    const report = observeHealth({
      observation: { status: 'HEALTHY', observedAt: FIXED_NOW - 10_000_000 },
      now: FIXED_NOW,
      maxStalenessMs: 300_000,
      correlationId: 'c',
    });
    expect(report.status).toBe('UNKNOWN');
  });

  it('cannot manufacture a state from counters — a status input is rejected', () => {
    expect(() => assertCountersNotState({ status: 'HEALTHY' })).toThrow(/Core-derived/);
    expect(() => assertCountersNotState({ status: 'DEGRADED' })).toThrow(/Core-derived/);
    // Counters alone are permitted.
    expect(() => assertCountersNotState({ successCount: 10, failureCount: 0 })).not.toThrow();
  });

  it('a failing health probe degrades to UNKNOWN, never HEALTHY', async () => {
    const h = makeHarness({
      ...ctx,
      script: allow,
      healthProbe: async () => {
        throw new Error('core unreachable');
      },
    });
    const report = await h.client.health();
    expect(report.status).toBe('UNKNOWN');
  });

  it('never claims compliance or certification from health', async () => {
    const h = makeHarness({
      ...ctx,
      script: allow,
      healthProbe: async () => ({ status: 'HEALTHY', observedAt: FIXED_NOW }),
    });
    const report = await h.client.health();
    expect(report.status).toBe('HEALTHY');
    expect(report.complianceClaim).toBe('NONE');
    expect(report.certificationClaim).toBe('NONE');
  });
});

// ===========================================================================
// AMENDMENT 4 — ONE closed deterministic bounded denial mapping
// ===========================================================================
describe('AMENDMENT 4 — bounded denial mapping', () => {
  it('is COMPLETE over the authoritative Core denial set', () => {
    expect(CORE_DENIAL_CODES).toHaveLength(42);
    expect(isDenialMappingComplete()).toBe(true);
    expect(unmappedDenialCodes()).toEqual([]);
  });

  it('maps every Core denial code to a bounded failure with a disposition', () => {
    for (const code of CORE_DENIAL_CODES) {
      const mapped = mapCoreDenial(code);
      expect(mapped.code, code).toBeTruthy();
      expect(['TERMINAL', 'HELD', 'CLEAN_RETRYABLE', 'AMBIGUOUS']).toContain(mapped.disposition);
      expect(mapped.cause).toBe(code);
    }
  });

  it('maps every Hub denial code too', () => {
    for (const code of HUB_DENIAL_CODES) {
      expect(DENIAL_MAPPING[code], code).toBeDefined();
    }
  });

  it('preserves the original Core denial code as structured cause', () => {
    expect(mapCoreDenial('SCOPE_VIOLATION').cause).toBe('SCOPE_VIOLATION');
    expect(mapCoreDenial('IDENTITY_REVOKED').cause).toBe('IDENTITY_REVOKED');
  });

  it('does not flatten materially different security failures into one meaning', () => {
    // Revocation is terminal and not retryable; suspension is held.
    expect(mapCoreDenial('IDENTITY_REVOKED').disposition).toBe('TERMINAL');
    expect(mapCoreDenial('IDENTITY_SUSPENDED').disposition).toBe('HELD');
    // A tampered request is an integrity failure, not a validation failure.
    expect(mapCoreDenial('REQUEST_TAMPERED').code).toBe('INTEGRITY_FAILED');
    expect(mapCoreDenial('MALFORMED_PAYLOAD').code).toBe('VALIDATION_FAILED');
    // A scope denial is not an internal error.
    expect(mapCoreDenial('SCOPE_VIOLATION').code).toBe('SCOPE_DENIED');
    expect(mapCoreDenial('INTERNAL').code).toBe(UPSTREAM_UNAVAILABLE);
  });

  it('FAILS CLOSED for an unknown/unmapped denial — never success', () => {
    const unknown = mapCoreDenial('SOMETHING_WEIRD_NOT_IN_THE_SET');
    expect(unknown.code).toBe(UPSTREAM_UNAVAILABLE);
    expect(unknown.disposition).toBe('TERMINAL');
    expect(unknown.cause).toBe('SOMETHING_WEIRD_NOT_IN_THE_SET');
  });

  it('surfaces an unknown Core denial through the client as a bounded failure', async () => {
    const h = makeHarness({
      ...ctx,
      script: () => ({ ok: false, code: 'TOTALLY_NEW_DENIAL', correlationId: 'c' }),
    });
    const res = await h.client.call('readiness.snapshot.get', {
      resourceId: 'r',
      payload: { reference: 'x' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(UPSTREAM_UNAVAILABLE);
      expect(res.disposition).toBe('TERMINAL');
      expect(res.cause).toBe('TOTALLY_NEW_DENIAL');
    }
  });

  it('the generated design-record artifact agrees with the authoritative table', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const doc = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'contracts/governed-product/denial-mapping.json'),
        'utf8',
      ),
    ) as { mapping: Record<string, unknown>; counts: { mappedEntries: number } };
    expect(Object.keys(doc.mapping).sort()).toEqual(Object.keys(DENIAL_MAPPING).sort());
    expect(doc.counts.mappedEntries).toBe(Object.keys(DENIAL_MAPPING).length);
  });
});
