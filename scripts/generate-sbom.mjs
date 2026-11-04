#!/usr/bin/env node
// Generates a CycloneDX 1.5 JSON SBOM for the workspace from pnpm-lock.yaml.
//
// `pnpm sbom` is not available in the pinned pnpm build, so this script derives
// the dependency inventory directly from the lockfile: every resolved package
// with its exact version, resolved tarball, and integrity hash. It also lists
// the workspace's own packages as first-party components.
//
// Usage: node scripts/generate-sbom.mjs [outFile]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const lock = readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8');

const outFile = resolve(process.argv[2] ?? resolve(root, 'sbom.cdx.json'));

// --- parse the `packages:` section of the lockfile -------------------------
const lines = lock.split('\n');
const start = lines.findIndex((l) => l === 'packages:');
if (start === -1) throw new Error('pnpm-lock.yaml has no packages section');

const components = [];
let current = null;

const flush = () => {
  if (!current) return;
  components.push(current);
  current = null;
};

for (let i = start + 1; i < lines.length; i += 1) {
  const line = lines[i];
  if (/^\S/.test(line) && line.trim() !== '') break; // next top-level section
  const entry = /^ {2}(\S.*):$/.exec(line);
  if (entry) {
    flush();
    // key forms: name@version  |  '@scope/name@version'
    const key = entry[1].replace(/^'|'$/g, '');
    const at = key.lastIndexOf('@');
    const name = at > 0 ? key.slice(0, at) : key;
    const version = at > 0 ? key.slice(at + 1) : '0.0.0';
    current = { name, version, integrity: null, resolved: null };
    continue;
  }
  if (!current) continue;
  const res = /^ {4}resolution: \{integrity: (\S+?)(?:, tarball: (\S+?))?\}$/.exec(line);
  if (res) {
    current.integrity = res[1];
    if (res[2]) current.resolved = res[2];
  }
}
flush();

// --- first-party workspace packages ---------------------------------------
const ws = [];
for (const p of [
  'packages/governed-product-client',
  'packages/governed-product-conformance',
  'packages/governed-product-adapters',
  'packages/compliance-core-client',
]) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, p, 'package.json'), 'utf8'));
    ws.push({ name: pkg.name, version: pkg.version ?? '0.0.0', path: p });
  } catch {
    /* optional */
  }
}

const dedupe = new Map();
for (const c of components) dedupe.set(`${c.name}@${c.version}`, c);

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: '1970-01-01T00:00:00.000Z',
    component: {
      type: 'application',
      name: 'arma-api-hub',
      version: '0.0.0',
    },
    tools: [{ name: 'scripts/generate-sbom.mjs' }],
  },
  components: [
    ...ws.map((w) => ({
      type: 'library',
      name: w.name,
      version: w.version,
      group: 'first-party',
      properties: [{ name: 'workspace:path', value: w.path }],
    })),
    ...[...dedupe.values()]
      .sort((a, b) => (a.name + a.version < b.name + b.version ? -1 : 1))
      .map((c) => ({
        type: 'library',
        name: c.name,
        version: c.version,
        ...(c.resolved ? { purl: `pkg:npm/${c.name.replace('@', '%40')}@${c.version}` } : {}),
        ...(c.integrity
          ? { hashes: [{ alg: 'SHA-512', content: c.integrity.replace(/^sha512-/, '') }] }
          : {}),
      })),
  ],
};

writeFileSync(outFile, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`wrote ${outFile} (${ws.length} first-party + ${dedupe.size} third-party components)`);
