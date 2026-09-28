#!/usr/bin/env node
// ARMA API Hub — workspace dependency hygiene check.
//
// Verifies:
//  - every workspace package declares a name and version;
//  - no dependency uses a floating "*" or "latest" range;
//  - internal workspace deps use the "workspace:" protocol;
//  - the root engines pin Node 24 and the pinned package manager.
//
// Exit codes: 0 = clean, 1 = findings.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const findings = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspaceDirs() {
  const dirs = [];
  for (const group of ['apps', 'packages']) {
    const base = join(ROOT, group);
    let entries = [];
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(base, entry);
      if (statSync(full).isDirectory()) dirs.push(full);
    }
  }
  return dirs;
}

const root = readJson(join(ROOT, 'package.json'));

if (!root.engines || !/>=24/.test(root.engines.node ?? '')) {
  findings.push('root package.json must enforce Node >=24 in engines.node');
}
if (!root.packageManager || !/^pnpm@/.test(root.packageManager)) {
  findings.push('root package.json must pin a pnpm packageManager');
}

const names = new Set();
const dirs = workspaceDirs();

for (const dir of dirs) {
  let pkg;
  try {
    pkg = readJson(join(dir, 'package.json'));
  } catch {
    findings.push(`${dir}: missing package.json`);
    continue;
  }
  if (!pkg.name) findings.push(`${dir}: missing name`);
  if (!pkg.version) findings.push(`${dir}: missing version`);
  if (pkg.name) names.add(pkg.name);

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = pkg[field] ?? {};
    for (const [dep, range] of Object.entries(deps)) {
      if (range === '*' || range === 'latest') {
        findings.push(`${pkg.name}: ${field}.${dep} uses floating range "${range}"`);
      }
    }
  }
}

// Internal deps must use workspace: protocol.
for (const dir of dirs) {
  let pkg;
  try {
    pkg = readJson(join(dir, 'package.json'));
  } catch {
    continue;
  }
  for (const field of ['dependencies', 'devDependencies']) {
    const deps = pkg[field] ?? {};
    for (const [dep, range] of Object.entries(deps)) {
      if (names.has(dep) && !String(range).startsWith('workspace:')) {
        findings.push(`${pkg.name}: ${field}.${dep} must use the workspace: protocol`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`dependency-check: ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`dependency-check: clean (${dirs.length} workspace packages).`);
