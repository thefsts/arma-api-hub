// Reference adapter tests.
//
// Proves each of the four reference adapters (a) consumes its authoritative
// manifest unchanged, (b) exposes only routable operations, (c) compiles to a
// Core onboarding manifest that carries the full version triple, and (d) never
// opens a direct Core path.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFakeHubTransport,
  isRoutableOperation,
  validateGovernedManifest,
} from '@fsts/governed-product-client';
import {
  REFERENCE_MANIFESTS,
  createArmaSystem360Adapter,
  createLawShieldAdapter,
  createPatchesAdapter,
  createQualivantaAdapter,
} from './index.js';

const allow = () => ({ ok: true as const, body: '{"accepted":true}', correlationId: 'corr-hub' });

const factories = {
  'arma-system-360': createArmaSystem360Adapter,
  patches: createPatchesAdapter,
  'arma-law-shield': createLawShieldAdapter,
  qualivanta: createQualivantaAdapter,
} as const;

function baseConfig(manifest: (typeof REFERENCE_MANIFESTS)[number]) {
  return {
    environment: manifest.manifest.supportedEnvironments[0] as 'PRODUCTION',
    tenantId: 'tenant-reference',
    credentialReference: `hub-keyid:${manifest.productId}`,
    transport: createFakeHubTransport(allow),
    resolveCredential: async () => ({ secret: 'reference-short-lived-signing-material' }),
    clock: () => 1_800_000_000_000,
    nonceFactory: () => 'nonce-0000-00000001',
    idFactory: (p: string) => `${p}-0000-00000001`,
  };
}

describe('reference adapters', () => {
  it('ships exactly the four first-wave reference products', () => {
    expect(REFERENCE_MANIFESTS.map((m) => m.productId)).toEqual([
      'arma-system-360',
      'arma-law-shield',
      'patches',
      'qualivanta',
    ]);
  });

  it('generated manifests match the authoritative JSON on disk (no drift)', () => {
    for (const entry of REFERENCE_MANIFESTS) {
      const onDisk = JSON.parse(
        readFileSync(
          resolve(process.cwd(), 'contracts/governed-product/reference-adapters', entry.sourceFile),
          'utf8',
        ),
      );
      expect(entry.manifest, entry.productId).toEqual(onDisk);
    }
  });

  for (const entry of REFERENCE_MANIFESTS) {
    describe(entry.productId, () => {
      it('validates against the amended manifest contract', () => {
        expect(() => validateGovernedManifest(entry.manifest)).not.toThrow();
      });

      it('declares only routable operations', () => {
        for (const op of entry.manifest.requiredOperations) {
          expect(isRoutableOperation(op), `${entry.productId}:${op}`).toBe(true);
        }
      });

      it('carries the complete version triple (AMENDMENT 2)', () => {
        expect(entry.manifest.hubRoute.apiVersion).toBeTruthy();
        expect(entry.manifest.hubRoute.apiHubVersion).toBeTruthy();
        expect(entry.manifest.hubRoute.coreVersion).toBeTruthy();
        expect(entry.manifest.hubRoute.directCoreAccess).toBe(false);
      });

      it('uses an authoritative rollout scope with a scopeRef (AMENDMENT 1)', () => {
        const ks = entry.manifest.killSwitch;
        expect(['GLOBAL', 'PRODUCT', 'TENANT', 'ENVIRONMENT']).toContain(ks.scope);
        if (ks.scope !== 'GLOBAL') expect(ks.scopeRef).toBeTruthy();
      });

      it('builds a governed client that never exposes a direct Core path', () => {
        const factory = factories[entry.productId as keyof typeof factories];
        const adapter = factory(baseConfig(entry));
        expect(adapter.client.identity.productId).toBe(entry.productId);
        expect(adapter.operations).toEqual([...entry.manifest.requiredOperations]);
        // Only the Hub transport is reachable; there is no Core client on the adapter.
        expect(Object.keys(adapter)).not.toContain('core');
      });

      it('compiles to a Core onboarding manifest with all three version dimensions', () => {
        const factory = factories[entry.productId as keyof typeof factories];
        const adapter = factory(baseConfig(entry));
        const onboarding = adapter.compileOnboardingManifest({
          credentialExpiresAt: 1_900_000_000_000,
          requestedBy: 'reference@fsts.invalid',
          reason: 'reference adapter compile check',
          correlationId: 'corr-reference-0001',
        });
        expect(onboarding.integration.apiContractVersion).toBe(
          entry.manifest.hubRoute.apiHubContractVersion,
        );
        expect(onboarding.integration.apiHubVersion).toBe(entry.manifest.hubRoute.apiHubVersion);
        expect(onboarding.integration.coreVersion).toBe(entry.manifest.hubRoute.coreVersion);
        expect(onboarding.integration.apiHubRoutingId).toBe(
          entry.manifest.hubRoute.routingIdentity,
        );
        expect(onboarding.serviceIdentity.serviceIdentityId).toBe(
          entry.manifest.hubRoute.routingIdentity,
        );
        expect(onboarding.integration.allowedOperations).toEqual([
          ...entry.manifest.requiredOperations,
        ]);
        expect(onboarding.integration.allowedScopes.length).toBeGreaterThan(0);
      });

      it('makes a governed call through the Hub and never claims compliance', async () => {
        const factory = factories[entry.productId as keyof typeof factories];
        const adapter = factory(baseConfig(entry));
        const op = entry.manifest.requiredOperations[0] as string;
        const res = await adapter.client.call(op, {
          resourceId: 'res-1',
          payload: { reference: 'ref-1' },
        });
        expect(res.ok).toBe(true);
        expect(Object.keys(res)).not.toContain('compliant');
      });
    });
  }

  it('refuses to expose a non-routable operation', async () => {
    // A manifest that declares a non-routable Core operation must fail closed at
    // adapter construction rather than silently widening the surface.
    const { createReferenceAdapter } = await import('./adapters.js');
    const broken = {
      ...REFERENCE_MANIFESTS[0]!.manifest,
      requiredOperations: ['exception.decide'],
    };
    expect(() => createReferenceAdapter(broken, baseConfig(REFERENCE_MANIFESTS[0]!))).toThrow(
      /non-routable operation/,
    );
  });
});
