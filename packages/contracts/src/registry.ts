// ARMA API Hub — registry contracts.
//
// The registry is the single source of truth for what may participate in the
// control plane: FSTS-owned products, client-owned systems, approved partners,
// services, environments, capabilities, connections, contract versions,
// owners, data classifications, dependencies, onboarding status, and
// kill-switch state.
//
// HARD RULE (enforced by policy, modeled here): a service must not send or
// receive protected events unless it is registered, approved, active, and
// assigned the required scoped capability.

import { z } from 'zod';
import {
  dataClassificationSchema,
  environmentSchema,
  keyIdSchema,
  lifecycleSchema,
  opaqueIdSchema,
  ownershipSchema,
  schemaVersionSchema,
  serviceIdSchema,
} from './primitives.js';

/** A named owner accountable for a registered entity. */
export const ownerSchema = z.strictObject({
  ownerId: opaqueIdSchema,
  displayName: z.string().min(1).max(128),
  contactRef: z.string().min(1).max(256),
  /** Team or function, e.g. `platform-security`. */
  function: z.string().min(1).max(128).optional(),
});

/** A scoped capability a service may be granted. */
export const capabilitySchema = z.strictObject({
  capability: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/, 'capability must be dotted'),
  /** Direction of use. */
  direction: z.enum(['INBOUND', 'OUTBOUND', 'BIDIRECTIONAL']),
  /** Maximum data classification this capability may carry. */
  maxClassification: dataClassificationSchema,
  /** Whether the capability requires an explicit approval record. */
  requiresApproval: z.boolean(),
});

/** A versioned contract reference. */
export const contractVersionSchema = z.strictObject({
  contractId: z
    .string()
    .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/, 'contractId must be dotted'),
  version: schemaVersionSchema,
  status: lifecycleSchema,
  /** Deprecation metadata when status is DEPRECATED. */
  deprecatedAt: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional(),
  sunsetAt: z
    .string()
    .regex(/^\d{1,16}$/)
    .optional(),
  /** Replacement contract, if any. */
  replacedBy: z.string().min(3).max(200).optional(),
});

/** An inbound or outbound connection between services. */
export const connectionSchema = z.strictObject({
  connectionId: opaqueIdSchema,
  direction: z.enum(['INBOUND', 'OUTBOUND']),
  /** The remote service this connection talks to. */
  remoteServiceId: serviceIdSchema,
  /** Allow-listed destination reference (never a credential). */
  destinationRef: opaqueIdSchema,
  /** Contract governing the connection. */
  contract: contractVersionSchema,
  /** Capabilities exercised over this connection. */
  capabilities: z.array(z.string().min(3).max(128)),
  /** Data classification carried. */
  classification: dataClassificationSchema,
  enabled: z.boolean(),
});

/** A registered service (the runtime identity of a product or integration). */
export const serviceRecordSchema = z.strictObject({
  serviceId: serviceIdSchema,
  displayName: z.string().min(1).max(128),
  /** Owning product/system this service belongs to. */
  productId: opaqueIdSchema,
  ownership: ownershipSchema,
  environment: environmentSchema,
  lifecycle: lifecycleSchema,
  /** Onboarding status mirrors lifecycle but is tracked explicitly. */
  onboardingStatus: z.enum(['NOT_STARTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']),
  owner: ownerSchema,
  classification: dataClassificationSchema,
  capabilities: z.array(capabilitySchema),
  connections: z.array(connectionSchema),
  /** Key identifiers currently valid for this service (references only). */
  keyIds: z.array(keyIdSchema),
  /**
   * Tenant/organization identifiers this service is authorized to operate
   * within. When present and non-empty, a request carrying a tenant outside
   * this set is denied (TENANT_MISMATCH). When absent, the service is not
   * tenant-scoped and tenant isolation is enforced by the owning product.
   */
  authorizedTenantIds: z.array(opaqueIdSchema).optional(),
  /** Dependencies on other services. */
  dependencies: z.array(serviceIdSchema),
  /** Kill-switch state. When engaged, the service must fail closed. */
  killSwitchEngaged: z.boolean(),
  /** Contract versions this service produces/consumes. */
  contracts: z.array(contractVersionSchema),
});

/** A registered product or system (FSTS-owned, client-owned, or partner). */
export const productRecordSchema = z.strictObject({
  productId: opaqueIdSchema,
  displayName: z.string().min(1).max(128),
  ownership: ownershipSchema,
  /** For client/partner products, the authorizing organization. */
  authorizingOrganizationId: opaqueIdSchema.optional(),
  lifecycle: lifecycleSchema,
  owner: ownerSchema,
  classification: dataClassificationSchema,
  /** Services that belong to this product. */
  serviceIds: z.array(serviceIdSchema),
  /** Whether this product is an approved external integration. */
  approvedExternalIntegration: z.boolean(),
});

/**
 * The canonical FSTS-owned product catalog. These are the systems ARMA API Hub
 * is built to serve. External/client-owned products are registered separately
 * and must never be classified as FSTS-owned.
 */
export const FSTS_OWNED_PRODUCTS = [
  'ARMA System 360',
  'ARMA Sentinel',
  'Alert ARMA',
  'ARMA Domus',
  'ARMA Command Center',
  'ARMA Cannabis Security & Logistics',
  'Operon CRM',
  'ARMA LawShield',
  'FSTS Compliance Core',
  'FSTS AI Hub',
  'Qualivanta',
  'Regivanta',
  'PATCHES',
  'SafePlay Network',
  'PortalServexa',
  'TAYA',
  'Euphoric LS',
] as const;

export type FstsOwnedProduct = (typeof FSTS_OWNED_PRODUCTS)[number];

/**
 * Products that must NEVER be classified as FSTS-owned. PlayRaise is a
 * separately authorized client-owned integration if connected later.
 */
export const NON_FSTS_OWNED_PRODUCTS = ['PlayRaise'] as const;

export type NonFstsOwnedProduct = (typeof NON_FSTS_OWNED_PRODUCTS)[number];

/** Normalize a product name for comparison (case/space/punctuation-insensitive). */
export function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const FSTS_NORMALIZED = new Set(FSTS_OWNED_PRODUCTS.map(normalizeProductName));
const NON_FSTS_NORMALIZED = new Set(NON_FSTS_OWNED_PRODUCTS.map(normalizeProductName));

/** True when the product name is in the FSTS-owned catalog. */
export function isFstsOwnedProduct(name: string): boolean {
  return FSTS_NORMALIZED.has(normalizeProductName(name));
}

/** True when the product name is explicitly NOT FSTS-owned. */
export function isNonFstsOwnedProduct(name: string): boolean {
  return NON_FSTS_NORMALIZED.has(normalizeProductName(name));
}

/**
 * Classify a product name. Returns the ownership classification, or `null`
 * when the name is unknown (callers must treat unknown as requiring explicit
 * registration and approval — never assume FSTS ownership).
 */
export function classifyProductOwnership(name: string): 'FSTS_OWNED' | 'CLIENT_OWNED' | null {
  if (isFstsOwnedProduct(name)) return 'FSTS_OWNED';
  if (isNonFstsOwnedProduct(name)) return 'CLIENT_OWNED';
  return null;
}

export type Owner = z.infer<typeof ownerSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type ContractVersion = z.infer<typeof contractVersionSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type ServiceRecord = z.infer<typeof serviceRecordSchema>;
export type ProductRecord = z.infer<typeof productRecordSchema>;
