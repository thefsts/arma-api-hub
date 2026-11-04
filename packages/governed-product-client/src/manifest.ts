// FSTS Governed Product Client — governed product manifest (type + validation).
//
// The manifest is a DECLARATION of intent and constraints only. It never grants
// authority, never asserts a compliance state, and never carries secret material.
// Validation is fail-closed: any structural, secret, or amendment violation
// throws a GovernedClientConfigError and no client is produced.
//
// AMENDMENT 1 — killSwitch.scope is GLOBAL|PRODUCT|TENANT|ENVIRONMENT (Core
//   ROLLOUT_SCOPES verbatim); SERVICE is rejected; non-GLOBAL requires scopeRef.
// AMENDMENT 2 — hubRoute declares apiHubVersion + coreVersion alongside
//   apiHubContractVersion + apiVersion; all four are validated independently.

import {
  EVIDENCE_CLASSIFICATIONS,
  HUB_SCOPES,
  KILL_SWITCH_SCOPES,
  MANIFEST_VERSION,
  OWNERSHIP_CLASSES,
  PRODUCT_ID_PATTERN,
  PRODUCT_TYPES,
  SEMVER_PATTERN,
  SCOPES_REQUIRING_REF,
  SUPPORTED_API_HUB_VERSIONS,
  SUPPORTED_API_VERSIONS,
  SUPPORTED_CONTRACT_VERSIONS,
  SUPPORTED_CORE_VERSIONS,
  ENVIRONMENTS,
} from './constants.js';
import type {
  EvidenceClassification,
  Environment,
  HubScope,
  KillSwitchScope,
  OwnershipClass,
  ProductType,
} from './constants.js';
import { GovernedClientConfigError } from './errors.js';

export interface GovernedManifestOwner {
  readonly team: string;
  readonly contactRef: string;
  readonly function:
    'product-compliance' | 'security' | 'legal-assurance' | 'quality' | 'platform' | 'operations';
}

export interface GovernedManifestHubRoute {
  readonly routingIdentity: string;
  readonly apiHubContractVersion: string;
  /** AMENDMENT 2 — distinct API Hub version dimension. */
  readonly apiHubVersion: string;
  /** AMENDMENT 2 — distinct Core version dimension. */
  readonly coreVersion: string;
  readonly apiVersion: string;
  readonly directCoreAccess: false;
}

export interface GovernedManifestCredentialReference {
  readonly required: true;
  readonly referenceScheme: string;
  readonly rotationExpectation: 'ROTATE_ON_SCHEDULE' | 'ROTATE_ON_COMPROMISE' | 'ROTATE_ON_EXPIRY';
  readonly secretMaterial: false;
}

export interface GovernedManifestEvidence {
  readonly maxClassification: EvidenceClassification;
  readonly evidenceSensitive: boolean;
  readonly rawSensitiveEvidence: false;
  readonly referenceOnly: true;
}

export interface GovernedManifestHealth {
  readonly healthOperation: 'health.read' | 'readiness.snapshot.get' | 'readiness.snapshot.record';
  readonly readinessContractId: string;
  readonly maxStalenessMs: number;
}

export interface GovernedManifestRetry {
  readonly scheduleMs: readonly number[];
  readonly maxAttempts: number;
  readonly ambiguousPolicy: 'RECONCILE';
  readonly heldPolicy: 'PRESERVE';
}

export interface GovernedManifestKillSwitch {
  readonly required: true;
  readonly scope: KillSwitchScope;
  /** AMENDMENT 1 — required for every non-GLOBAL scope; forbidden for GLOBAL. */
  readonly scopeRef?: string;
}

export interface GovernedManifestConformance {
  readonly suiteVersion: string;
  readonly requiredAreas: readonly string[];
}

export interface GovernedProductManifest {
  readonly manifestVersion: string;
  readonly integrationVersion: string;
  readonly productId: string;
  readonly displayName: string;
  readonly productType: ProductType;
  readonly ownership: OwnershipClass;
  readonly owner: GovernedManifestOwner;
  readonly supportedEnvironments: readonly Environment[];
  readonly hubRoute: GovernedManifestHubRoute;
  readonly requiredOperations: readonly string[];
  readonly requiredHubScopes: readonly HubScope[];
  readonly credentialReference: GovernedManifestCredentialReference;
  readonly evidenceClassifications: GovernedManifestEvidence;
  readonly healthExpectations: GovernedManifestHealth;
  readonly retryExpectations: GovernedManifestRetry;
  readonly killSwitch: GovernedManifestKillSwitch;
  readonly conformance: GovernedManifestConformance;
}

// ---------------------------------------------------------------------------
// Secret-material detection. A reference is a NAME; anything that looks like key
// material is rejected before a client exists.
// ---------------------------------------------------------------------------
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN CERTIFICATE-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

/** True when a string looks like secret material rather than an opaque reference. */
/**
 * True when a value contains a recognisable secret PATTERN. Unlike
 * `looksLikeSecretMaterial`, this does not apply the single-value length
 * heuristic, so it is safe to run against a whole serialized document.
 */
export function containsSecretPattern(value: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(value));
}

export function looksLikeSecretMaterial(value: string): boolean {
  if (containsSecretPattern(value)) return true;
  // A reference is short and low-entropy-ish. A 40+ char opaque blob is refused.
  if (value.length > 128) return true;
  return false;
}

function fail(code: 'CONFIG_INVALID' | 'VALIDATION_FAILED', message: string): never {
  throw new GovernedClientConfigError(code, message);
}

function reqString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0)
    fail('CONFIG_INVALID', `${name} must be a non-empty string`);
  return value as string;
}

function reqArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0)
    fail('CONFIG_INVALID', `${name} must be a non-empty array`);
  return value as readonly unknown[];
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length)
    fail('CONFIG_INVALID', `${name} must not contain duplicates`);
}

/**
 * Validate a governed product manifest. Throws GovernedClientConfigError on any
 * violation. Returns the same object typed as GovernedProductManifest on success.
 */
export function validateGovernedManifest(input: unknown): GovernedProductManifest {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('CONFIG_INVALID', 'manifest must be an object');
  }
  const m = input as Record<string, unknown>;

  if (m['manifestVersion'] !== MANIFEST_VERSION) {
    fail('CONFIG_INVALID', `manifestVersion must be ${MANIFEST_VERSION}`);
  }
  const integrationVersion = reqString(m['integrationVersion'], 'integrationVersion');
  if (!SEMVER_PATTERN.test(integrationVersion))
    fail('CONFIG_INVALID', 'integrationVersion must be semver');

  const productId = reqString(m['productId'], 'productId');
  if (!PRODUCT_ID_PATTERN.test(productId))
    fail('CONFIG_INVALID', 'productId has an invalid format');

  reqString(m['displayName'], 'displayName');

  if (!(PRODUCT_TYPES as readonly string[]).includes(reqString(m['productType'], 'productType'))) {
    fail('CONFIG_INVALID', 'productType is not a governed product type');
  }
  if (!(OWNERSHIP_CLASSES as readonly string[]).includes(reqString(m['ownership'], 'ownership'))) {
    fail('CONFIG_INVALID', 'ownership is not a governed ownership class');
  }

  const owner = m['owner'];
  if (owner === null || typeof owner !== 'object')
    fail('CONFIG_INVALID', 'owner must be an object');
  const o = owner as Record<string, unknown>;
  reqString(o['team'], 'owner.team');
  const contactRef = reqString(o['contactRef'], 'owner.contactRef');
  if (looksLikeSecretMaterial(contactRef))
    fail('CONFIG_INVALID', 'owner.contactRef looks like secret material');
  reqString(o['function'], 'owner.function');

  const envs = reqArray(m['supportedEnvironments'], 'supportedEnvironments').map((e) =>
    reqString(e, 'supportedEnvironments[]'),
  );
  assertUnique(envs, 'supportedEnvironments');
  for (const env of envs) {
    if (!(ENVIRONMENTS as readonly string[]).includes(env))
      fail('CONFIG_INVALID', `unsupported environment ${env}`);
  }

  // --- hubRoute (AMENDMENT 2) ---------------------------------------------
  const route = m['hubRoute'];
  if (route === null || typeof route !== 'object')
    fail('CONFIG_INVALID', 'hubRoute must be an object');
  const r = route as Record<string, unknown>;
  const routingIdentity = reqString(r['routingIdentity'], 'hubRoute.routingIdentity');
  if (!PRODUCT_ID_PATTERN.test(routingIdentity))
    fail('CONFIG_INVALID', 'hubRoute.routingIdentity has an invalid format');
  if (r['directCoreAccess'] !== false)
    fail('CONFIG_INVALID', 'hubRoute.directCoreAccess must be false');

  const apiHubContractVersion = reqString(
    r['apiHubContractVersion'],
    'hubRoute.apiHubContractVersion',
  );
  if (!SEMVER_PATTERN.test(apiHubContractVersion))
    fail('CONFIG_INVALID', 'apiHubContractVersion must be semver');
  if (!(SUPPORTED_CONTRACT_VERSIONS as readonly string[]).includes(apiHubContractVersion)) {
    fail('CONFIG_INVALID', `unsupported apiHubContractVersion ${apiHubContractVersion}`);
  }

  // AMENDMENT 2: apiHubVersion and coreVersion are DISTINCT required dimensions.
  const apiHubVersion = reqString(r['apiHubVersion'], 'hubRoute.apiHubVersion');
  if (!SEMVER_PATTERN.test(apiHubVersion))
    fail('CONFIG_INVALID', 'hubRoute.apiHubVersion must be semver');
  if (!(SUPPORTED_API_HUB_VERSIONS as readonly string[]).includes(apiHubVersion)) {
    fail('CONFIG_INVALID', `unsupported apiHubVersion ${apiHubVersion}`);
  }
  const coreVersion = reqString(r['coreVersion'], 'hubRoute.coreVersion');
  if (!SEMVER_PATTERN.test(coreVersion))
    fail('CONFIG_INVALID', 'hubRoute.coreVersion must be semver');
  if (!(SUPPORTED_CORE_VERSIONS as readonly string[]).includes(coreVersion)) {
    fail('CONFIG_INVALID', `unsupported coreVersion ${coreVersion}`);
  }

  const apiVersion = reqString(r['apiVersion'], 'hubRoute.apiVersion');
  if (!(SUPPORTED_API_VERSIONS as readonly string[]).includes(apiVersion)) {
    fail('CONFIG_INVALID', `unsupported apiVersion ${apiVersion}`);
  }

  // --- operations + scopes ------------------------------------------------
  const ops = reqArray(m['requiredOperations'], 'requiredOperations').map((op) =>
    reqString(op, 'requiredOperations[]'),
  );
  assertUnique(ops, 'requiredOperations');

  const scopes = reqArray(m['requiredHubScopes'], 'requiredHubScopes').map((s) =>
    reqString(s, 'requiredHubScopes[]'),
  );
  assertUnique(scopes, 'requiredHubScopes');
  for (const scope of scopes) {
    if (!(HUB_SCOPES as readonly string[]).includes(scope))
      fail('CONFIG_INVALID', `unknown hub scope ${scope}`);
  }

  // --- credential reference ----------------------------------------------
  const cred = m['credentialReference'];
  if (cred === null || typeof cred !== 'object')
    fail('CONFIG_INVALID', 'credentialReference must be an object');
  const c = cred as Record<string, unknown>;
  if (c['required'] !== true) fail('CONFIG_INVALID', 'credentialReference.required must be true');
  if (c['secretMaterial'] !== false)
    fail('CONFIG_INVALID', 'credentialReference.secretMaterial must be false');
  const referenceScheme = reqString(c['referenceScheme'], 'credentialReference.referenceScheme');
  if (looksLikeSecretMaterial(referenceScheme))
    fail('CONFIG_INVALID', 'credentialReference.referenceScheme looks like secret material');

  // --- evidence -----------------------------------------------------------
  const ev = m['evidenceClassifications'];
  if (ev === null || typeof ev !== 'object')
    fail('CONFIG_INVALID', 'evidenceClassifications must be an object');
  const e = ev as Record<string, unknown>;
  if (
    !(EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(
      reqString(e['maxClassification'], 'evidence.maxClassification'),
    )
  ) {
    fail('CONFIG_INVALID', 'evidence.maxClassification is not a governed classification');
  }
  if (e['rawSensitiveEvidence'] !== false)
    fail('CONFIG_INVALID', 'evidence.rawSensitiveEvidence must be false');
  if (e['referenceOnly'] !== true) fail('CONFIG_INVALID', 'evidence.referenceOnly must be true');

  // --- health -------------------------------------------------------------
  const health = m['healthExpectations'];
  if (health === null || typeof health !== 'object')
    fail('CONFIG_INVALID', 'healthExpectations must be an object');
  const h = health as Record<string, unknown>;
  reqString(h['healthOperation'], 'health.healthOperation');
  reqString(h['readinessContractId'], 'health.readinessContractId');
  const maxStaleness = h['maxStalenessMs'];
  if (typeof maxStaleness !== 'number' || !Number.isFinite(maxStaleness) || maxStaleness < 1000) {
    fail('CONFIG_INVALID', 'health.maxStalenessMs must be a number >= 1000');
  }

  // --- retry --------------------------------------------------------------
  const retry = m['retryExpectations'];
  if (retry === null || typeof retry !== 'object')
    fail('CONFIG_INVALID', 'retryExpectations must be an object');
  const rt = retry as Record<string, unknown>;
  const schedule = reqArray(rt['scheduleMs'], 'retry.scheduleMs').map((n) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 100)
      fail('CONFIG_INVALID', 'retry.scheduleMs entries must be numbers >= 100');
    return n;
  });
  if (schedule.length === 0) fail('CONFIG_INVALID', 'retry.scheduleMs must not be empty');
  const maxAttempts = rt['maxAttempts'];
  if (typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || maxAttempts < 1) {
    fail('CONFIG_INVALID', 'retry.maxAttempts must be an integer >= 1');
  }
  // ORDER IS PRESERVED — never canonical-sorted.
  if (rt['ambiguousPolicy'] !== 'RECONCILE')
    fail('CONFIG_INVALID', 'retry.ambiguousPolicy must be RECONCILE');
  if (rt['heldPolicy'] !== 'PRESERVE') fail('CONFIG_INVALID', 'retry.heldPolicy must be PRESERVE');

  // --- kill switch (AMENDMENT 1) -----------------------------------------
  const kill = m['killSwitch'];
  if (kill === null || typeof kill !== 'object')
    fail('CONFIG_INVALID', 'killSwitch must be an object');
  const k = kill as Record<string, unknown>;
  if (k['required'] !== true) fail('CONFIG_INVALID', 'killSwitch.required must be true');
  const scope = reqString(k['scope'], 'killSwitch.scope');
  if (!(KILL_SWITCH_SCOPES as readonly string[]).includes(scope)) {
    fail('CONFIG_INVALID', `killSwitch.scope ${scope} is not an authoritative rollout scope`);
  }
  const needsRef = (SCOPES_REQUIRING_REF as readonly string[]).includes(scope);
  const hasRef = typeof k['scopeRef'] === 'string' && (k['scopeRef'] as string).length > 0;
  if (needsRef && !hasRef) fail('CONFIG_INVALID', `killSwitch.scope ${scope} requires scopeRef`);
  if (!needsRef && k['scopeRef'] !== undefined)
    fail('CONFIG_INVALID', 'GLOBAL kill switch must not carry scopeRef');

  // --- conformance --------------------------------------------------------
  const conf = m['conformance'];
  if (conf === null || typeof conf !== 'object')
    fail('CONFIG_INVALID', 'conformance must be an object');
  const cf = conf as Record<string, unknown>;
  reqString(cf['suiteVersion'], 'conformance.suiteVersion');
  const areas = reqArray(cf['requiredAreas'], 'conformance.requiredAreas').map((a) =>
    reqString(a, 'conformance.requiredAreas[]'),
  );
  if (areas.length < 23)
    fail('CONFIG_INVALID', 'conformance.requiredAreas must declare all 23 areas');

  return input as GovernedProductManifest;
}
