// Schema <-> validator agreement tests.
//
// The frozen manifest contract exists twice: as the JSON Schema
// (contracts/governed-product/manifest.schema.json) and as the fail-closed
// runtime validator (validateGovernedManifest). If they disagree, a manifest can
// pass one gate and fail the other. These tests prove they agree on the four
// reference adapters, on the synthetic conformance subject, and on the two
// amendment-critical rejections (SERVICE scope, missing version dimensions).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { validateGovernedManifest } from '@fsts/governed-product-client';
import { REFERENCE_MANIFESTS } from '@fsts/governed-product-adapters';
import { baseManifest } from '@fsts/governed-product-conformance';

const schema = JSON.parse(
  readFileSync(resolve(process.cwd(), 'contracts/governed-product/manifest.schema.json'), 'utf8'),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const subjects = [
  ...REFERENCE_MANIFESTS.map((m) => ({ id: m.productId, manifest: m.manifest })),
  {
    id: 'conformance-subject',
    manifest: baseManifest(),
  },
];

describe('manifest schema <-> runtime validator agreement', () => {
  for (const subject of subjects) {
    it(`${subject.id}: accepted by BOTH the JSON Schema and the runtime validator`, () => {
      const schemaOk = validate(subject.manifest);
      expect(schemaOk, JSON.stringify(validate.errors)).toBe(true);
      expect(() => validateGovernedManifest(subject.manifest)).not.toThrow();
    });
  }

  it('AMENDMENT 1: the schema rejects SERVICE as a rollout scope', () => {
    const manifest = baseManifest({
      killSwitch: { required: true, scope: 'SERVICE', scopeRef: 'x' },
    });
    expect(validate(manifest)).toBe(false);
    expect(() => validateGovernedManifest(manifest)).toThrow();
  });

  it('AMENDMENT 1: the schema requires scopeRef for non-GLOBAL scopes', () => {
    for (const scope of ['PRODUCT', 'TENANT', 'ENVIRONMENT']) {
      const manifest = baseManifest({ killSwitch: { required: true, scope } });
      expect(validate(manifest), scope).toBe(false);
      expect(() => validateGovernedManifest(manifest), scope).toThrow();
    }
  });

  it('AMENDMENT 1: the schema forbids scopeRef on GLOBAL', () => {
    const manifest = baseManifest({
      killSwitch: { required: true, scope: 'GLOBAL', scopeRef: 'x' },
    });
    expect(validate(manifest)).toBe(false);
    expect(() => validateGovernedManifest(manifest)).toThrow();
  });

  it('AMENDMENT 2: the schema requires apiHubVersion and coreVersion', () => {
    for (const drop of ['apiHubVersion', 'coreVersion']) {
      const route = { ...baseManifest().hubRoute } as Record<string, unknown>;
      delete route[drop];
      const manifest = baseManifest({ hubRoute: route as never });
      expect(validate(manifest), drop).toBe(false);
      expect(() => validateGovernedManifest(manifest), drop).toThrow();
    }
  });
});
