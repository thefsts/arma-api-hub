#!/usr/bin/env node
// ARMA API Hub — Software Bill of Materials (SBOM) generator.
//
// Emits a CycloneDX 1.5 JSON SBOM for the workspace. The dependency graph is
// derived from the committed `pnpm-lock.yaml` (the frozen, authoritative
// resolution) plus the workspace's own packages. Each third-party component
// carries its resolved version, integrity hash, and package URL (purl) so the
// SBOM is reproducible from the lockfile alone.
//
// Usage: node scripts/sbom.mjs [outputPath]
//   default output: dist/sbom/arma-api-hub.cdx.json
//
// Exit codes: 0 = SBOM written, 1 = lockfile missing/unparseable.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const OUT = process.argv[2] ?? join(ROOT, 'dist', 'sbom', 'arma-api-hub.cdx.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Split a `name@version` lockfile key, honouring scoped names. */
function splitNameVersion(key) {
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;
  return { name: key.slice(0, at), version: key.slice(at + 1) };
}

/** Build a purl for an npm component. */
function purl(name, version) {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.slice(1).split('/');
    return `pkg:npm/%40${scope}/${pkg}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

// --- workspace components ----------------------------------------------------

function workspacePackages() {
  const out = [];
  for (const group of ['apps', 'packages']) {
    let entries = [];
    try {
      entries = readdirSync(join(ROOT, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(ROOT, group, entry);
      if (!statSync(dir).isDirectory()) continue;
      try {
        const pkg = readJson(join(dir, 'package.json'));
        if (!pkg.name) continue;
        out.push({
          type: 'application',
          name: pkg.name,
          version: pkg.version ?? '0.0.0',
          group: `workspace:${group}`,
          purl: `pkg:npm/${pkg.name.replace('@', '%40')}@${pkg.version ?? '0.0.0'}`,
        });
      } catch {
        // no package.json in this dir
      }
    }
  }
  return out;
}

// --- lockfile parsing --------------------------------------------------------

let lock;
try {
  lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
} catch {
  console.error('sbom: pnpm-lock.yaml not found');
  process.exit(1);
}

const components = [];
const seen = new Set();
let inPackages = false;

for (const rawLine of lock.split('\n')) {
  if (/^packages:\s*$/.test(rawLine)) {
    inPackages = true;
    continue;
  }
  // A new top-level section ends the packages block.
  if (inPackages && /^[a-zA-Z]/.test(rawLine)) {
    inPackages = false;
    continue;
  }
  if (!inPackages) continue;

  const m = /^ {2}'?([^':]+)'?:\s*$/.exec(rawLine);
  if (!m) continue;
  const parsed = splitNameVersion(m[1]);
  if (!parsed || !parsed.version) continue;
  const { name, version } = parsed;
  const key = `${name}@${version}`;
  if (seen.has(key)) continue;
  seen.add(key);
  components.push({
    type: 'library',
    name,
    version,
    purl: purl(name, version),
  });
}

// Attach integrity hashes where the lockfile provides them.
const integrityByKey = new Map();
{
  let current = null;
  for (const rawLine of lock.split('\n')) {
    const head = /^ {2}'?([^':]+)'?:\s*$/.exec(rawLine);
    if (head) {
      current = head[1];
      continue;
    }
    if (current) {
      const integ = /resolution:\s*\{integrity:\s*(sha\d+-[A-Za-z0-9+/=]+)/.exec(rawLine);
      if (integ) {
        integrityByKey.set(current, integ[1]);
        current = null;
      }
    }
  }
}

for (const c of components) {
  const integ = integrityByKey.get(`${c.name}@${c.version}`);
  if (integ) {
    const [algo, value] = integ.split('-');
    c.hashes = [{ alg: algo.toUpperCase().replace('SHA', 'SHA-'), content: value }];
  }
}

const ws = workspacePackages();

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${sha256(lock).slice(0, 8)}-${sha256(lock).slice(8, 12)}-4${sha256(lock).slice(13, 16)}-8${sha256(lock).slice(17, 20)}-${sha256(lock).slice(20, 32)}`,
  version: 1,
  metadata: {
    timestamp: new Date(0).toISOString(),
    tools: [{ vendor: 'FSTS', name: 'arma-api-hub-sbom', version: '1.0.0' }],
    component: {
      type: 'application',
      name: 'arma-api-hub',
      version: readJson(join(ROOT, 'package.json')).version ?? '0.0.0',
      purl: 'pkg:npm/arma-api-hub@0.0.0',
    },
  },
  components: [...ws, ...components].sort((a, b) => a.name.localeCompare(b.name)),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bom, null, 2) + '\n', 'utf8');

const thirdParty = components.length;
const workspace = ws.length;
console.log(
  `sbom: wrote ${OUT} (CycloneDX 1.5) — ${thirdParty} third-party components, ${workspace} workspace components, ${thirdParty + workspace} total`,
);
