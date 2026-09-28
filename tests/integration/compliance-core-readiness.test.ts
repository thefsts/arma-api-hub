// Phase 7 · Chat 5 — Compliance Core integration readiness (dependency hold).
//
// These tests assert the PREPARED transport boundary and the DEPENDENCY HOLD.
// They do NOT exercise a fabricated integration: the Phase 7 Chat 1-4 contracts
// are not present, so the connection must remain PENDING and must fail closed.
//
// The suite fails if anyone:
//   - marks the integration finalized without the real contracts;
//   - invents a governed contract locally;
//   - introduces a direct API Hub -> Compliance Core Convex database path;
//   - weakens the boundary to obtain a green result.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMPLIANCE_CORE_INTEGRATION_STATUS,
  ContractsUnavailableError,
  CORE_OWNED_CONCERNS,
  REQUIRED_PHASE7_CONTRACT_IDS,
  TRANSPORT_OWNED_CONCERNS,
  assertContractsAvailable,
  isFinalized,
} from '@arma/compliance-core-client';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = fileURLToPath(
  new URL('../../contracts/compliance-core/intake-manifest.json', import.meta.url),
);

interface Manifest {
  status: string;
  requiredContracts: { id: string; status: string; producingChat: string }[];
  prohibitions: string[];
  finalizationGate: { currentResult: string };
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

describe('Compliance Core integration readiness (dependency hold)', () => {
  it('reports the integration as PENDING, never finalized', () => {
    expect(COMPLIANCE_CORE_INTEGRATION_STATUS).toBe('PENDING_DEPENDENCY');
    expect(isFinalized(COMPLIANCE_CORE_INTEGRATION_STATUS)).toBe(false);
  });

  it('fails closed when the Phase 7 contracts are absent', () => {
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

  it('intake manifest lists exactly the required contracts, all PENDING', () => {
    const manifest = readManifest();
    expect(manifest.status).toBe('PENDING_DEPENDENCY');
    expect(manifest.finalizationGate.currentResult).toBe('BLOCKED');
    const ids = manifest.requiredContracts.map((c) => c.id);
    expect([...ids].sort()).toEqual([...REQUIRED_PHASE7_CONTRACT_IDS].sort());
    for (const contract of manifest.requiredContracts) {
      expect(contract.status).toBe('PENDING');
    }
  });

  it('intake manifest forbids inventing contracts and direct DB access', () => {
    const manifest = readManifest();
    const joined = manifest.prohibitions.join(' ').toLowerCase();
    expect(joined).toContain('do not invent');
    expect(joined).toContain('convex');
  });

  it('no Phase 7 Chat 1-4 contract artifact is present yet (hold is real)', () => {
    // The intake manifest is the only compliance-core artifact; no governed
    // contract files exist, so the integration cannot be finalized.
    const contractDir = fileURLToPath(new URL('../../contracts/compliance-core/', import.meta.url));
    expect(existsSync(contractDir)).toBe(true);
    const manifest = readManifest();
    for (const contract of manifest.requiredContracts) {
      expect(contract.status).not.toBe('AVAILABLE');
    }
  });

  it('locks the authority split: Core decides, API Hub transports', () => {
    expect(CORE_OWNED_CONCERNS).toContain('compliance-authority');
    expect(CORE_OWNED_CONCERNS).toContain('legal-governance');
    expect(CORE_OWNED_CONCERNS).toContain('policy-governance');
    expect(TRANSPORT_OWNED_CONCERNS).toContain('external-transport');
    expect(TRANSPORT_OWNED_CONCERNS).toContain('routing');
    // No overlap: a concern is owned by exactly one side.
    const core = new Set<string>(CORE_OWNED_CONCERNS);
    for (const concern of TRANSPORT_OWNED_CONCERNS) {
      expect(core.has(concern)).toBe(false);
    }
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
    expect(src).not.toMatch(/_generated/);
    expect(src).not.toMatch(/from ['"]convex/);
  });

  it('architecture and failure-matrix docs are present', () => {
    expect(existsSync(`${repoRoot}docs/architecture/COMPLIANCE-CORE-INTEGRATION.md`)).toBe(true);
    expect(existsSync(`${repoRoot}docs/architecture/COMPLIANCE-CORE-FAILURE-MATRIX.md`)).toBe(true);
  });
});
