// ARMA API Hub — Convex control-plane guardrails.
//
// A deterministic, dependency-light static analyzer over `convex/**`. It parses
// every module with the TypeScript compiler API and enforces the Phase 0
// security and correctness invariants. It is used in two places:
//
//   * `scripts/convex-guardrails.mjs` (CLI) — run by CI.
//   * `tests/convex/guardrails.test.ts` — run by the test suite.
//
// Both share the same `analyzeConvex()` implementation so a rule can never be
// enforced in one place and silently skipped in the other.
//
// Rules enforced:
//   1. Every Convex function declares an explicit `args` validator.
//   2. Every Convex function declares an explicit `returns` validator.
//   3. No `Date.now()` (or other nondeterminism) inside a query handler.
//   4. No unbounded `.collect()`.
//   5. No database `.filter()` usage.
//   6. No public sensitive function without an authorization call.
//   7. No public service-scoped function trusting an unverified caller service ID.
//   8. No public function depending on `ctx.auth` without a committed
//      `convex/auth.config.ts`.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const WRAPPERS = new Set([
  'query',
  'mutation',
  'internalQuery',
  'internalMutation',
  'action',
  'internalAction',
]);
const QUERY_WRAPPERS = new Set(['query', 'internalQuery']);
const PUBLIC_WRAPPERS = new Set(['query', 'mutation', 'action']);

// Any of these calls counts as an authorization check.
const AUTHZ_CALLS = new Set([
  'requireAuthorizationContext',
  'requireGlobal',
  'requireAdminAuthority',
  'requireRole',
  'requireSystemScope',
  'requireServiceScope',
  'requireTenantScope',
  'requireCustomerScope',
  'requireCapability',
  'requireEnvironment',
  'requireServiceBinding',
  'requireConnectorScope',
  'requireScopeByKind',
  'requireRowScope',
  'getVerifiedSubject',
  'resolveAuthorizationContext',
]);

const NONDETERMINISTIC = ['Date.now', 'Math.random', 'new Date'];

/** Recursively collect `.ts` files under a directory, skipping `_generated`. */
function collectFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === '_generated' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function getProperty(obj, name) {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ((ts.isIdentifier(prop.name) && prop.name.text === name) ||
        (ts.isStringLiteral(prop.name) && prop.name.text === name))
    ) {
      return prop;
    }
  }
  return null;
}

/** True when the call expression's receiver chain text contains `ctx.db`. */
function chainContainsDb(callNode, source) {
  const text = callNode.expression.getText(source);
  return text.includes('ctx.db');
}

/** Walk a subtree, invoking `visit` on every node. */
function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * Analyze the Convex source tree and return a structured report.
 *
 * @param {string} root repository root (defaults to the script's parent dir)
 */
export function analyzeConvex(root = process.cwd()) {
  const convexDir = join(root, 'convex');
  const files = collectFiles(convexDir);
  const functions = [];
  const violations = [];

  const authConfigPath = join(convexDir, 'auth.config.ts');
  const hasAuthConfig = existsSync(authConfigPath);

  let publicUsesAuth = false;

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const rel = relative(root, file);

    walk(source, (node) => {
      if (!ts.isVariableDeclaration(node)) return;
      if (!node.initializer || !ts.isCallExpression(node.initializer)) return;
      const callee = node.initializer.expression;
      if (!ts.isIdentifier(callee) || !WRAPPERS.has(callee.text)) return;

      const wrapper = callee.text;
      const name = ts.isIdentifier(node.name) ? node.name.text : '<anonymous>';
      const arg = node.initializer.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) return;

      const argsProp = getProperty(arg, 'args');
      const returnsProp = getProperty(arg, 'returns');
      const handlerProp = getProperty(arg, 'handler');
      const handler = handlerProp ? handlerProp.initializer : null;
      const handlerText = handler ? handler.getText(source) : '';

      const record = {
        file: rel,
        name,
        wrapper,
        hasArgs: Boolean(argsProp),
        hasReturns: Boolean(returnsProp),
        isPublic: PUBLIC_WRAPPERS.has(wrapper),
        isQuery: QUERY_WRAPPERS.has(wrapper),
      };
      functions.push(record);

      if (!argsProp) {
        violations.push({
          rule: 'missing-args',
          file: rel,
          name,
          message: `Convex function "${name}" is missing an explicit \`args\` validator.`,
        });
      }
      if (!returnsProp) {
        violations.push({
          rule: 'missing-returns',
          file: rel,
          name,
          message: `Convex function "${name}" is missing an explicit \`returns\` validator.`,
        });
      }

      if (record.isQuery && handler) {
        for (const token of NONDETERMINISTIC) {
          if (handlerText.includes(token)) {
            violations.push({
              rule: 'nondeterministic-query',
              file: rel,
              name,
              message: `Query "${name}" uses nondeterministic "${token}" inside its handler.`,
            });
          }
        }
      }

      if (handler) {
        walk(handler, (inner) => {
          if (!ts.isCallExpression(inner)) return;
          const innerCallee = inner.expression;
          if (ts.isPropertyAccessExpression(innerCallee)) {
            const method = innerCallee.name.text;
            if (method === 'collect') {
              violations.push({
                rule: 'unbounded-collect',
                file: rel,
                name,
                message: `Function "${name}" calls unbounded \`.collect()\`; use a bounded \`.take(n)\`.`,
              });
            }
            if (method === 'filter' && chainContainsDb(inner, source)) {
              violations.push({
                rule: 'db-filter',
                file: rel,
                name,
                message: `Function "${name}" uses database \`.filter()\`; use an index instead.`,
              });
            }
          }
        });
      }

      if (record.isPublic) {
        const callsAuthz = [...AUTHZ_CALLS].some((fn) => handlerText.includes(`${fn}(`));
        if (!callsAuthz) {
          violations.push({
            rule: 'public-without-authz',
            file: rel,
            name,
            message: `Public function "${name}" does not perform an authorization check.`,
          });
        }
        if (handlerText.includes('ctx.auth')) {
          publicUsesAuth = true;
        }
        const argsText = argsProp ? argsProp.getText(source) : '';
        if (argsText.includes('serviceId')) {
          if (!handlerText.includes('requireServiceBinding(')) {
            violations.push({
              rule: 'unverified-service-id',
              file: rel,
              name,
              message: `Public function "${name}" accepts a caller-supplied \`serviceId\` without \`requireServiceBinding\`.`,
            });
          }
        }
      }
    });
  }

  if (publicUsesAuth && !hasAuthConfig) {
    violations.push({
      rule: 'missing-auth-config',
      file: 'convex/auth.config.ts',
      name: '<auth>',
      message:
        'A public function depends on `ctx.auth` but no `convex/auth.config.ts` is committed.',
    });
  }

  return {
    functions,
    violations,
    hasAuthConfig,
    counts: {
      total: functions.length,
      withArgs: functions.filter((f) => f.hasArgs).length,
      withReturns: functions.filter((f) => f.hasReturns).length,
      public: functions.filter((f) => f.isPublic).length,
      internal: functions.filter((f) => !f.isPublic).length,
    },
  };
}

function main() {
  const report = analyzeConvex(process.cwd());
  const { counts, violations } = report;

  console.log('Convex guardrails');
  console.log('-----------------');
  console.log(`Functions analyzed:      ${counts.total}`);
  console.log(`  with args validator:   ${counts.withArgs}`);
  console.log(`  with returns validator:${counts.withReturns}`);
  console.log(`  public:                ${counts.public}`);
  console.log(`  internal:              ${counts.internal}`);
  console.log(`auth.config.ts present:  ${report.hasAuthConfig}`);

  if (violations.length > 0) {
    console.error(`\n${violations.length} guardrail violation(s):`);
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file} :: ${v.name} — ${v.message}`);
    }
    process.exit(1);
  }
  console.log('\nAll Convex guardrails satisfied.');
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main();
}
