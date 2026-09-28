// ARMA API Hub — service-facing SDK.
//
// Builds signed service request envelopes. The SDK signs the EXACT bytes that
// will be sent (never a re-serialized object) and never stores or logs the
// signing secret. Browser and mobile clients must NOT use this SDK with
// privileged credentials.

import { randomUUID } from 'node:crypto';
import { bodyHashFor, generateNonce, signCanonicalRequest } from '@arma/crypto';
import type {
  DataClassification,
  ServiceRequestEnvelope,
  SignatureAlgorithm,
  TenantScope,
} from '@arma/contracts';

export interface SignRequestInput {
  readonly serviceId: string;
  readonly keyId: string;
  readonly secret: string;
  readonly method: string;
  readonly path: string;
  readonly operation: string;
  readonly destination: string;
  readonly classification: DataClassification;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly idempotencyKey?: string;
  readonly tenant?: TenantScope;
  readonly body: string;
  readonly algorithm?: SignatureAlgorithm;
  readonly now?: number;
  readonly schemaVersion?: string;
}

export interface SignedServiceRequest {
  readonly envelope: ServiceRequestEnvelope;
  readonly body: string;
}

/**
 * Build a signed service request envelope. The body hash and signature are
 * computed over the exact `body` string supplied by the caller.
 */
export function buildSignedServiceRequest(input: SignRequestInput): SignedServiceRequest {
  const now = input.now ?? Date.now();
  const timestamp = String(now);
  const nonce = generateNonce();
  const bodyHash = bodyHashFor(input.body);
  const algorithm = input.algorithm ?? 'HMAC-SHA256';

  const signed = signCanonicalRequest(
    input.secret,
    { method: input.method, path: input.path, timestamp, nonce, bodyHash },
    algorithm,
  );

  const envelope: ServiceRequestEnvelope = {
    schemaVersion: input.schemaVersion ?? '1.0.0',
    requestId: `req-${randomUUID()}`,
    serviceId: input.serviceId,
    keyId: input.keyId,
    timestamp,
    nonce,
    bodyHash,
    signature: { algorithm, keyId: input.keyId, value: signed.signature },
    correlation: input.causationId
      ? { correlationId: input.correlationId, causationId: input.causationId }
      : { correlationId: input.correlationId },
    routing: { source: input.serviceId, destination: input.destination },
    classification: input.classification,
    operation: input.operation,
    ...(input.idempotencyKey
      ? { idempotency: { key: input.idempotencyKey, requestHash: bodyHash } }
      : {}),
    ...(input.tenant ? { tenant: input.tenant } : {}),
  };

  return { envelope, body: input.body };
}
