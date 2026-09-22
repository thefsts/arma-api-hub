#!/usr/bin/env node
// ARMA API Hub — repository secret scan.
//
// Scans tracked files for high-signal secret patterns and refuses to pass if
// any are found. This is a defense-in-depth gate, not a substitute for a
// dedicated secret-scanning service. It intentionally errs toward failing
// closed on obvious credential material.
//
// Exit codes: 0 = clean, 1 = findings.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'OpenAI-style key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: 'Generic bearer assignment',
    re: /(?:secret|token|password|passwd|api[_-]?key)\s*[:=]\s*['"][^'"]{16,}['"]/i,
  },
];

// Files that must never be tracked.
const FORBIDDEN_TRACKED = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function isProbablyBinary(buf) {
  const sample = buf.subarray(0, 8000);
  return sample.includes(0);
}

const findings = [];
const files = trackedFiles();

for (const file of files) {
  for (const forbidden of FORBIDDEN_TRACKED) {
    if (forbidden.test(file)) {
      findings.push({ file, line: 0, name: 'Forbidden tracked file', detail: file });
    }
  }

  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue;
  }
  if (isProbablyBinary(buf)) continue;

  const text = buf.toString('utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) {
        findings.push({ file, line: i + 1, name, detail: line.trim().slice(0, 120) });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`secret-scan: ${findings.length} potential finding(s):`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} [${f.name}] ${f.detail}`);
  }
  process.exit(1);
}

console.log(`secret-scan: clean (${files.length} tracked files scanned).`);
