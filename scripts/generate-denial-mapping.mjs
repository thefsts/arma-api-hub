#!/usr/bin/env node
// Generates contracts/governed-product/denial-mapping.json from the single
// source of truth: packages/governed-product-client/src/denial-map.ts
//
// AMENDMENT 4 requires ONE closed deterministic Core -> Hub/SDK denial mapping
// table. The TypeScript module is authoritative; this script projects it into a
// reviewable design-record artifact. A conformance test asserts the two agree.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = resolve(root, 'packages/governed-product-client/src/denial-map.ts');
const OUT = resolve(root, 'contracts/governed-product/denial-mapping.json');

const source = readFileSync(SRC, 'utf8');

const DISPOSITIONS = { T: 'TERMINAL', H: 'HELD', C: 'CLEAN_RETRYABLE', A: 'AMBIGUOUS' };

// Line-based extraction: Prettier may render an entry on one line or across
// several, so parse structurally rather than with a single multiline regex.
const table = {};
const srcLines = source.split('\n');
for (let i = 0; i < srcLines.length; i += 1) {
  const open = /^ {2}([A-Z][A-Z0-9_]*): \{(.*)$/.exec(srcLines[i]);
  if (!open) continue;
  const [, key, inline] = open;
  let body = inline ?? '';
  if (!inline.trimEnd().endsWith('},')) {
    // multi-line entry: consume until the closing brace line
    for (let j = i + 1; j < srcLines.length; j += 1) {
      body += `\n${srcLines[j]}`;
      if (/^ {2}\},?$/.test(srcLines[j])) {
        i = j;
        break;
      }
    }
  }
  const codeMatch = /code: (?:'([^']+)'|UPSTREAM_UNAVAILABLE)/.exec(body);
  const dispMatch = /disposition: ([THCA])/.exec(body);
  const meaningMatch = /meaning: '([^']*)'/.exec(body);
  if (!codeMatch || !dispMatch || !meaningMatch) {
    throw new Error(`could not parse denial mapping entry ${key}`);
  }
  table[key] = {
    code: codeMatch[1] ?? 'UPSTREAM_UNAVAILABLE',
    disposition: DISPOSITIONS[dispMatch[1]],
    meaning: meaningMatch[1],
  };
}

function extractList(name) {
  const re = new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\] as const\\);`);
  const m = re.exec(source);
  if (!m) throw new Error(`could not locate ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const coreDenialCodes = extractList('CORE_DENIAL_CODES');
const hubDenialCodes = extractList('HUB_DENIAL_CODES');

const missing = [...coreDenialCodes, ...hubDenialCodes].filter((c) => !table[c]);
if (missing.length > 0) {
  throw new Error(`denial mapping is INCOMPLETE, missing: ${missing.join(', ')}`);
}

const doc = {
  id: 'FSTS-GOVERNED-PRODUCT-DENIAL-MAPPING',
  version: '1.0.0',
  amendment: 'POST-PHASE-8 CONTRACT RECONCILIATION AMENDMENT 4',
  description:
    'ONE closed deterministic Core -> Hub/SDK denial mapping table. Every known Phase 8 Compliance Core denial (42-code API_ERROR_CODES set) and every ARMA API Hub failure-taxonomy/routing-denial code maps to exactly one bounded SDK-facing failure and one retry disposition. The original Core code is preserved as structured cause. Unknown or unmapped codes FAIL CLOSED to UPSTREAM_UNAVAILABLE/TERMINAL. A denial is an operational outcome, never a compliance verdict.',
  source: {
    coreDenialSet: 'convex/lib/apiErrors.ts API_ERROR_CODES (Core main 2c8574d)',
    hubFailureTaxonomy:
      'contracts/compliance-core/core-handoff/registry/service/failure-taxonomy.json',
    authoritativeModule: 'packages/governed-product-client/src/denial-map.ts',
  },
  counts: {
    coreDenialCodes: coreDenialCodes.length,
    hubDenialCodes: hubDenialCodes.length,
    mappedEntries: Object.keys(table).length,
  },
  failClosedDefault: {
    code: 'UPSTREAM_UNAVAILABLE',
    disposition: 'TERMINAL',
    meaning: 'unrecognised upstream denial (failed closed)',
  },
  coreDenialCodes,
  hubDenialCodes,
  mapping: table,
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`wrote ${OUT} (${Object.keys(table).length} mapped entries)`);
