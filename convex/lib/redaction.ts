// Redaction-safe metadata handling for the ARMA API Hub control plane.
//
// Audit and observability metadata must never carry raw secrets, signatures,
// credentials, tokens, or protected payloads. Only allow-listed keys survive,
// and any value that looks like a secret is dropped.

/** Keys that are always permitted in audit/observability metadata. */
export const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'requestId',
  'correlationId',
  'causationId',
  'serviceId',
  'systemId',
  'keyId',
  'contractId',
  'contractVersion',
  'schemaVersion',
  'eventType',
  'eventId',
  'deliveryId',
  'endpointId',
  'connectorId',
  'incidentId',
  'policyId',
  'capability',
  'scope',
  'environment',
  'lifecycle',
  'classification',
  'outcome',
  'reason',
  'attempt',
  'status',
  'failureClass',
  'latencyMs',
  'responseStatus',
  // Cost & Usage Guard identifiers and amounts (non-secret).
  'vendorId',
  'costEventId',
  'pricingVersionId',
  'idempotencyKey',
  'sourceHub',
  'tenantId',
  'customerRef',
  'billingPeriod',
  'budgetId',
  'limitId',
  'quotaId',
  'shutdownId',
  'decisionId',
  'anomalyId',
  'exportReceiptId',
  'amountMinor',
  'savingsMinor',
  'wastedMinor',
  'consumedMinor',
  'limitMinor',
  'currency',
  'thresholdStatus',
  'action',
  'unitType',
  'quantity',
]);

/** Keys that must never appear in metadata, even if allow-listed elsewhere. */
export const FORBIDDEN_METADATA_KEYS: ReadonlySet<string> = new Set([
  'secret',
  'secrets',
  'token',
  'tokens',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'privateKey',
  'private_key',
  'signature',
  'signingSecret',
  'signing_secret',
  'webhookSecret',
  'webhook_secret',
  'credential',
  'credentials',
  'authorization',
  'cookie',
  'payload',
  'body',
  'evidence',
  'cardNumber',
  'card_number',
  'cvv',
  'ssn',
]);

const SECRET_VALUE_PATTERN =
  /(?:secret|token|password|passwd|api[_-]?key|bearer|signature|private[_-]?key)/i;

/**
 * Reduce an arbitrary metadata object to a redaction-safe string map.
 * Non-allow-listed keys and secret-looking values are dropped.
 */
export function redactMetadata(input: Record<string, unknown>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_METADATA_KEYS.has(key) || FORBIDDEN_METADATA_KEYS.has(normalized)) continue;
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    const asString = String(value);
    if (SECRET_VALUE_PATTERN.test(asString)) continue;
    safe[key] = asString;
  }
  return safe;
}
