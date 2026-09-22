// Scenario coverage: FSTS-owned vs client-owned classification, and the hard
// rule that PlayRaise is never classified as FSTS-owned.

import { describe, expect, it } from 'vitest';
import {
  classifyProductOwnership,
  FSTS_OWNED_PRODUCTS,
  isFstsOwnedProduct,
  isNonFstsOwnedProduct,
  NON_FSTS_OWNED_PRODUCTS,
  productRecordSchema,
  serviceRecordSchema,
  validate,
} from '@arma/contracts';
import { syntheticActiveService } from '@arma/testing';

describe('product ownership classification', () => {
  it('SCENARIO 15: classifies every catalog product as FSTS-owned', () => {
    for (const product of FSTS_OWNED_PRODUCTS) {
      expect(classifyProductOwnership(product)).toBe('FSTS_OWNED');
      expect(isFstsOwnedProduct(product)).toBe(true);
    }
    expect(FSTS_OWNED_PRODUCTS).toHaveLength(17);
  });

  it('SCENARIO 15: classifies PlayRaise as client-owned, not FSTS-owned', () => {
    expect(classifyProductOwnership('PlayRaise')).toBe('CLIENT_OWNED');
    expect(isFstsOwnedProduct('PlayRaise')).toBe(false);
    expect(isNonFstsOwnedProduct('PlayRaise')).toBe(true);
    expect(NON_FSTS_OWNED_PRODUCTS).toContain('PlayRaise');
  });

  it('SCENARIO 16: never classifies PlayRaise as FSTS-owned, even with case/space variants', () => {
    for (const variant of ['PlayRaise', 'playraise', 'PLAY RAISE', 'play-raise']) {
      expect(isFstsOwnedProduct(variant)).toBe(false);
      expect(classifyProductOwnership(variant)).not.toBe('FSTS_OWNED');
    }
  });

  it('returns null for unknown products (never assumes FSTS ownership)', () => {
    expect(classifyProductOwnership('Some Unknown System')).toBeNull();
    expect(isFstsOwnedProduct('Some Unknown System')).toBe(false);
  });
});

describe('registry record validation', () => {
  it('accepts a well-formed service record', () => {
    expect(validate(serviceRecordSchema, syntheticActiveService()).ok).toBe(true);
  });

  it('rejects a service record with an unknown lifecycle value', () => {
    const record = { ...syntheticActiveService(), lifecycle: 'LIVE' };
    expect(validate(serviceRecordSchema, record).ok).toBe(false);
  });

  it('rejects a service record with unknown extra fields (strict)', () => {
    const record = { ...syntheticActiveService(), unexpectedField: true };
    expect(validate(serviceRecordSchema, record).ok).toBe(false);
  });

  it('accepts a well-formed product record', () => {
    const product = {
      productId: 'prod-arma-sentinel',
      displayName: 'ARMA Sentinel',
      ownership: 'FSTS_OWNED',
      lifecycle: 'ACTIVE',
      owner: {
        ownerId: 'owner-platform',
        displayName: 'Platform',
        contactRef: 'p@example.invalid',
      },
      classification: 'CONFIDENTIAL',
      serviceIds: ['arma-sentinel'],
      approvedExternalIntegration: false,
    };
    expect(validate(productRecordSchema, product).ok).toBe(true);
  });
});
