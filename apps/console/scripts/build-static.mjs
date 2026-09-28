#!/usr/bin/env node
// Build the console static shell into dist/index.html.
//
// This build performs NO operating-system package installation and requires no
// privileged credentials. It renders the compiled shell module.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const distDir = join(appRoot, 'dist');

const { renderConsoleShell } = await import(join(distDir, 'shell.js'));

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'index.html'), renderConsoleShell(), 'utf8');
console.log('console: wrote dist/index.html');
