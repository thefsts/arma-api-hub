// Strict `returns` validators for every Convex function in the control plane.
//
// Every function declares an explicit `returns` validator. There is no
// `v.any()` anywhere: object shapes are strict, arrays carry explicit element
// validators, and nullable results are expressed as unions with `v.null()`.
//
// The document validators below mirror `convex/schema.ts` exactly, including
// the Convex-managed `_id` and `_creationTime` fields, so a function that
// returns a stored document validates without loosening the shape.

import { v } from 'convex/values';
import type { GenericValidator } from 'convex/values';
import {
  anomalyStatusValidator,
  auditOutcomeValidator,
  authorizationStateValidator,
  capabilityStatusValidator,
  classificationValidator,
  connectorStatusValidator,
  contractKindValidator,
  contractStatusValidator,
  costExportTargetValidator,
  costFailureClassValidator,
  costStatusValidator,
  credentialStateValidator,
  deliveryStatusValidator,
  environmentValidator,
  failureClassValidator,
  idempotencyStatusValidator,
  incidentSeverityValidator,
  incidentStatusValidator,
  killSwitchScopeValidator,
  lifecycleValidator,
  optimizationKindValidator,
  ownershipValidator,
  principalTypeValidator,
  roleValidator,
  shutdownStatusValidator,
  sourceHubValidator,
  thresholdStatusValidator,
  usageUnitValidator,
} from './validators';

// --- Core control-plane documents -------------------------------------------

export const systemDoc = v.object({
  _id: v.id('systems'),
  _creationTime: v.number(),
  systemId: v.string(),
  name: v.string(),
  slug: v.string(),
  ownership: ownershipValidator,
  lifecycle: lifecycleValidator,
  environment: environmentValidator,
  description: v.optional(v.string()),
  owner: v.string(),
  dataClassification: classificationValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const serviceDoc = v.object({
  _id: v.id('services'),
  _creationTime: v.number(),
  serviceId: v.string(),
  systemId: v.string(),
  name: v.string(),
  lifecycle: lifecycleValidator,
  environment: environmentValidator,
  audience: v.string(),
  capabilities: v.array(v.string()),
  authorizedTenantIds: v.array(v.string()),
  owner: v.string(),
  dataClassification: classificationValidator,
  killSwitchEngaged: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const externalIntegrationDoc = v.object({
  _id: v.id('externalIntegrations'),
  _creationTime: v.number(),
  integrationId: v.string(),
  name: v.string(),
  ownership: ownershipValidator,
  lifecycle: lifecycleValidator,
  environment: environmentValidator,
  owner: v.string(),
  dataClassification: classificationValidator,
  destinationAllowList: v.array(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const serviceIdentityDoc = v.object({
  _id: v.id('serviceIdentities'),
  _creationTime: v.number(),
  serviceId: v.string(),
  keyId: v.string(),
  state: credentialStateValidator,
  algorithm: v.string(),
  createdAt: v.number(),
  rotatedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  revokedReason: v.optional(v.string()),
});

export const credentialVersionDoc = v.object({
  _id: v.id('credentialVersions'),
  _creationTime: v.number(),
  serviceId: v.string(),
  keyId: v.string(),
  version: v.number(),
  state: credentialStateValidator,
  algorithm: v.string(),
  createdAt: v.number(),
  activatedAt: v.optional(v.number()),
  retiredAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  revokedReason: v.optional(v.string()),
});

export const capabilityGrantDoc = v.object({
  _id: v.id('capabilityGrants'),
  _creationTime: v.number(),
  serviceId: v.string(),
  capability: v.string(),
  scope: v.string(),
  status: capabilityStatusValidator,
  grantedAt: v.number(),
  grantedBy: v.string(),
  expiresAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

export const connectionPolicyDoc = v.object({
  _id: v.id('connectionPolicies'),
  _creationTime: v.number(),
  policyId: v.string(),
  serviceId: v.string(),
  destination: v.string(),
  allowed: v.boolean(),
  classificationCeiling: classificationValidator,
  rateLimitPerMinute: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const contractDefinitionDoc = v.object({
  _id: v.id('contractDefinitions'),
  _creationTime: v.number(),
  contractId: v.string(),
  kind: contractKindValidator,
  name: v.string(),
  description: v.string(),
  owner: v.string(),
  dataClassification: classificationValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const contractVersionDoc = v.object({
  _id: v.id('contractVersions'),
  _creationTime: v.number(),
  contractId: v.string(),
  version: v.string(),
  schemaVersion: v.string(),
  status: contractStatusValidator,
  checksum: v.string(),
  publishedAt: v.optional(v.number()),
  deprecatedAt: v.optional(v.number()),
  retiredAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const webhookEndpointDoc = v.object({
  _id: v.id('webhookEndpoints'),
  _creationTime: v.number(),
  endpointId: v.string(),
  serviceId: v.string(),
  url: v.string(),
  secretRef: v.string(),
  allowListed: v.boolean(),
  active: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const webhookDeliveryDoc = v.object({
  _id: v.id('webhookDeliveries'),
  _creationTime: v.number(),
  deliveryId: v.string(),
  endpointId: v.string(),
  eventId: v.string(),
  status: deliveryStatusValidator,
  attemptCount: v.number(),
  nextAttemptAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const deliveryAttemptDoc = v.object({
  _id: v.id('deliveryAttempts'),
  _creationTime: v.number(),
  deliveryId: v.string(),
  attempt: v.number(),
  status: deliveryStatusValidator,
  failureClass: v.optional(failureClassValidator),
  responseStatus: v.optional(v.number()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
});

export const idempotencyRecordDoc = v.object({
  _id: v.id('idempotencyRecords'),
  _creationTime: v.number(),
  idempotencyKey: v.string(),
  serviceId: v.string(),
  requestHash: v.string(),
  status: idempotencyStatusValidator,
  responseRef: v.optional(v.string()),
  createdAt: v.number(),
  expiresAt: v.number(),
});

export const nonceRecordDoc = v.object({
  _id: v.id('nonceRecords'),
  _creationTime: v.number(),
  nonce: v.string(),
  serviceId: v.string(),
  keyId: v.string(),
  seenAt: v.number(),
  expiresAt: v.number(),
});

export const eventRecordDoc = v.object({
  _id: v.id('eventRecords'),
  _creationTime: v.number(),
  eventId: v.string(),
  eventType: v.string(),
  source: v.string(),
  destination: v.string(),
  classification: classificationValidator,
  correlationId: v.string(),
  causationId: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  schemaVersion: v.string(),
  status: v.string(),
  createdAt: v.number(),
});

export const receiptRecordDoc = v.object({
  _id: v.id('receiptRecords'),
  _creationTime: v.number(),
  receiptId: v.string(),
  eventId: v.string(),
  serviceId: v.string(),
  signatureAlgorithm: v.string(),
  keyId: v.string(),
  bodyHash: v.string(),
  issuedAt: v.number(),
  verifiedAt: v.optional(v.number()),
});

export const connectorHealthDoc = v.object({
  _id: v.id('connectorHealth'),
  _creationTime: v.number(),
  connectorId: v.string(),
  serviceId: v.string(),
  status: connectorStatusValidator,
  lastCheckedAt: v.number(),
  latencyMs: v.optional(v.number()),
  errorRate: v.optional(v.number()),
  updatedAt: v.number(),
});

export const connectorIncidentDoc = v.object({
  _id: v.id('connectorIncidents'),
  _creationTime: v.number(),
  incidentId: v.string(),
  connectorId: v.string(),
  severity: incidentSeverityValidator,
  status: incidentStatusValidator,
  summary: v.string(),
  openedAt: v.number(),
  closedAt: v.optional(v.number()),
});

export const killSwitchDoc = v.object({
  _id: v.id('killSwitches'),
  _creationTime: v.number(),
  scope: killSwitchScopeValidator,
  targetId: v.string(),
  engaged: v.boolean(),
  reason: v.optional(v.string()),
  engagedBy: v.optional(v.string()),
  engagedAt: v.optional(v.number()),
  releasedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export const auditEventDoc = v.object({
  _id: v.id('auditEvents'),
  _creationTime: v.number(),
  actor: v.string(),
  action: v.string(),
  targetType: v.string(),
  targetId: v.string(),
  outcome: auditOutcomeValidator,
  correlationId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.string())),
  createdAt: v.number(),
});

export const principalAuthorizationDoc = v.object({
  _id: v.id('principalAuthorizations'),
  _creationTime: v.number(),
  principalId: v.string(),
  principalType: principalTypeValidator,
  roles: v.array(roleValidator),
  global: v.boolean(),
  systemIds: v.array(v.string()),
  serviceIds: v.array(v.string()),
  tenantIds: v.array(v.string()),
  customerRefs: v.array(v.string()),
  capabilities: v.array(v.string()),
  environments: v.array(environmentValidator),
  state: authorizationStateValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

// --- Cost & Usage Guard documents -------------------------------------------

export const apiVendorDoc = v.object({
  _id: v.id('apiVendors'),
  _creationTime: v.number(),
  vendorId: v.string(),
  name: v.string(),
  slug: v.string(),
  lifecycle: lifecycleValidator,
  environment: environmentValidator,
  owner: v.string(),
  dataClassification: classificationValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const vendorPriceVersionDoc = v.object({
  _id: v.id('vendorPriceVersions'),
  _creationTime: v.number(),
  pricingVersionId: v.string(),
  vendorId: v.string(),
  unitType: usageUnitValidator,
  unitPriceMinor: v.number(),
  currency: v.string(),
  pricingSource: v.string(),
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),
  createdAt: v.number(),
});

export const connectorSubscriptionDoc = v.object({
  _id: v.id('connectorSubscriptions'),
  _creationTime: v.number(),
  subscriptionId: v.string(),
  connectorId: v.string(),
  vendorId: v.string(),
  serviceId: v.string(),
  plan: v.string(),
  lifecycle: lifecycleValidator,
  monthlyBaseMinor: v.number(),
  currency: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const apiUsageRecordDoc = v.object({
  _id: v.id('apiUsageRecords'),
  _creationTime: v.number(),
  usageId: v.string(),
  requestId: v.string(),
  vendorId: v.string(),
  connectorId: v.string(),
  systemId: v.string(),
  serviceId: v.string(),
  tenantId: v.optional(v.string()),
  customerRef: v.optional(v.string()),
  quantity: v.number(),
  unitType: usageUnitValidator,
  correlationId: v.string(),
  causationId: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  billingPeriod: v.string(),
  recordedAt: v.number(),
});

export const apiCostEventDoc = v.object({
  _id: v.id('apiCostEvents'),
  _creationTime: v.number(),
  costEventId: v.string(),
  sourceHub: sourceHubValidator,
  eventVersion: v.string(),
  schemaVersion: v.string(),
  vendorId: v.string(),
  connectorId: v.string(),
  systemId: v.string(),
  serviceId: v.string(),
  tenantId: v.optional(v.string()),
  customerRef: v.optional(v.string()),
  correlationId: v.string(),
  causationId: v.optional(v.string()),
  idempotencyKey: v.string(),
  requestId: v.string(),
  quantity: v.number(),
  unitType: usageUnitValidator,
  amountMinor: v.number(),
  currency: v.string(),
  pricingVersionId: v.string(),
  costStatus: costStatusValidator,
  calculationVersion: v.string(),
  effectiveDate: v.number(),
  auditRef: v.string(),
  billingPeriod: v.string(),
  createdAt: v.number(),
});

export const rateLimitWindowDoc = v.object({
  _id: v.id('rateLimitWindows'),
  _creationTime: v.number(),
  windowId: v.string(),
  vendorId: v.string(),
  connectorId: v.string(),
  windowStart: v.number(),
  windowEnd: v.number(),
  limit: v.number(),
  consumed: v.number(),
  updatedAt: v.number(),
});

export const quotaAllocationDoc = v.object({
  _id: v.id('quotaAllocations'),
  _creationTime: v.number(),
  quotaId: v.string(),
  scope: v.string(),
  scopeId: v.string(),
  tenantId: v.optional(v.string()),
  customerRef: v.optional(v.string()),
  connectorId: v.optional(v.string()),
  billingPeriod: v.string(),
  limitQuantity: v.number(),
  consumedQuantity: v.number(),
  unitType: usageUnitValidator,
  thresholdStatus: thresholdStatusValidator,
  updatedAt: v.number(),
});

export const usageBudgetDoc = v.object({
  _id: v.id('usageBudgets'),
  _creationTime: v.number(),
  budgetId: v.string(),
  scope: v.string(),
  scopeId: v.string(),
  billingPeriod: v.string(),
  limitMinor: v.number(),
  consumedMinor: v.number(),
  currency: v.string(),
  warningThresholdPct: v.number(),
  thresholdStatus: thresholdStatusValidator,
  updatedAt: v.number(),
});

export const spendingLimitDoc = v.object({
  _id: v.id('spendingLimits'),
  _creationTime: v.number(),
  limitId: v.string(),
  connectorId: v.string(),
  vendorId: v.string(),
  billingPeriod: v.string(),
  limitMinor: v.number(),
  consumedMinor: v.number(),
  currency: v.string(),
  action: v.union(v.literal('WARN'), v.literal('THROTTLE'), v.literal('BLOCK')),
  thresholdStatus: thresholdStatusValidator,
  updatedAt: v.number(),
});

export const costAnomalyDoc = v.object({
  _id: v.id('costAnomalies'),
  _creationTime: v.number(),
  anomalyId: v.string(),
  vendorId: v.string(),
  connectorId: v.optional(v.string()),
  systemId: v.optional(v.string()),
  billingPeriod: v.string(),
  expectedMinor: v.number(),
  observedMinor: v.number(),
  currency: v.string(),
  deviationPct: v.number(),
  status: anomalyStatusValidator,
  detectedAt: v.number(),
  resolvedAt: v.optional(v.number()),
});

export const optimizationDecisionDoc = v.object({
  _id: v.id('optimizationDecisions'),
  _creationTime: v.number(),
  decisionId: v.string(),
  kind: optimizationKindValidator,
  connectorId: v.optional(v.string()),
  vendorId: v.optional(v.string()),
  systemId: v.optional(v.string()),
  correlationId: v.optional(v.string()),
  estimatedSavingsMinor: v.number(),
  currency: v.string(),
  applied: v.boolean(),
  reason: v.string(),
  createdAt: v.number(),
});

export const cacheUsageRecordDoc = v.object({
  _id: v.id('cacheUsageRecords'),
  _creationTime: v.number(),
  cacheRecordId: v.string(),
  connectorId: v.string(),
  vendorId: v.string(),
  tenantId: v.optional(v.string()),
  cacheKey: v.string(),
  hit: v.boolean(),
  classification: classificationValidator,
  tenantScoped: v.boolean(),
  savingsMinor: v.number(),
  currency: v.string(),
  correlationId: v.optional(v.string()),
  createdAt: v.number(),
});

export const batchUsageRecordDoc = v.object({
  _id: v.id('batchUsageRecords'),
  _creationTime: v.number(),
  batchRecordId: v.string(),
  connectorId: v.string(),
  vendorId: v.string(),
  batchSize: v.number(),
  realtimeEquivalentMinor: v.number(),
  batchedMinor: v.number(),
  savingsMinor: v.number(),
  currency: v.string(),
  correlationId: v.optional(v.string()),
  createdAt: v.number(),
});

export const retryWasteRecordDoc = v.object({
  _id: v.id('retryWasteRecords'),
  _creationTime: v.number(),
  retryRecordId: v.string(),
  connectorId: v.string(),
  vendorId: v.string(),
  requestId: v.string(),
  attempts: v.number(),
  wastedMinor: v.number(),
  currency: v.string(),
  failureClass: costFailureClassValidator,
  correlationId: v.optional(v.string()),
  createdAt: v.number(),
});

export const vendorShutdownControlDoc = v.object({
  _id: v.id('vendorShutdownControls'),
  _creationTime: v.number(),
  shutdownId: v.string(),
  vendorId: v.string(),
  connectorId: v.optional(v.string()),
  status: shutdownStatusValidator,
  reason: v.string(),
  activatedBy: v.string(),
  activatedAt: v.number(),
  releasedAt: v.optional(v.number()),
  updatedAt: v.number(),
});

export const costExportReceiptDoc = v.object({
  _id: v.id('costExportReceipts'),
  _creationTime: v.number(),
  exportReceiptId: v.string(),
  target: costExportTargetValidator,
  billingPeriod: v.string(),
  recordCount: v.number(),
  totalMinor: v.number(),
  currency: v.string(),
  contractVersion: v.string(),
  schemaVersion: v.string(),
  correlationId: v.string(),
  exportedAt: v.number(),
});

// --- Common composite validators --------------------------------------------

/** A stored document or null (for `get`-style lookups). */
export function nullable<T extends GenericValidator>(validator: T) {
  return v.union(validator, v.null());
}

/** A bounded list of stored documents. */
export function docList<T extends GenericValidator>(validator: T) {
  return v.array(validator);
}
