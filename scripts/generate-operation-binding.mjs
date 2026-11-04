#!/usr/bin/env node
// Generate the governed-product operation binding module from the authoritative
// projection at contracts/governed-product/operation-hub-scope.json.
//
// The projection is itself GENERATED from the vendored Core registry. This script
// only projects it into a typed TypeScript module so the client can fail closed
// on operations that have no Hub scope. It is never hand-edited.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const projectionPath = join(root, 'contracts/governed-product/operation-hub-scope.json');
const outPath = join(root, 'packages/governed-product-client/src/operation-binding.generated.ts');

const projection = JSON.parse(readFileSync(projectionPath, 'utf8'));

const lines = [];
lines.push('// GENERATED FILE — do not edit by hand.');
lines.push('// Source: contracts/governed-product/operation-hub-scope.json');
lines.push(`// coreMainSha: ${projection.source.coreMainSha}`);
lines.push(
  `// operations: ${projection.counts.operations}, routable: ${projection.counts.routable}, unroutable: ${projection.counts.unroutable}`,
);
lines.push('');
lines.push('export interface OperationBinding {');
lines.push('  readonly requiredCoreScope: string;');
lines.push('  readonly hubScopes: readonly string[];');
lines.push("  readonly kind: 'READ' | 'WRITE';");
lines.push('  readonly resourceType: string;');
lines.push('  readonly evidenceSensitive: boolean;');
lines.push('  readonly idempotencyScope: string | null;');
lines.push('}');
lines.push('');
lines.push(`export const OPERATION_COUNT = ${projection.counts.operations} as const;`);
lines.push(`export const ROUTABLE_OPERATION_COUNT = ${projection.counts.routable} as const;`);
lines.push(`export const UNROUTABLE_OPERATION_COUNT = ${projection.counts.unroutable} as const;`);
lines.push('');
lines.push(
  'export const OPERATION_BINDING: Readonly<Record<string, OperationBinding>> = Object.freeze({',
);
for (const [op, b] of Object.entries(projection.operations)) {
  const hubScopes = JSON.stringify(b.hubScopes);
  const idem = b.idempotencyScope === null ? 'null' : JSON.stringify(b.idempotencyScope);
  lines.push(`  ${JSON.stringify(op)}: Object.freeze({`);
  lines.push(`    requiredCoreScope: ${JSON.stringify(b.requiredCoreScope)},`);
  lines.push(`    hubScopes: Object.freeze(${hubScopes} as readonly string[]),`);
  lines.push(`    kind: ${JSON.stringify(b.kind)} as 'READ' | 'WRITE',`);
  lines.push(`    resourceType: ${JSON.stringify(b.resourceType)},`);
  lines.push(`    evidenceSensitive: ${b.evidenceSensitive},`);
  lines.push(`    idempotencyScope: ${idem},`);
  lines.push('  }),');
}
lines.push('});');
lines.push('');
lines.push('/** True when the operation has at least one Hub scope and is therefore routable. */');
lines.push('export function isRoutableOperation(operationId: string): boolean {');
lines.push('  const b = OPERATION_BINDING[operationId];');
lines.push('  return b !== undefined && b.hubScopes.length > 0;');
lines.push('}');
lines.push('');

writeFileSync(outPath, lines.join('\n'), 'utf8');
process.stdout.write(`wrote ${outPath} (${projection.counts.operations} operations)\n`);

// --- Hub -> Core scope binding ---------------------------------------------
// Static projection of the authoritative Hub->Core scope registry so adapters
// and the compiler can derive Core scopes without filesystem access.
const scopeRegistryPath = join(
  root,
  'contracts/compliance-core/core-handoff/registry/service/scope-registry.json',
);
const scopeRegistry = JSON.parse(readFileSync(scopeRegistryPath, 'utf8'));
const scopeOutPath = join(root, 'packages/governed-product-client/src/scope-binding.generated.ts');

const scopeLines = [];
scopeLines.push('// GENERATED FILE — do not edit by hand.');
scopeLines.push(
  '// Source: contracts/compliance-core/core-handoff/registry/service/scope-registry.json',
);
scopeLines.push('');
scopeLines.push(
  '/** Authoritative Hub scope -> Core scopes mapping (verbatim from the registry). */',
);
scopeLines.push(
  'export const HUB_SCOPE_TO_CORE_SCOPES: Readonly<Record<string, readonly string[]>> = Object.freeze({',
);
for (const [hub, core] of Object.entries(scopeRegistry.hubScopeToCoreScopes)) {
  scopeLines.push(
    `  ${JSON.stringify(hub)}: Object.freeze(${JSON.stringify(core)} as readonly string[]),`,
  );
}
scopeLines.push('});');
scopeLines.push('');
scopeLines.push('/**');
scopeLines.push(' * Map declared Hub scopes to Core scopes. Fails closed on an unmapped Hub');
scopeLines.push(' * scope — a scope is never silently widened or dropped.');
scopeLines.push(' */');
scopeLines.push('export function mapDeclaredHubScopesToCoreScopes(');
scopeLines.push('  hubScopes: readonly string[],');
scopeLines.push('): readonly string[] {');
scopeLines.push('  const out = new Set<string>();');
scopeLines.push('  for (const scope of hubScopes) {');
scopeLines.push('    const mapped = HUB_SCOPE_TO_CORE_SCOPES[scope];');
scopeLines.push(
  '    if (!mapped) throw new Error(`hub scope "${scope}" has no Core scope mapping`);',
);
scopeLines.push('    for (const core of mapped) out.add(core);');
scopeLines.push('  }');
scopeLines.push('  return Object.freeze([...out].sort());');
scopeLines.push('}');
scopeLines.push('');

writeFileSync(scopeOutPath, scopeLines.join('\n'), 'utf8');
process.stdout.write(
  `wrote ${scopeOutPath} (${Object.keys(scopeRegistry.hubScopeToCoreScopes).length} hub scopes)\n`,
);
