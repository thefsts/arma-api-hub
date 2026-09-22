// ARMA API Hub — Convex schema.
//
// This schema is the control-plane data model. It stores registry, identity,
// contract, webhook, delivery, idempotency, nonce, event, receipt, connector,
// kill-switch, and audit records.
//
// It must never store raw private keys, plaintext secrets, full protected
// payloads, LawShield evidence, payment-card data, cannabis regulator
// credentials, camera/audio evidence, or unrelated product data. Credential
// tables hold key *references* only; key material lives in a secrets manager.
//
// Every expected read path is backed by an index. No unbounded `.collect()` is
// used by the functions in this directory.

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  anomalyStatusValidator,
  auditOutcomeValidator,
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
  shutdownStatusValidator,
  sourceHubValidator,
  thresholdStatusValidator,
  usageUnitValidator,
} from './lib/validators';

export default defineSchema({
  // FSTS-owned products, client systems, and partners.
  systems: defineTable({
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
  })
    .index('by_systemId', ['systemId'])
    .index('by_slug', ['slug'])
    .index('by_ownership', ['ownership'])
    .index('by_lifecycle', ['lifecycle'])
    .index('by_environment', ['environment']),

  // Registered services that may send or receive events.
  services: defineTable({
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
  })
    .index('by_serviceId', ['serviceId'])
    .index('by_systemId', ['systemId'])
    .index('by_lifecycle', ['lifecycle'])
    .index('by_environment', ['environment'])
    .index('by_killSwitchEngaged', ['killSwitchEngaged']),

  // External / client integrations, registered separately from FSTS products.
  externalIntegrations: defineTable({
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
  })
    .index('by_integrationId', ['integrationId'])
    .index('by_ownership', ['ownership'])
    .index('by_lifecycle', ['lifecycle'])
    .index('by_environment', ['environment']),

  // Service identity records. Holds key references, never key material.
  serviceIdentities: defineTable({
    serviceId: v.string(),
    keyId: v.string(),
    state: credentialStateValidator,
    algorithm: v.string(),
    createdAt: v.number(),
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
  })
    .index('by_serviceId', ['serviceId'])
    .index('by_keyId', ['keyId'])
    .index('by_state', ['state'])
    .index('by_serviceId_state', ['serviceId', 'state']),

  // Credential versions for rotation and revocation. References only.
  credentialVersions: defineTable({
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
  })
    .index('by_keyId', ['keyId'])
    .index('by_serviceId', ['serviceId'])
    .index('by_state', ['state'])
    .index('by_keyId_version', ['keyId', 'version']),

  // Scoped capability grants.
  capabilityGrants: defineTable({
    serviceId: v.string(),
    capability: v.string(),
    scope: v.string(),
    grantedAt: v.number(),
    grantedBy: v.string(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_serviceId', ['serviceId'])
    .index('by_capability', ['capability'])
    .index('by_serviceId_capability', ['serviceId', 'capability']),

  // Connection policies: destination allow lists and classification ceilings.
  connectionPolicies: defineTable({
    policyId: v.string(),
    serviceId: v.string(),
    destination: v.string(),
    allowed: v.boolean(),
    classificationCeiling: classificationValidator,
    rateLimitPerMinute: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_policyId', ['policyId'])
    .index('by_serviceId', ['serviceId'])
    .index('by_destination', ['destination'])
    .index('by_serviceId_destination', ['serviceId', 'destination']),

  // Contract definitions.
  contractDefinitions: defineTable({
    contractId: v.string(),
    kind: contractKindValidator,
    name: v.string(),
    description: v.string(),
    owner: v.string(),
    dataClassification: classificationValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_contractId', ['contractId'])
    .index('by_kind', ['kind'])
    .index('by_owner', ['owner']),

  // Contract versions with lifecycle and deprecation state.
  contractVersions: defineTable({
    contractId: v.string(),
    version: v.string(),
    schemaVersion: v.string(),
    status: contractStatusValidator,
    checksum: v.string(),
    publishedAt: v.optional(v.number()),
    deprecatedAt: v.optional(v.number()),
    retiredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_contractId', ['contractId'])
    .index('by_contractId_version', ['contractId', 'version'])
    .index('by_status', ['status']),

  // Webhook endpoints. `secretRef` is a reference, never a secret value.
  webhookEndpoints: defineTable({
    endpointId: v.string(),
    serviceId: v.string(),
    url: v.string(),
    secretRef: v.string(),
    allowListed: v.boolean(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_endpointId', ['endpointId'])
    .index('by_serviceId', ['serviceId'])
    .index('by_active', ['active'])
    .index('by_serviceId_active', ['serviceId', 'active']),

  // Webhook deliveries with retry scheduling.
  webhookDeliveries: defineTable({
    deliveryId: v.string(),
    endpointId: v.string(),
    eventId: v.string(),
    status: deliveryStatusValidator,
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_deliveryId', ['deliveryId'])
    .index('by_endpointId', ['endpointId'])
    .index('by_status', ['status'])
    .index('by_nextAttemptAt', ['nextAttemptAt'])
    .index('by_status_nextAttemptAt', ['status', 'nextAttemptAt']),

  // Individual delivery attempts with failure classification.
  deliveryAttempts: defineTable({
    deliveryId: v.string(),
    attempt: v.number(),
    status: deliveryStatusValidator,
    failureClass: v.optional(failureClassValidator),
    responseStatus: v.optional(v.number()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index('by_deliveryId', ['deliveryId'])
    .index('by_deliveryId_attempt', ['deliveryId', 'attempt']),

  // Idempotency registry. Stores a request hash, never the request body.
  idempotencyRecords: defineTable({
    idempotencyKey: v.string(),
    serviceId: v.string(),
    requestHash: v.string(),
    status: idempotencyStatusValidator,
    responseRef: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_idempotencyKey', ['idempotencyKey'])
    .index('by_serviceId_key', ['serviceId', 'idempotencyKey'])
    .index('by_expiresAt', ['expiresAt']),

  // Nonce replay guard.
  nonceRecords: defineTable({
    nonce: v.string(),
    serviceId: v.string(),
    keyId: v.string(),
    seenAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_nonce', ['nonce'])
    .index('by_expiresAt', ['expiresAt'])
    .index('by_serviceId_nonce', ['serviceId', 'nonce']),

  // Event records for routing and audit.
  eventRecords: defineTable({
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
  })
    .index('by_eventId', ['eventId'])
    .index('by_eventType', ['eventType'])
    .index('by_correlationId', ['correlationId'])
    .index('by_source', ['source'])
    .index('by_status', ['status']),

  // Signed receipt records. Stores hashes and references, never payloads.
  receiptRecords: defineTable({
    receiptId: v.string(),
    eventId: v.string(),
    serviceId: v.string(),
    signatureAlgorithm: v.string(),
    keyId: v.string(),
    bodyHash: v.string(),
    issuedAt: v.number(),
    verifiedAt: v.optional(v.number()),
  })
    .index('by_receiptId', ['receiptId'])
    .index('by_eventId', ['eventId'])
    .index('by_serviceId', ['serviceId']),

  // Connector health snapshots.
  connectorHealth: defineTable({
    connectorId: v.string(),
    serviceId: v.string(),
    status: connectorStatusValidator,
    lastCheckedAt: v.number(),
    latencyMs: v.optional(v.number()),
    errorRate: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_connectorId', ['connectorId'])
    .index('by_serviceId', ['serviceId'])
    .index('by_status', ['status']),

  // Connector incidents.
  connectorIncidents: defineTable({
    incidentId: v.string(),
    connectorId: v.string(),
    severity: incidentSeverityValidator,
    status: incidentStatusValidator,
    summary: v.string(),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_incidentId', ['incidentId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_status', ['status'])
    .index('by_severity', ['severity']),

  // Kill switches, scoped to a connector, a service, or the control plane.
  killSwitches: defineTable({
    scope: killSwitchScopeValidator,
    targetId: v.string(),
    engaged: v.boolean(),
    reason: v.optional(v.string()),
    engagedBy: v.optional(v.string()),
    engagedAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_scope_target', ['scope', 'targetId'])
    .index('by_engaged', ['engaged'])
    .index('by_scope', ['scope']),

  // Audit events. Metadata is redaction-safe.
  auditEvents: defineTable({
    actor: v.string(),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    outcome: auditOutcomeValidator,
    correlationId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
    createdAt: v.number(),
  })
    .index('by_actor', ['actor'])
    .index('by_action', ['action'])
    .index('by_targetType_targetId', ['targetType', 'targetId'])
    .index('by_correlationId', ['correlationId'])
    .index('by_createdAt', ['createdAt']),

  // ==========================================================================
  // Cost and Usage Guard
  //
  // Monetary amounts are stored as INTEGER MINOR CURRENCY UNITS (e.g. cents).
  // Floating-point numbers are never used for money. Historical usage is never
  // overwritten with a new vendor price; the price version that applied when
  // the request occurred is preserved on each record.
  //
  // Vendor credentials are never stored in these tables.
  // ==========================================================================

  // External API vendors.
  apiVendors: defineTable({
    vendorId: v.string(),
    name: v.string(),
    slug: v.string(),
    lifecycle: lifecycleValidator,
    environment: environmentValidator,
    owner: v.string(),
    dataClassification: classificationValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_vendorId', ['vendorId'])
    .index('by_slug', ['slug'])
    .index('by_lifecycle', ['lifecycle'])
    .index('by_environment', ['environment']),

  // Vendor price versions. Immutable once effective; a new price is a new row.
  vendorPriceVersions: defineTable({
    pricingVersionId: v.string(),
    vendorId: v.string(),
    unitType: usageUnitValidator,
    unitPriceMinor: v.number(),
    currency: v.string(),
    pricingSource: v.string(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_pricingVersionId', ['pricingVersionId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_vendorId_effectiveFrom', ['vendorId', 'effectiveFrom'])
    .index('by_unitType', ['unitType']),

  // Connector subscriptions to a vendor.
  connectorSubscriptions: defineTable({
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
  })
    .index('by_subscriptionId', ['subscriptionId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_serviceId', ['serviceId'])
    .index('by_lifecycle', ['lifecycle']),

  // Raw API usage records (measured quantity, no money).
  apiUsageRecords: defineTable({
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
  })
    .index('by_usageId', ['usageId'])
    .index('by_requestId', ['requestId'])
    .index('by_vendorId_billingPeriod', ['vendorId', 'billingPeriod'])
    .index('by_connectorId_billingPeriod', ['connectorId', 'billingPeriod'])
    .index('by_systemId_billingPeriod', ['systemId', 'billingPeriod'])
    .index('by_tenantId_billingPeriod', ['tenantId', 'billingPeriod'])
    .index('by_customerRef_billingPeriod', ['customerRef', 'billingPeriod'])
    .index('by_correlationId', ['correlationId'])
    .index('by_causationId', ['causationId'])
    .index('by_idempotencyKey', ['idempotencyKey']),

  // Authoritative cost events. One authoritative charge per costEventId.
  apiCostEvents: defineTable({
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
  })
    .index('by_costEventId', ['costEventId'])
    .index('by_idempotencyKey', ['idempotencyKey'])
    .index('by_requestId', ['requestId'])
    .index('by_pricingVersionId', ['pricingVersionId'])
    .index('by_correlationId', ['correlationId'])
    .index('by_causationId', ['causationId'])
    .index('by_vendorId_billingPeriod', ['vendorId', 'billingPeriod'])
    .index('by_connectorId_billingPeriod', ['connectorId', 'billingPeriod'])
    .index('by_systemId_billingPeriod', ['systemId', 'billingPeriod'])
    .index('by_tenantId_billingPeriod', ['tenantId', 'billingPeriod'])
    .index('by_customerRef_billingPeriod', ['customerRef', 'billingPeriod']),

  // Rate-limit consumption windows.
  rateLimitWindows: defineTable({
    windowId: v.string(),
    vendorId: v.string(),
    connectorId: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
    limit: v.number(),
    consumed: v.number(),
    updatedAt: v.number(),
  })
    .index('by_windowId', ['windowId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_connectorId_windowStart', ['connectorId', 'windowStart']),

  // Quota allocations per tenant / customer / connector.
  quotaAllocations: defineTable({
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
  })
    .index('by_quotaId', ['quotaId'])
    .index('by_scope_scopeId', ['scope', 'scopeId'])
    .index('by_tenantId_billingPeriod', ['tenantId', 'billingPeriod'])
    .index('by_customerRef_billingPeriod', ['customerRef', 'billingPeriod'])
    .index('by_connectorId_billingPeriod', ['connectorId', 'billingPeriod'])
    .index('by_thresholdStatus', ['thresholdStatus']),

  // Usage budgets.
  usageBudgets: defineTable({
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
  })
    .index('by_budgetId', ['budgetId'])
    .index('by_scope_scopeId', ['scope', 'scopeId'])
    .index('by_thresholdStatus', ['thresholdStatus'])
    .index('by_billingPeriod', ['billingPeriod']),

  // Connector-level spending limits.
  spendingLimits: defineTable({
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
  })
    .index('by_limitId', ['limitId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_thresholdStatus', ['thresholdStatus'])
    .index('by_connectorId_billingPeriod', ['connectorId', 'billingPeriod']),

  // Cost anomalies.
  costAnomalies: defineTable({
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
  })
    .index('by_anomalyId', ['anomalyId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_status', ['status'])
    .index('by_billingPeriod', ['billingPeriod']),

  // Optimization decisions (dedup, cache, batch, throttle, block, ...).
  optimizationDecisions: defineTable({
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
  })
    .index('by_decisionId', ['decisionId'])
    .index('by_kind', ['kind'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_correlationId', ['correlationId']),

  // Cache usage / savings records.
  cacheUsageRecords: defineTable({
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
  })
    .index('by_cacheRecordId', ['cacheRecordId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_tenantId', ['tenantId'])
    .index('by_correlationId', ['correlationId']),

  // Batch usage / savings records.
  batchUsageRecords: defineTable({
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
  })
    .index('by_batchRecordId', ['batchRecordId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_correlationId', ['correlationId']),

  // Retry waste records.
  retryWasteRecords: defineTable({
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
  })
    .index('by_retryRecordId', ['retryRecordId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_requestId', ['requestId'])
    .index('by_correlationId', ['correlationId']),

  // Emergency vendor shutdown controls.
  vendorShutdownControls: defineTable({
    shutdownId: v.string(),
    vendorId: v.string(),
    connectorId: v.optional(v.string()),
    status: shutdownStatusValidator,
    reason: v.string(),
    activatedBy: v.string(),
    activatedAt: v.number(),
    releasedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_shutdownId', ['shutdownId'])
    .index('by_vendorId', ['vendorId'])
    .index('by_connectorId', ['connectorId'])
    .index('by_status', ['status']),

  // Cost export receipts (to REGIVANTA / AI HUB).
  costExportReceipts: defineTable({
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
  })
    .index('by_exportReceiptId', ['exportReceiptId'])
    .index('by_target', ['target'])
    .index('by_billingPeriod', ['billingPeriod'])
    .index('by_correlationId', ['correlationId']),
});
