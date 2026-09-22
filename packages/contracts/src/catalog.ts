// ARMA API Hub — initial contract catalog.
//
// Each entry defines the payload schema for a named operation or event. The
// catalog is intentionally declarative: it maps a stable contract name to its
// schema version, kind, classification ceiling, and payload schema. Runtime
// validation and routing are driven from this catalog.
//
// Phase 0 note: these contracts are NOT connected to production systems. They
// exist so later development lanes can build against a frozen, versioned
// surface.

import { z } from 'zod';
import {
  dataClassificationSchema,
  lifecycleSchema,
  opaqueIdSchema,
  schemaVersionSchema,
  serviceIdSchema,
  sha256HexSchema,
  timestampSchema,
} from './primitives.js';
import { capabilitySchema, contractVersionSchema, ownerSchema } from './registry.js';

export const CONTRACT_KIND = z.enum(['COMMAND', 'EVENT', 'QUERY']);
export type ContractKind = z.infer<typeof CONTRACT_KIND>;

// --- apiHub.service.register -------------------------------------------------

export const serviceRegisterPayloadSchema = z.strictObject({
  serviceId: serviceIdSchema,
  displayName: z.string().min(1).max(128),
  productId: opaqueIdSchema,
  environment: z.enum(['DEVELOPMENT', 'PREVIEW', 'PRODUCTION']),
  owner: ownerSchema,
  classification: dataClassificationSchema,
  capabilities: z.array(capabilitySchema).min(1),
});

// --- apiHub.service.rotateCredential ----------------------------------------

export const serviceRotateCredentialPayloadSchema = z.strictObject({
  serviceId: serviceIdSchema,
  /** Key being retired. */
  currentKeyId: z.string().min(3).max(128),
  /** New key reference (material provisioned out-of-band). */
  newKeyId: z.string().min(3).max(128),
  /** Overlap window during which both keys verify (epoch ms). */
  overlapUntil: timestampSchema,
  reason: z.string().min(3).max(256),
});

// --- apiHub.contract.publish -------------------------------------------------

export const contractPublishPayloadSchema = z.strictObject({
  contract: contractVersionSchema,
  kind: CONTRACT_KIND,
  /** SHA-256 of the canonical schema document. */
  schemaHash: sha256HexSchema,
  /** Compatibility rule for consumers. */
  compatibility: z.enum(['BACKWARD', 'FORWARD', 'FULL', 'NONE']),
});

// --- apiHub.event.publish ----------------------------------------------------

export const eventPublishPayloadSchema = z.strictObject({
  eventType: z.string().min(3).max(200),
  stream: z.string().min(3).max(200),
  sequence: z.number().int().nonnegative(),
  payloadHash: sha256HexSchema,
  classification: dataClassificationSchema,
});

// --- apiHub.webhook.deliver --------------------------------------------------

export const webhookDeliverPayloadSchema = z.strictObject({
  deliveryId: z.string().min(8).max(128),
  eventId: z.string().min(8).max(128),
  destination: serviceIdSchema,
  destinationRef: opaqueIdSchema,
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  bodyHash: sha256HexSchema,
});

// --- apiHub.receipt.verify ---------------------------------------------------

export const receiptVerifyPayloadSchema = z.strictObject({
  receiptId: z.string().min(8).max(128),
  subjectId: z.string().min(8).max(128),
  subjectType: z.enum(['SERVICE_REQUEST', 'EVENT', 'WEBHOOK_DELIVERY']),
  receiptHash: sha256HexSchema,
  issuer: serviceIdSchema,
});

// --- apiHub.connector.health -------------------------------------------------

export const connectorHealthPayloadSchema = z.strictObject({
  connectorId: serviceIdSchema,
  status: z.enum(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']),
  checkedAt: timestampSchema,
  killSwitchEngaged: z.boolean(),
  dependencyCount: z.number().int().nonnegative(),
});

// --- apiHub.connector.incident ----------------------------------------------

export const connectorIncidentPayloadSchema = z.strictObject({
  connectorId: serviceIdSchema,
  incidentId: z.string().min(8).max(128),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
  detectedAt: timestampSchema,
  /** Whether delivery was halted as a result. */
  deliveryHalted: z.boolean(),
});

// --- apiHub.killSwitch.update ------------------------------------------------

export const killSwitchUpdatePayloadSchema = z.strictObject({
  targetServiceId: serviceIdSchema,
  engaged: z.boolean(),
  reason: z.string().min(3).max(256),
  /** Who authorized the change (human actor reference). */
  authorizedBy: opaqueIdSchema,
  effectiveAt: timestampSchema,
});

// --- compliance.evaluate -----------------------------------------------------

export const complianceEvaluatePayloadSchema = z.strictObject({
  evaluationId: z.string().min(8).max(128),
  subjectRef: opaqueIdSchema,
  /** The compliance rule set version evaluated. */
  ruleSetVersion: schemaVersionSchema,
  /** Outcome is advisory only — API Hub never approves legal actions. */
  outcome: z.enum(['PASS', 'FAIL', 'REVIEW_REQUIRED', 'INSUFFICIENT_DATA']),
  evaluatedAt: timestampSchema,
});

// --- compliance.decisionReceipt ---------------------------------------------

export const complianceDecisionReceiptPayloadSchema = z.strictObject({
  decisionId: z.string().min(8).max(128),
  evaluationId: z.string().min(8).max(128),
  /** Human decision-maker reference; AI may not be the approver. */
  decidedBy: opaqueIdSchema,
  decision: z.enum(['APPROVED', 'REJECTED', 'DEFERRED']),
  decidedAt: timestampSchema,
  /** SHA-256 of the decision rationale document. */
  rationaleHash: sha256HexSchema,
});

// --- cannabis.regulatedActionRequested --------------------------------------

export const cannabisRegulatedActionRequestedPayloadSchema = z.strictObject({
  requestId: z.string().min(8).max(128),
  actionType: z.enum(['TRANSPORT', 'CUSTODY_TRANSFER', 'DISPOSAL', 'INTAKE', 'MANIFEST_UPDATE']),
  /** Regulator jurisdiction reference (never a credential). */
  jurisdictionRef: opaqueIdSchema,
  requestedAt: timestampSchema,
  /** API Hub routes this; it does not approve compliance decisions. */
  requiresHumanApproval: z.literal(true),
});

// --- cannabis.custodyStatusChanged ------------------------------------------

export const cannabisCustodyStatusChangedPayloadSchema = z.strictObject({
  custodyId: z.string().min(8).max(128),
  previousStatus: z.enum(['IN_TRANSIT', 'IN_CUSTODY', 'RELEASED', 'QUARANTINED']),
  newStatus: z.enum(['IN_TRANSIT', 'IN_CUSTODY', 'RELEASED', 'QUARANTINED']),
  changedAt: timestampSchema,
  /** Actor reference (human or system). */
  actorRef: opaqueIdSchema,
});

// --- operon.posPanicTriggered -----------------------------------------------

export const operonPosPanicTriggeredPayloadSchema = z.strictObject({
  panicId: z.string().min(8).max(128),
  terminalRef: opaqueIdSchema,
  triggeredAt: timestampSchema,
  /** API Hub routes the alert; it does not dispatch emergency services. */
  requiresHumanDispatch: z.literal(true),
});

// --- operon.regulatedTransactionStatusChanged -------------------------------

export const operonRegulatedTransactionStatusChangedPayloadSchema = z.strictObject({
  transactionId: z.string().min(8).max(128),
  previousStatus: z.enum(['PENDING', 'HELD', 'APPROVED', 'REJECTED', 'COMPLETED']),
  newStatus: z.enum(['PENDING', 'HELD', 'APPROVED', 'REJECTED', 'COMPLETED']),
  changedAt: timestampSchema,
  /** API Hub routes this; it does not approve payments or compliance. */
  requiresHumanApproval: z.literal(true),
});

/** A catalog entry: stable name -> schema + governance metadata. */
export interface ContractCatalogEntry {
  readonly name: string;
  readonly kind: ContractKind;
  readonly version: string;
  readonly lifecycle: z.infer<typeof lifecycleSchema>;
  readonly maxClassification: z.infer<typeof dataClassificationSchema>;
  readonly payload: z.ZodTypeAny;
}

export const CONTRACT_CATALOG: readonly ContractCatalogEntry[] = [
  {
    name: 'apiHub.service.register',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'CONFIDENTIAL',
    payload: serviceRegisterPayloadSchema,
  },
  {
    name: 'apiHub.service.rotateCredential',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'CONFIDENTIAL',
    payload: serviceRotateCredentialPayloadSchema,
  },
  {
    name: 'apiHub.contract.publish',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'INTERNAL',
    payload: contractPublishPayloadSchema,
  },
  {
    name: 'apiHub.event.publish',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'CONFIDENTIAL',
    payload: eventPublishPayloadSchema,
  },
  {
    name: 'apiHub.webhook.deliver',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'CONFIDENTIAL',
    payload: webhookDeliverPayloadSchema,
  },
  {
    name: 'apiHub.receipt.verify',
    kind: 'QUERY',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'INTERNAL',
    payload: receiptVerifyPayloadSchema,
  },
  {
    name: 'apiHub.connector.health',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'INTERNAL',
    payload: connectorHealthPayloadSchema,
  },
  {
    name: 'apiHub.connector.incident',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'CONFIDENTIAL',
    payload: connectorIncidentPayloadSchema,
  },
  {
    name: 'apiHub.killSwitch.update',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'CONFIDENTIAL',
    payload: killSwitchUpdatePayloadSchema,
  },
  {
    name: 'compliance.evaluate',
    kind: 'COMMAND',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'REGULATED',
    payload: complianceEvaluatePayloadSchema,
  },
  {
    name: 'compliance.decisionReceipt',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'REGULATED',
    payload: complianceDecisionReceiptPayloadSchema,
  },
  {
    name: 'cannabis.regulatedActionRequested',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'REGULATED',
    payload: cannabisRegulatedActionRequestedPayloadSchema,
  },
  {
    name: 'cannabis.custodyStatusChanged',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'REGULATED',
    payload: cannabisCustodyStatusChangedPayloadSchema,
  },
  {
    name: 'operon.posPanicTriggered',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'PROTECTED',
    payload: operonPosPanicTriggeredPayloadSchema,
  },
  {
    name: 'operon.regulatedTransactionStatusChanged',
    kind: 'EVENT',
    version: '1.0.0',
    lifecycle: 'DRAFT',
    maxClassification: 'REGULATED',
    payload: operonRegulatedTransactionStatusChangedPayloadSchema,
  },
];

/** Look up a catalog entry by name. */
export function getCatalogEntry(name: string): ContractCatalogEntry | undefined {
  return CONTRACT_CATALOG.find((entry) => entry.name === name);
}

export type ServiceRegisterPayload = z.infer<typeof serviceRegisterPayloadSchema>;
export type ServiceRotateCredentialPayload = z.infer<typeof serviceRotateCredentialPayloadSchema>;
export type ContractPublishPayload = z.infer<typeof contractPublishPayloadSchema>;
export type EventPublishPayload = z.infer<typeof eventPublishPayloadSchema>;
export type WebhookDeliverPayload = z.infer<typeof webhookDeliverPayloadSchema>;
export type ReceiptVerifyPayload = z.infer<typeof receiptVerifyPayloadSchema>;
export type ConnectorHealthPayload = z.infer<typeof connectorHealthPayloadSchema>;
export type ConnectorIncidentPayload = z.infer<typeof connectorIncidentPayloadSchema>;
export type KillSwitchUpdatePayload = z.infer<typeof killSwitchUpdatePayloadSchema>;
export type ComplianceEvaluatePayload = z.infer<typeof complianceEvaluatePayloadSchema>;
export type ComplianceDecisionReceiptPayload = z.infer<
  typeof complianceDecisionReceiptPayloadSchema
>;
export type CannabisRegulatedActionRequestedPayload = z.infer<
  typeof cannabisRegulatedActionRequestedPayloadSchema
>;
export type CannabisCustodyStatusChangedPayload = z.infer<
  typeof cannabisCustodyStatusChangedPayloadSchema
>;
export type OperonPosPanicTriggeredPayload = z.infer<typeof operonPosPanicTriggeredPayloadSchema>;
export type OperonRegulatedTransactionStatusChangedPayload = z.infer<
  typeof operonRegulatedTransactionStatusChangedPayloadSchema
>;
