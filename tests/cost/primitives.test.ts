// Cost & Usage Guard — deterministic cost-calculation primitive tests.
//
// Covers the pure arithmetic primitives in convex/lib/cost.ts. These run
// without a Convex backend and are fully deterministic.

import { describe, expect, it } from 'vitest';
import {
  computeBatchSavingsMinor,
  computeCacheSavingsMinor,
  computeCostMinor,
  computeDeviationPct,
  computeRetryWasteMinor,
  evaluateThreshold,
  resolveEffectivePriceVersion,
} from '../../convex/lib/cost.js';

describe('cost primitives', () => {
  it('SCENARIO 4: resolves the vendor price version effective at a point in time', () => {
    const versions = [
      { pricingVersionId: 'prc_v1', effectiveFrom: 1000, effectiveTo: 2000 },
      { pricingVersionId: 'prc_v2', effectiveFrom: 2000, effectiveTo: 3000 },
      { pricingVersionId: 'prc_v3', effectiveFrom: 3000 },
    ];
    expect(resolveEffectivePriceVersion(versions, 1500)?.pricingVersionId).toBe('prc_v1');
    expect(resolveEffectivePriceVersion(versions, 2000)?.pricingVersionId).toBe('prc_v2');
    expect(resolveEffectivePriceVersion(versions, 5000)?.pricingVersionId).toBe('prc_v3');
    // Before any version applies -> fail closed (null), never guess a price.
    expect(resolveEffectivePriceVersion(versions, 500)).toBeNull();
  });

  it('SCENARIO 4: prefers the latest effectiveFrom when versions overlap', () => {
    const versions = [
      { pricingVersionId: 'prc_old', effectiveFrom: 1000 },
      { pricingVersionId: 'prc_new', effectiveFrom: 2000 },
    ];
    expect(resolveEffectivePriceVersion(versions, 2500)?.pricingVersionId).toBe('prc_new');
  });

  it('SCENARIO 5: computes cost as an integer in minor units', () => {
    const amount = computeCostMinor(7, 25);
    expect(amount).toBe(175);
    expect(Number.isInteger(amount)).toBe(true);
  });

  it('SCENARIO 5: rejects non-integer monetary inputs (no floating-point money)', () => {
    expect(() => computeCostMinor(1.5, 25)).toThrow();
    expect(() => computeCostMinor(1, 2.5)).toThrow();
  });

  it('SCENARIO 6: computes retry waste from failed attempts', () => {
    // 2 failed attempts at 25 minor units each = 50 minor units of waste.
    expect(computeRetryWasteMinor(2, 25)).toBe(50);
    expect(computeRetryWasteMinor(0, 25)).toBe(0);
  });

  it('SCENARIO 7: computes cache savings from cache hits', () => {
    expect(computeCacheSavingsMinor(10, 25)).toBe(250);
    expect(computeCacheSavingsMinor(0, 25)).toBe(0);
  });

  it('SCENARIO 8: computes batch savings and never returns negative savings', () => {
    expect(computeBatchSavingsMinor(2500, 500)).toBe(2000);
    expect(computeBatchSavingsMinor(500, 2500)).toBe(0);
  });

  it('SCENARIO 9: evaluates a quota/budget warning threshold deterministically', () => {
    expect(evaluateThreshold(500, 1000, 80).status).toBe('OK');
    expect(evaluateThreshold(800, 1000, 80).status).toBe('WARNING');
    expect(evaluateThreshold(1000, 1000, 80).status).toBe('BLOCKED');
    expect(evaluateThreshold(1200, 1000, 80).status).toBe('BLOCKED');
    expect(evaluateThreshold(800, 1000, 80).consumedPct).toBe(80);
  });

  it('computes anomaly deviation percentages deterministically', () => {
    expect(computeDeviationPct(10000, 30000)).toBe(200);
    expect(computeDeviationPct(10000, 5000)).toBe(-50);
    expect(computeDeviationPct(0, 0)).toBe(0);
  });
});
