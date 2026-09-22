// Shared Convex validators for the ARMA API Hub control plane.
//
// These mirror the canonical enums defined in `@arma/contracts` so that the
// Convex data model and the shared TypeScript contracts stay aligned. They are
// intentionally strict: unknown values are rejected at the database boundary.

import { v } from 'convex/values';

/** Product / service lifecycle. */
export const lifecycleValidator = v.union(
  v.literal('DRAFT'),
  v.literal('DEVELOPMENT'),
  v.literal('TEST'),
  v.literal('PILOT'),
  v.literal('ACTIVE'),
  v.literal('PAUSED'),
  v.literal('DEPRECATED'),
  v.literal('RETIRED'),
);

/** Ownership classification. PlayRaise is CLIENT_OWNED, never FSTS_OWNED. */
export const ownershipValidator = v.union(
  v.literal('FSTS_OWNED'),
  v.literal('CLIENT_OWNED'),
  v.literal('PARTNER_OWNED'),
);

/** Data classification, ordered PUBLIC < INTERNAL < CONFIDENTIAL < PROTECTED < REGULATED. */
export const classificationValidator = v.union(
  v.literal('PUBLIC'),
  v.literal('INTERNAL'),
  v.literal('CONFIDENTIAL'),
  v.literal('PROTECTED'),
  v.literal('REGULATED'),
);

/** Deployment environment. */
export const environmentValidator = v.union(
  v.literal('DEVELOPMENT'),
  v.literal('PREVIEW'),
  v.literal('PRODUCTION'),
);

/** Credential lifecycle state. Key material is never stored here. */
export const credentialStateValidator = v.union(
  v.literal('PENDING'),
  v.literal('ACTIVE'),
  v.literal('ROTATING'),
  v.literal('REVOKED'),
  v.literal('RETIRED'),
);

/** Webhook delivery status. */
export const deliveryStatusValidator = v.union(
  v.literal('PENDING'),
  v.literal('IN_PROGRESS'),
  v.literal('DELIVERED'),
  v.literal('FAILED'),
  v.literal('DEAD_LETTERED'),
  v.literal('HELD'),
);

/** Failure classification for retry decisions. */
export const failureClassValidator = v.union(
  v.literal('CLEAN_RETRYABLE'),
  v.literal('AMBIGUOUS'),
  v.literal('TERMINAL'),
);

/**
 * Failure classification used by cost/retry-waste accounting. Kept distinct
 * from the webhook delivery `failureClassValidator` so the normalized cost
 * contract (`apiHub.retryWasteRecorded`) and the stored record agree exactly.
 */
export const costFailureClassValidator = v.union(
  v.literal('TRANSIENT'),
  v.literal('PERMANENT'),
  v.literal('TIMEOUT'),
  v.literal('RATE_LIMITED'),
  v.literal('UNKNOWN'),
);

/** Connector health status. */
export const connectorStatusValidator = v.union(
  v.literal('HEALTHY'),
  v.literal('DEGRADED'),
  v.literal('UNHEALTHY'),
  v.literal('UNKNOWN'),
);

/** Incident severity. */
export const incidentSeverityValidator = v.union(
  v.literal('INFO'),
  v.literal('WARNING'),
  v.literal('CRITICAL'),
);

/** Incident status. */
export const incidentStatusValidator = v.union(
  v.literal('OPEN'),
  v.literal('ACKNOWLEDGED'),
  v.literal('RESOLVED'),
);

/** Kill-switch scope. */
export const killSwitchScopeValidator = v.union(
  v.literal('CONNECTOR'),
  v.literal('SERVICE'),
  v.literal('CONTROL_PLANE'),
);

/** Contract kind. */
export const contractKindValidator = v.union(
  v.literal('API'),
  v.literal('EVENT'),
  v.literal('WEBHOOK'),
  v.literal('RECEIPT'),
);

/** Contract version status. */
export const contractStatusValidator = v.union(
  v.literal('DRAFT'),
  v.literal('PUBLISHED'),
  v.literal('DEPRECATED'),
  v.literal('RETIRED'),
);

/** Idempotency outcome. */
export const idempotencyStatusValidator = v.union(
  v.literal('FRESH'),
  v.literal('DUPLICATE'),
  v.literal('CONFLICT'),
);

/** Audit outcome. */
export const auditOutcomeValidator = v.union(
  v.literal('SUCCESS'),
  v.literal('DENIED'),
  v.literal('FAILURE'),
);

// --- Cost and Usage Guard ---

/** Authoritative source hub for a cost event. */
export const sourceHubValidator = v.union(
  v.literal('ARMA_API_HUB'),
  v.literal('FSTS_AI_HUB'),
  v.literal('REGIVANTA'),
);

/** Unit type for a measured usage quantity. */
export const usageUnitValidator = v.union(
  v.literal('REQUEST'),
  v.literal('TOKEN'),
  v.literal('BYTE'),
  v.literal('SECOND'),
  v.literal('CALL'),
  v.literal('DELIVERY'),
  v.literal('RETRY'),
  v.literal('STORAGE_BYTE_MONTH'),
);

/** Whether a cost amount is an estimate or finalized. */
export const costStatusValidator = v.union(v.literal('ESTIMATED'), v.literal('FINALIZED'));

/** Budget / quota threshold status. */
export const thresholdStatusValidator = v.union(
  v.literal('OK'),
  v.literal('WARNING'),
  v.literal('THROTTLED'),
  v.literal('BLOCKED'),
);

/** Cost anomaly status. */
export const anomalyStatusValidator = v.union(
  v.literal('OPEN'),
  v.literal('ACKNOWLEDGED'),
  v.literal('RESOLVED'),
  v.literal('FALSE_POSITIVE'),
);

/** Vendor shutdown control status. */
export const shutdownStatusValidator = v.union(v.literal('ACTIVE'), v.literal('RELEASED'));

/** Optimization decision kind. */
export const optimizationKindValidator = v.union(
  v.literal('DEDUPLICATION'),
  v.literal('IDEMPOTENCY'),
  v.literal('CACHE'),
  v.literal('BATCHING'),
  v.literal('RETRY_CEILING'),
  v.literal('BACKOFF'),
  v.literal('CIRCUIT_BREAKER'),
  v.literal('WEBHOOK_CONSOLIDATION'),
  v.literal('REQUEST_COALESCING'),
  v.literal('QUOTA_AWARE_ROUTING'),
  v.literal('PAYLOAD_SIZE_CONTROL'),
  v.literal('UNUSED_CONNECTOR_DETECTION'),
  v.literal('THROTTLING'),
  v.literal('HARD_BLOCK'),
);

/** Cost export target. */
export const costExportTargetValidator = v.union(v.literal('REGIVANTA'), v.literal('AI_HUB'));
