// Convex guardrails — repository test.
//
// Fails when a Convex function is committed without both `args` and `returns`,
// or when any other Phase 0 invariant is broken. The analyzer is shared with
// the CI script (`scripts/convex-guardrails.mjs`) so the rules cannot drift.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations.
import { analyzeConvex } from '../../scripts/convex-guardrails.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('Convex guardrails', () => {
  it('every Convex function declares an explicit args validator', () => {
    const { functions } = analyzeConvex(repoRoot);
    const missing = functions.filter((f) => !f.hasArgs).map((f) => `${f.file}::${f.name}`);
    expect(missing).toEqual([]);
    expect(functions.length).toBeGreaterThan(0);
  });

  it('every Convex function declares an explicit returns validator', () => {
    const { functions } = analyzeConvex(repoRoot);
    const missing = functions.filter((f) => !f.hasReturns).map((f) => `${f.file}::${f.name}`);
    expect(missing).toEqual([]);
  });

  it('reports no guardrail violations across the control plane', () => {
    const { violations } = analyzeConvex(repoRoot);
    expect(violations).toEqual([]);
  });

  it('no public (client-callable) control-plane functions remain in Phase 0', () => {
    const { counts } = analyzeConvex(repoRoot);
    expect(counts.public).toBe(0);
  });
});

describe('Convex guardrails — analyzer self-test', () => {
  const dirs: string[] = [];

  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'arma-guardrails-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'convex'), { recursive: true });
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(dir, 'convex', name), contents);
    }
    return dir;
  }

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('flags a function missing args and returns', () => {
    const dir = fixture({
      'bad.ts': `import { internalQuery } from './_generated/server';
export const bad = internalQuery({
  handler: async () => null,
});
`,
    });
    const { violations } = analyzeConvex(dir);
    const rules = violations.map((v: { rule: string }) => v.rule);
    expect(rules).toContain('missing-args');
    expect(rules).toContain('missing-returns');
  });

  it('flags Date.now() inside a query handler', () => {
    const dir = fixture({
      'bad.ts': `import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
export const bad = internalQuery({
  args: {},
  returns: v.number(),
  handler: async () => Date.now(),
});
`,
    });
    const { violations } = analyzeConvex(dir);
    expect(violations.map((v: { rule: string }) => v.rule)).toContain('nondeterministic-query');
  });

  it('flags unbounded collect() and database filter()', () => {
    const dir = fixture({
      'bad.ts': `import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
export const bad = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const rows = await ctx.db.query('systems').collect();
    const filtered = await ctx.db.query('systems').filter((q) => q.eq(q.field('name'), 'x')).take(5);
    return [...rows, ...filtered].map((r) => r.name);
  },
});
`,
    });
    const { violations } = analyzeConvex(dir);
    const rules = violations.map((v: { rule: string }) => v.rule);
    expect(rules).toContain('unbounded-collect');
    expect(rules).toContain('db-filter');
  });

  it('flags a public function without an authorization call', () => {
    const dir = fixture({
      'bad.ts': `import { v } from 'convex/values';
import { query } from './_generated/server';
export const bad = query({
  args: {},
  returns: v.null(),
  handler: async () => null,
});
`,
    });
    const { violations } = analyzeConvex(dir);
    expect(violations.map((v: { rule: string }) => v.rule)).toContain('public-without-authz');
  });

  it('flags a public function trusting a caller-supplied serviceId', () => {
    const dir = fixture({
      'bad.ts': `import { v } from 'convex/values';
import { query } from './_generated/server';
export const bad = query({
  args: { serviceId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAuthorizationContext(ctx);
    return null;
  },
});
`,
    });
    const { violations } = analyzeConvex(dir);
    expect(violations.map((v: { rule: string }) => v.rule)).toContain('unverified-service-id');
  });
});
