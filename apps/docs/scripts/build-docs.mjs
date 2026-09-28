#!/usr/bin/env node
// Render the repository docs/ directory into a minimal static site.
//
// No operating-system package installation is performed. Markdown is rendered
// with a small, dependency-free converter sufficient for the docs index.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const repoRoot = join(appRoot, '..', '..');
const docsRoot = join(repoRoot, 'docs');
const outDir = join(appRoot, 'dist', 'site');

const SECTIONS = ['architecture', 'decisions', 'onboarding', 'planning', 'runbooks', 'security'];

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    if (line.startsWith('### ')) out.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    else if (line.startsWith('## ')) out.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) out.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    else if (line.trim() === '') out.push('');
    else out.push(`<p>${escapeHtml(line)}</p>`);
  }
  return out.join('\n');
}

mkdirSync(outDir, { recursive: true });

const index = [];
for (const section of SECTIONS) {
  const dir = join(docsRoot, section);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    continue;
  }
  for (const file of files) {
    const md = readFileSync(join(dir, file), 'utf8');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>${file}</title></head><body>${renderMarkdown(md)}</body></html>`;
    writeFileSync(join(outDir, `${section}--${file.replace(/\.md$/, '')}.html`), html, 'utf8');
    index.push(
      `<li><a href="${section}--${file.replace(/\.md$/, '')}.html">${section}/${file}</a></li>`,
    );
  }
}

writeFileSync(
  join(outDir, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>ARMA API Hub Docs</title></head><body><h1>ARMA API Hub Documentation</h1><ul>${index.join('')}</ul></body></html>`,
  'utf8',
);
console.log(`docs: rendered ${index.length} document(s) to dist/site`);
