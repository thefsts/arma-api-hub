// Phase 7 · Chat 5 — Compliance Core integration readiness (FINALIZED).
//
// The dependency hold is RELEASED. The Phase 7 Chat 1-4 convergence is merged
// into Core main @ c7ac04b and consumed verbatim by the API Hub transport
// client. These tests assert the FINALIZED boundary and, critically, that the
// boundary still FAILS CLOSED.
//
// The suite fails if anyone:
//   - marks the integration finalized without the real converged contracts;
//   - invents or renames a governed contract, field, version, scope, or code;
//   - introduces a direct API Hub -> Compliance Core Convex database path;
//   - widens an unmapped Hub scope, downgrades an unsupported version, or
//     surfaces raw internal failure text;
//   - weakens the boundary to obtain a green result.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_CORE_INTEGRATION_STATUS,
  COMPLIANCE_CORE_MAIN_SHA,
  CORE_HANDOFF_MANIFEST_ID,
  CORE_OWNED_CONCERNS,
  ContractsUnavailableError,
  REQUIRED_PHASE7_CONTRACT_IDS,
  TRANSPORT_OWNED_CONCERNS,
  assertContractsAvailable,
  classifyCoreFailure,
  isFinalized,
  loadCoreHandoffManifest,
  loadFailureTaxonomy,
  loadScopeRegistry,
  loadVersionNegotiation,
  mapHubScopesToCoreScopes,
  negotiateApiVersion,
} from '@arma/compliance-core-client';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = fileURLToPath(
  new URL('../../contracts/compliance-core/intake-manifest.json', import.meta.url),
);
const coreHandoffDir = fileURLToPath(
  new URL('../../contracts/compliance-core/core-handoff', import.meta.url),
);

interface Manifest {
  status: string;
  baselines: { complianceCore: { sha: string } };
  coreHandoff: { manifestId: string; pinnedSha: string };
  requiredContracts: { id: string; status: string; producingChat: string }[];
  prohibitions: string[];
  finalizationGate: { currentResult: string };
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

describe('Compliance Core integration readiness (FINALIZED)', () => {
  it('reports the integration as FINALIZED against the converged Core SHA', () => {
    expect(COMPLIANCE_CORE_INTEGRATION_STATUS).toBe('FINALIZED');
    expect(isFinalized(COMPLIANCE_CORE_INTEGRATION_STATUS)).toBe(true);
    expect(COMPLIANCE_CORE_MAIN_SHA).toBe('c7ac04b2d40624bef1742f819a9f7eee43e3d12c');
    expect(CORE_HANDOFF_MANIFEST_ID).toBe('FSTS-PHASE7-CORE-CONVERGENCE-HANDOFF');
  });

  it('fails closed when any converged contract is absent', () => {
    let thrown: unknown;
    try {
      assertContractsAvailable([]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ContractsUnavailableError);
    const err = thrown as ContractsUnavailableError;
    expect(err.code).toBe('COMPLIANCE_CORE_CONTRACTS_UNAVAILABLE');
    expect(err.missing.length).toBe(REQUIRED_PHASE7_CONTRACT_IDS.length);
  });

  it('passes only when every required contract id is present', () => {
    expect(() => assertContractsAvailable(REQUIRED_PHASE7_CONTRACT_IDS)).not.toThrow();
    expect(() => assertContractsAvailable(REQUIRED_PHASE7_CONTRACT_IDS.slice(1))).toThrow(
      ContractsUnavailableError,
    );
  });

  it('intake manifest lists exactly the 12 required contracts, all AVAILABLE', () => {
    const manifest = readManifest();
    expect(manifest.status).toBe('AVAILABLE');
    expect(manifest.finalizationGate.currentResult).toBe('READY_FOR_PM_REVIEW');
    const ids = manifest.requiredContracts.map((c) => c.id);
    expect(ids.length).toBe(12);
    expect([...ids].sort()).toEqual([...REQUIRED_PHASE7_CONTRACT_IDS].sort());
    for (const contract of manifest.requiredContracts) {
      expect(contract.status).toBe('AVAILABLE');
    }
  });

  it('intake manifest pins the converged Core baseline and handoff manifest', () => {
    const manifest = readManifest();
    expect(manifest.baselines.complianceCore.sha).toBe(COMPLIANCE_CORE_MAIN_SHA);
    expect(manifest.coreHandoff.pinnedSha).toBe(COMPLIANCE_CORE_MAIN_SHA);
    expect(manifest.coreHandoff.manifestId).toBe(CORE_HANDOFF_MANIFEST_ID);
  });

  it('intake manifest forbids inventing contracts and direct DB access', () => {
    const manifest = readManifest();
    const joined = manifest.prohibitions.join(' ').toLowerCase();
    expect(joined).toContain('do not invent');
    expect(joined).toContain('convex');
    expect(joined).toContain('transport outcome');
  });

  it('consumes the REAL vendored Core handoff manifest verbatim', () => {
    const manifest = loadCoreHandoffManifest(coreHandoffDir);
    expect(manifest.manifestId).toBe(CORE_HANDOFF_MANIFEST_ID);
    expect(manifest.manifestVersion).toBe('1.0.0');
    // The single authoritative boundary is the Core's governed pipeline.
    expect(manifest.singleBoundary.pipeline).toBe('runGovernedPipeline');
  });

  it('locks the authority split: Core decides, API Hub transports', () => {
    expect(CORE_OWNED_CONCERNS).toContain('compliance-authority-state');
    expect(CORE_OWNED_CONCERNS).toContain('legal-regulatory-governance');
    expect(CORE_OWNED_CONCERNS).toContain('policy-governance');
    expect(TRANSPORT_OWNED_CONCERNS).toContain('external-api-transport');
    expect(TRANSPORT_OWNED_CONCERNS).toContain('routing');
    // No overlap: a concern is owned by exactly one side.
    const core = new Set<string>(CORE_OWNED_CONCERNS);
    for (const concern of TRANSPORT_OWNED_CONCERNS) {
      expect(core.has(concern)).toBe(false);
    }
  });

  it('maps Hub scopes to Core scopes and fails closed on an unmapped scope', () => {
    const scopeRegistry = loadScopeRegistry(coreHandoffDir);
    const mapped = mapHubScopesToCoreScopes(['compliance.read'], scopeRegistry);
    expect(mapped.length).toBeGreaterThan(0);
    expect(() => mapHubScopesToCoreScopes(['not.a.real.scope'], scopeRegistry)).toThrow(
      /no Core scope mapping/,
    );
  });

  it('classifies known failures and fails closed to INTERNAL_FAILURE', () => {
    const taxonomy = loadFailureTaxonomy(coreHandoffDir);
    const known = taxonomy.codes[0];
    expect(known).toBeDefined();
    expect(classifyCoreFailure(known!.code, taxonomy).code).toBe(known!.code);
    // Unknown code never leaks raw text; it collapses to the bounded fallback.
    expect(classifyCoreFailure('TOTALLY_UNKNOWN_CODE', taxonomy).code).toBe('INTERNAL_FAILURE');
  });

  it('negotiates only supported versions and fails closed otherwise', () => {
    const versionRegistry = loadVersionNegotiation(coreHandoffDir);
    expect(negotiateApiVersion('v1', versionRegistry)).toEqual({ ok: true, apiVersion: 'v1' });
    expect(negotiateApiVersion('v99', versionRegistry).ok).toBe(false);
    expect(negotiateApiVersion(undefined, versionRegistry).ok).toBe(false);
  });

  it('transport client has no direct Convex database dependency', () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL('../../packages/compliance-core-client/package.json', import.meta.url),
        ),
        'utf8',
      ),
    ) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).not.toContain('convex');
    const src = readFileSync(
      fileURLToPath(new URL('../../packages/compliance-core-client/src/index.ts', import.meta.url)),
      'utf8',
    );
    // No Convex import / client. The `_generated` and `Convex*` tokens appear
    // only inside the client's own guard regexes, never as real imports.
    expect(src).not.toMatch(/import[^;]*from\s+['"][^'"]*_generated/);
    expect(src).not.toMatch(/from\s+['"]convex/);
    expect(src).not.toMatch(/require\(\s*['"]convex/);
  });

  it('architecture and failure-matrix docs are present', () => {
    expect(existsSync(`${repoRoot}docs/architecture/COMPLIANCE-CORE-INTEGRATION.md`)).toBe(true);
    expect(existsSync(`${repoRoot}docs/architecture/COMPLIANCE-CORE-FAILURE-MATRIX.md`)).toBe(true);
  });
});
