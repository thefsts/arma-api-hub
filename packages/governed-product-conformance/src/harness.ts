// FSTS Governed Product Conformance Kit — harness.
//
// Deterministic black-box harness. It injects a fixed clock, a deterministic
// nonce/id factory, and a scripted fake Hub transport. No test depends on
// wall-clock time or network. The same manifest and the same client produce the
// same report every run.

import { canonicalize, sha256Hex } from '@arma/compliance-core-client';
import type { GovernedRequest } from '@arma/compliance-core-client';
import { createGovernedProductClient, createFakeHubTransport } from '@fsts/governed-product-client';
import type {
  GovernedClientConfig,
  GovernedProductClient,
  GovernedProductManifest,
  HubResponse,
  HubTransport,
} from '@fsts/governed-product-client';

export interface HarnessOptions {
  readonly manifest: GovernedProductManifest;
  readonly environment: GovernedClientConfig['environment'];
  readonly tenantId: string;
  readonly credentialReference: string;
  readonly script: (req: GovernedRequest, body: string) => HubResponse | Promise<HubResponse>;
  readonly clock?: () => number;
  readonly nonceFactory?: () => string;
  readonly idFactory?: (prefix: string) => string;
  readonly killSwitch?: () => boolean;
  readonly healthProbe?: GovernedClientConfig['healthProbe'];
  readonly resolveCredential?: GovernedClientConfig['resolveCredential'];
}

export interface Harness {
  readonly client: GovernedProductClient;
  readonly transport: HubTransport & { readonly sent: GovernedRequest[] };
}

let seq = 0;
export function deterministicId(prefix: string): string {
  seq += 1;
  return `${prefix}-0000-${seq.toString(16).padStart(8, '0')}`;
}
export function deterministicNonce(): string {
  seq += 1;
  return `nonce-0000-${seq.toString(16).padStart(8, '0')}`;
}

export const FIXED_NOW = 1_800_000_000_000;
export const TEST_SECRET = 'conformance-short-lived-signing-material';

export function makeHarness(opts: HarnessOptions): Harness {
  const transport = createFakeHubTransport(opts.script);
  const client = createGovernedProductClient({
    manifest: opts.manifest,
    environment: opts.environment,
    tenantId: opts.tenantId,
    credentialReference: opts.credentialReference,
    transport,
    clock: opts.clock ?? (() => FIXED_NOW),
    nonceFactory: opts.nonceFactory ?? deterministicNonce,
    idFactory: opts.idFactory ?? deterministicId,
    ...(opts.killSwitch ? { killSwitch: opts.killSwitch } : {}),
    ...(opts.healthProbe ? { healthProbe: opts.healthProbe } : {}),
    resolveCredential: opts.resolveCredential ?? (async () => ({ secret: TEST_SECRET })),
  });
  return { client, transport };
}

/** A deterministic, fully-routable synthetic subject manifest. */
export function baseManifest(
  overrides: Partial<GovernedProductManifest> = {},
): GovernedProductManifest {
  const base: GovernedProductManifest = {
    manifestVersion: '1.0.0',
    integrationVersion: '1.0.0',
    productId: 'conformance-subject',
    displayName: 'Conformance Subject',
    productType: 'OTHER_APPROVED',
    ownership: 'FSTS_OWNED',
    owner: { team: 'Conformance', contactRef: 'conformance@fsts.invalid', function: 'platform' },
    supportedEnvironments: ['DEVELOPMENT', 'PREVIEW', 'PRODUCTION'],
    hubRoute: {
      routingIdentity: 'svc-conformance-subject',
      apiHubContractVersion: '1.0.0',
      apiHubVersion: '1.0.0',
      coreVersion: '1.0.0',
      apiVersion: '1.0.0',
      directCoreAccess: false,
    },
    requiredOperations: ['evidence.record', 'readiness.snapshot.get'],
    requiredHubScopes: ['evidence.metadata.write', 'compliance.read'],
    credentialReference: {
      required: true,
      referenceScheme: 'hub-keyid',
      rotationExpectation: 'ROTATE_ON_SCHEDULE',
      secretMaterial: false,
    },
    evidenceClassifications: {
      maxClassification: 'PROTECTED',
      evidenceSensitive: true,
      rawSensitiveEvidence: false,
      referenceOnly: true,
    },
    healthExpectations: {
      healthOperation: 'readiness.snapshot.get',
      readinessContractId: 'compliance-core.health.readiness.v1',
      maxStalenessMs: 300_000,
    },
    retryExpectations: {
      scheduleMs: [1000, 5000, 30000, 120000, 600000],
      maxAttempts: 5,
      ambiguousPolicy: 'RECONCILE',
      heldPolicy: 'PRESERVE',
    },
    killSwitch: { required: true, scope: 'PRODUCT', scopeRef: 'conformance-subject' },
    conformance: {
      suiteVersion: '1.0.0',
      requiredAreas: [
        'no-direct-core-access',
        'identity-binding',
        'tenant-binding',
        'product-binding',
        'environment-binding',
        'scope-enforcement',
        'operation-enforcement',
        'credential-references-only',
        'signing-integrity',
        'freshness',
        'nonce-replay',
        'idempotency',
        'version-mismatch',
        'route-mismatch',
        'suspension',
        'revocation',
        'kill-switch',
        'hub-outage',
        'core-outage',
        'bounded-errors',
        'audit-correlation',
        'raw-evidence-rejection',
        'false-compliance-claims',
      ],
    },
  };
  return { ...base, ...overrides };
}

export function manifestHash(manifest: GovernedProductManifest): string {
  return sha256Hex(canonicalize(manifest));
}
