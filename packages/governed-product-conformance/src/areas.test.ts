// Executes all 23 conformance areas against the deterministic synthetic subject
// and asserts a fully CONFORMANT report. A PASS here is integration conformance,
// never a compliance verdict.

import { describe, expect, it } from 'vitest';
import { CONFORMANCE_AREAS } from '@fsts/governed-product-client';
import { baseManifest } from './harness.js';
import { runAreas } from './areas.js';
import { formatReport, runConformance } from './report.js';

const ctx = {
  manifest: baseManifest(),
  environment: 'PRODUCTION' as const,
  tenantId: 'tenant-conformance',
  credentialReference: 'hub-keyid:conformance-subject',
};

describe('governed product conformance — 23 areas', () => {
  it('runs exactly 23 areas in canonical order', async () => {
    const results = await runAreas(ctx);
    expect(results).toHaveLength(23);
    expect(results.map((r) => r.name)).toEqual([...CONFORMANCE_AREAS]);
    expect(results.map((r) => r.id)).toEqual(Array.from({ length: 23 }, (_, i) => `C${i + 1}`));
  });

  it('passes every area for the conformant synthetic subject', async () => {
    const results = await runAreas(ctx);
    const failed = results.filter((r) => r.status !== 'PASS');
    expect(
      failed,
      `failed areas: ${failed.map((f) => `${f.id} ${f.name}: ${f.evidence}`).join(' | ')}`,
    ).toEqual([]);
  });

  it('produces a CONFORMANT report that never claims compliance or certification', async () => {
    const report = await runConformance(ctx);
    expect(report.result).toBe('CONFORMANT');
    expect(report.summary).toEqual({ total: 23, passed: 23, failed: 0 });
    expect(report.complianceClaim).toBe('NONE');
    expect(report.certificationClaim).toBe('NONE');
    expect(report.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.productId).toBe('conformance-subject');
    // The rendered report must not assert a verdict.
    const text = formatReport(report);
    expect(text).toContain('a PASS is never COMPLIANT');
    expect(text).not.toMatch(/\bCERTIFIED\b/);
  });

  it('is deterministic — the same subject yields the same manifest hash and result', async () => {
    const a = await runConformance(ctx);
    const b = await runConformance(ctx);
    expect(a.manifestHash).toBe(b.manifestHash);
    expect(a.result).toBe(b.result);
    expect(a.areas.map((x) => x.status)).toEqual(b.areas.map((x) => x.status));
  });

  it('reports NON_CONFORMANT when an area fails', async () => {
    // A subject that declares a non-routable operation cannot construct a client,
    // which surfaces as a bounded failure rather than a silent pass.
    const broken = baseManifest({ requiredOperations: ['exception.decide'] });
    const report = await runConformance({ ...ctx, manifest: broken });
    expect(report.result).toBe('NON_CONFORMANT');
    expect(report.summary.failed).toBeGreaterThan(0);
  });
});
