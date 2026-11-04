// FSTS Governed Product Client — governed manifest compiler.
//
// Compiles a governed product manifest (Hub-scope vocabulary) into the Compliance
// Core's authoritative onboarding-intake manifest (Core-scope vocabulary). The
// two vocabularies are intentionally distinct: the product declares Hub scopes;
// the Hub maps them to Core scopes via the authoritative scope registry; the Core
// re-derives every authorization decision from its own registries.
//
// The compiler is a PURE projection. It never asserts authority, never advances
// onboarding state, and never carries secret material. APPROVED != ACTIVE.
//
// The Core `ONBOARDING_MANIFEST_VERSION` is 1.0.0 and its shape is consumed
// verbatim from `convex/lib/onboardingManifest.ts`.

import { MANIFEST_VERSION } from './constants.js';
import { GovernedClientConfigError } from './errors.js';
import {
  containsSecretPattern,
  looksLikeSecretMaterial,
  validateGovernedManifest,
} from './manifest.js';
import type { GovernedProductManifest } from './manifest.js';

export const CORE_ONBOARDING_MANIFEST_VERSION = '1.0.0';

const CORE_SCOPE_PATTERN = /^[a-z][a-z0-9]*:[a-z][a-z0-9_-]*$/;
const ID_PATTERN = /^[A-Za-z0-9._:/@-]{3,256}$/;

export interface CoreOnboardingManifest {
  readonly manifestId: string;
  readonly manifestVersion: string;
  readonly product: {
    readonly productId: string;
    readonly productName: string;
    readonly owningSystem: string;
  };
  readonly integration: {
    readonly environment: string;
    readonly apiContractVersion: string;
    readonly apiHubVersion: string;
    readonly coreVersion: string;
    readonly apiHubRoutingId: string;
    readonly allowedOperations: readonly string[];
    readonly allowedScopes: readonly string[];
  };
  readonly serviceIdentity: {
    readonly serviceIdentityId: string;
    readonly serviceName: string;
    readonly allowedEnvironments: readonly string[];
    readonly allowedProducts: readonly string[];
    readonly allowedTenants: readonly string[];
    readonly allowedScopes: readonly string[];
    readonly credentialRef: string;
    readonly credentialExpiresAt: number;
    readonly rotationDueAt?: number;
  };
  readonly tenantBindings: readonly {
    readonly bindingType: 'PRODUCT' | 'SERVICE' | 'ENVIRONMENT' | 'SCOPE';
    readonly targetTenantId: string;
    readonly environment?: string;
    readonly scope?: string;
  }[];
  readonly requestedBy: string;
  readonly reason: string;
  readonly correlationId: string;
}

export interface CompileInput {
  readonly manifest: GovernedProductManifest;
  readonly environment: string;
  readonly tenantId: string;
  /** Core scopes derived Hub-side via the authoritative scope registry. */
  readonly coreScopes: readonly string[];
  readonly credentialExpiresAt: number;
  readonly rotationDueAt?: number;
  readonly requestedBy: string;
  readonly reason: string;
  readonly correlationId: string;
  readonly manifestId?: string;
}

/**
 * Compile a governed manifest into a Core onboarding-intake manifest. Fails
 * closed on any secret material, missing Core scope, or unsupported environment.
 */
export function compileToCoreOnboardingManifest(input: CompileInput): CoreOnboardingManifest {
  const manifest = validateGovernedManifest(input.manifest);

  if (!manifest.supportedEnvironments.includes(input.environment as never)) {
    throw new GovernedClientConfigError(
      'ENVIRONMENT_DENIED',
      `environment ${input.environment} is not declared in supportedEnvironments`,
    );
  }
  if (!ID_PATTERN.test(input.tenantId)) {
    throw new GovernedClientConfigError('CONFIG_INVALID', 'tenantId has an invalid format');
  }
  if (input.coreScopes.length === 0) {
    throw new GovernedClientConfigError('SCOPE_DENIED', 'at least one Core scope is required');
  }
  for (const scope of input.coreScopes) {
    if (!CORE_SCOPE_PATTERN.test(scope)) {
      throw new GovernedClientConfigError('SCOPE_DENIED', `invalid Core scope ${scope}`);
    }
  }
  for (const value of [input.requestedBy, input.reason, input.correlationId]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new GovernedClientConfigError(
        'CONFIG_INVALID',
        'requestedBy, reason and correlationId are required',
      );
    }
    if (looksLikeSecretMaterial(value)) {
      throw new GovernedClientConfigError(
        'CONFIG_INVALID',
        'manifest context must not carry secret material',
      );
    }
  }
  if (manifest.credentialReference.secretMaterial !== false) {
    throw new GovernedClientConfigError(
      'CONFIG_INVALID',
      'credentialReference must never carry secret material',
    );
  }

  const manifestId =
    input.manifestId ?? `FSTS-GOVERNED-${manifest.productId}-${manifest.integrationVersion}`;

  const out: CoreOnboardingManifest = {
    manifestId,
    manifestVersion: CORE_ONBOARDING_MANIFEST_VERSION,
    product: {
      productId: manifest.productId,
      productName: manifest.displayName,
      owningSystem: manifest.ownership,
    },
    integration: {
      environment: input.environment,
      apiContractVersion: manifest.hubRoute.apiHubContractVersion,
      apiHubVersion: manifest.hubRoute.apiHubVersion,
      coreVersion: manifest.hubRoute.coreVersion,
      apiHubRoutingId: manifest.hubRoute.routingIdentity,
      allowedOperations: Object.freeze([...manifest.requiredOperations]),
      allowedScopes: Object.freeze([...input.coreScopes]),
    },
    serviceIdentity: {
      serviceIdentityId: manifest.hubRoute.routingIdentity,
      serviceName: manifest.displayName,
      allowedEnvironments: Object.freeze([...manifest.supportedEnvironments]),
      allowedProducts: Object.freeze([manifest.productId]),
      allowedTenants: Object.freeze([input.tenantId]),
      allowedScopes: Object.freeze([...input.coreScopes]),
      credentialRef: manifest.credentialReference.referenceScheme,
      credentialExpiresAt: input.credentialExpiresAt,
      ...(input.rotationDueAt !== undefined ? { rotationDueAt: input.rotationDueAt } : {}),
    },
    tenantBindings: Object.freeze([
      { bindingType: 'PRODUCT' as const, targetTenantId: input.tenantId },
    ]),
    requestedBy: input.requestedBy,
    reason: input.reason,
    correlationId: input.correlationId,
  };

  // Final structural guard: no secret material anywhere in the compiled manifest.
  const serialized = JSON.stringify(out);
  if (containsSecretPattern(serialized)) {
    throw new GovernedClientConfigError(
      'CONFIG_INVALID',
      'compiled manifest contains secret-like material',
    );
  }
  return out;
}

export const GOVERNED_MANIFEST_VERSION = MANIFEST_VERSION;
