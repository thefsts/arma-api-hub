// FSTS Governed Product — reference adapters.
//
// A reference adapter is the smallest correct way for a product to consume the
// governed integration contract. It is NOT product source, and it holds no
// authority: it wires a validated manifest to a governed client and exposes only
// the operations the manifest declares.
//
// LOCKED ARCHITECTURE: PRODUCT -> GOVERNED SDK -> ARMA API HUB -> COMPLIANCE CORE.
// An adapter never opens a Compliance Core connection, never holds a Core
// credential, and never asserts a compliance state.

import {
  compileToCoreOnboardingManifest,
  createGovernedProductClient,
  isRoutableOperation,
  mapDeclaredHubScopesToCoreScopes,
  validateGovernedManifest,
} from '@fsts/governed-product-client';
import type {
  CompileInput,
  CoreOnboardingManifest,
  Environment,
  GovernedClientConfig,
  GovernedProductClient,
  GovernedProductManifest,
} from '@fsts/governed-product-client';
import { REFERENCE_MANIFESTS } from './manifests.generated.js';

export interface ReferenceAdapterConfig {
  readonly environment: Environment;
  readonly tenantId: string;
  readonly credentialReference: string;
  readonly transport: GovernedClientConfig['transport'];
  readonly clock?: () => number;
  readonly nonceFactory?: () => string;
  readonly idFactory?: (prefix: string) => string;
  readonly killSwitch?: () => boolean;
  readonly healthProbe?: GovernedClientConfig['healthProbe'];
  readonly resolveCredential?: GovernedClientConfig['resolveCredential'];
}

export interface ReferenceAdapter {
  readonly productId: string;
  readonly manifest: GovernedProductManifest;
  readonly client: GovernedProductClient;
  /** The operations this adapter exposes — exactly the manifest's routable set. */
  readonly operations: readonly string[];
  /** Project this adapter's declaration into a Core onboarding manifest. */
  compileOnboardingManifest(
    input: Omit<CompileInput, 'manifest' | 'environment' | 'tenantId' | 'coreScopes'>,
  ): CoreOnboardingManifest;
}

/**
 * Build a reference adapter from a governed manifest.
 *
 * Fails closed at construction if the manifest is invalid, if any declared
 * operation is non-routable, or if the environment/tenant/credential are not
 * acceptable to the governed client.
 */
export function createReferenceAdapter(
  manifest: GovernedProductManifest,
  config: ReferenceAdapterConfig,
): ReferenceAdapter {
  const validated = validateGovernedManifest(manifest);

  // The adapter must not expose a non-routable Core operation.
  for (const op of validated.requiredOperations) {
    if (!isRoutableOperation(op)) {
      throw new Error(
        `reference adapter ${validated.productId} declares non-routable operation ${op}; ` +
          'non-routable Core operations are never exposed through the governed SDK',
      );
    }
  }

  const client = createGovernedProductClient({
    manifest: validated,
    environment: config.environment,
    tenantId: config.tenantId,
    credentialReference: config.credentialReference,
    transport: config.transport,
    ...(config.clock ? { clock: config.clock } : {}),
    ...(config.nonceFactory ? { nonceFactory: config.nonceFactory } : {}),
    ...(config.idFactory ? { idFactory: config.idFactory } : {}),
    ...(config.killSwitch ? { killSwitch: config.killSwitch } : {}),
    ...(config.healthProbe ? { healthProbe: config.healthProbe } : {}),
    ...(config.resolveCredential ? { resolveCredential: config.resolveCredential } : {}),
  });

  return Object.freeze({
    productId: validated.productId,
    manifest: validated,
    client,
    operations: Object.freeze([...validated.requiredOperations]),
    compileOnboardingManifest(
      input: Omit<CompileInput, 'manifest' | 'environment' | 'tenantId' | 'coreScopes'>,
    ): CoreOnboardingManifest {
      // Core scopes are derived from the declared Hub scopes via the
      // authoritative Hub->Core scope registry. The adapter never invents scopes.
      const coreScopes = mapDeclaredHubScopesToCoreScopes(validated.requiredHubScopes);
      return compileToCoreOnboardingManifest({
        ...input,
        manifest: validated,
        environment: config.environment,
        tenantId: config.tenantId,
        coreScopes,
      });
    },
  });
}

function manifestFor(productId: string): GovernedProductManifest {
  const entry = REFERENCE_MANIFESTS.find((m) => m.productId === productId);
  if (!entry) throw new Error(`no reference manifest for ${productId}`);
  return entry.manifest;
}

/** ARMA System 360 — security operations. */
export function createArmaSystem360Adapter(config: ReferenceAdapterConfig): ReferenceAdapter {
  return createReferenceAdapter(manifestFor('arma-system-360'), config);
}

/** PATCHES — compliance signals. */
export function createPatchesAdapter(config: ReferenceAdapterConfig): ReferenceAdapter {
  return createReferenceAdapter(manifestFor('patches'), config);
}

/** Law Shield — legal assurance. */
export function createLawShieldAdapter(config: ReferenceAdapterConfig): ReferenceAdapter {
  return createReferenceAdapter(manifestFor('arma-law-shield'), config);
}

/** QUALIVANTA — verification. */
export function createQualivantaAdapter(config: ReferenceAdapterConfig): ReferenceAdapter {
  return createReferenceAdapter(manifestFor('qualivanta'), config);
}
