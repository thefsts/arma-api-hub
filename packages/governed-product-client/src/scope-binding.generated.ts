// GENERATED FILE — do not edit by hand.
// Source: contracts/compliance-core/core-handoff/registry/service/scope-registry.json

/** Authoritative Hub scope -> Core scopes mapping (verbatim from the registry). */
export const HUB_SCOPE_TO_CORE_SCOPES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'compliance.read': Object.freeze([
    'runtime:read',
    'verification:read',
    'evidence:read',
    'exception:read',
    'remediation:read',
    'readiness:read',
  ] as readonly string[]),
  'compliance.write': Object.freeze(['runtime:write'] as readonly string[]),
  'verification.submit': Object.freeze(['verification:write'] as readonly string[]),
  'evidence.metadata.write': Object.freeze(['evidence:write'] as readonly string[]),
  'policy.distribute': Object.freeze(['lifecycle:distribute'] as readonly string[]),
  'adoption.receipt.submit': Object.freeze(['lifecycle:adopt'] as readonly string[]),
  'rollback.request': Object.freeze(['lifecycle:rollback'] as readonly string[]),
  'telemetry.write': Object.freeze(['audit:write'] as readonly string[]),
});

/**
 * Map declared Hub scopes to Core scopes. Fails closed on an unmapped Hub
 * scope — a scope is never silently widened or dropped.
 */
export function mapDeclaredHubScopesToCoreScopes(hubScopes: readonly string[]): readonly string[] {
  const out = new Set<string>();
  for (const scope of hubScopes) {
    const mapped = HUB_SCOPE_TO_CORE_SCOPES[scope];
    if (!mapped) throw new Error(`hub scope "${scope}" has no Core scope mapping`);
    for (const core of mapped) out.add(core);
  }
  return Object.freeze([...out].sort());
}
