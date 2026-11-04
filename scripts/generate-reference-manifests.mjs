#!/usr/bin/env node
// Projects the authoritative reference-adapter manifests
// (contracts/governed-product/reference-adapters/*.manifest.json) into typed
// TypeScript constants so the adapters can consume them without JSON-module
// configuration. A test asserts the projection equals the JSON on disk.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const DIR = resolve(root, 'contracts/governed-product/reference-adapters');
const OUT = resolve(root, 'packages/governed-product-adapters/src/manifests.generated.ts');

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.manifest.json'))
  .sort();

const camel = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const parts = [];
const names = [];
for (const file of files) {
  const raw = JSON.parse(readFileSync(resolve(DIR, file), 'utf8'));
  const name = `${camel(raw.productId)}Manifest`;
  names.push({ name, productId: raw.productId, file });
  parts.push(`/** ${raw.displayName} — ${raw.productId} (${raw.ownership}). */`);
  parts.push(`export const ${name} = ${JSON.stringify(raw, null, 2)} as const;`);
  parts.push('');
}

const header = `// GENERATED FILE — do not edit by hand.
// Source: contracts/governed-product/reference-adapters/*.manifest.json
// Regenerate: node scripts/generate-reference-manifests.mjs
//
// These are the four reference governed-product manifests. They are DECLARATIONS
// of intent only: they never grant authority, never assert a compliance state,
// and never carry secret material.

import type { GovernedProductManifest } from '@fsts/governed-product-client';

`;

const registry = `/** Registry of the reference adapters, in stable productId order. */
export const REFERENCE_MANIFESTS: ReadonlyArray<{
  readonly productId: string;
  readonly sourceFile: string;
  readonly manifest: GovernedProductManifest;
}> = Object.freeze([
${names
  .map(
    (n) =>
      `  { productId: ${JSON.stringify(n.productId)}, sourceFile: ${JSON.stringify(n.file)}, manifest: ${n.name} as unknown as GovernedProductManifest },`,
  )
  .join('\n')}
]);
`;

writeFileSync(OUT, header + parts.join('\n') + registry);
console.log(
  `wrote ${OUT} (${names.length} manifests: ${names.map((n) => n.productId).join(', ')})`,
);
