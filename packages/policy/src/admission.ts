// ARMA API Hub — service request admission pipeline.
//
// This is the single control-plane primitive that decides whether a signed
// service request may proceed. It composes, in a fixed fail-closed order:
//
//   1. envelope schema validation        (ENVELOPE_INVALID)
//   2. supported schema version          (SCHEMA_VERSION_UNSUPPORTED)
//   3. audience / destination match      (AUDIENCE_MISMATCH)
//   4. credential state                  (CREDENTIAL_*)
//   5. byte-exact body hash              (BODY_HASH_MISMATCH)
//   6. canonical signature verification  (SIGNATURE_INVALID)
//   7. nonce replay guard                (NONCE_REPLAYED)
//   8. idempotency resolution            (IDEMPOTENCY_CONFLICT / duplicate)
//   9. policy evaluation                 (POLICY_DENIED)
//
// The pipeline NEVER logs or returns secret material. It consumes a nonce only
// after the signature is proven valid, so an attacker cannot burn a legitimate
// caller's nonce with a forged request.

import type { DataClassification, ServiceRequestEnvelope } from '@arma/contracts';
import { serviceRequestEnvelopeSchema, validate } from '@arma/contracts';
import {
  bodyHashFor,
  NONCE_VALIDITY_WINDOW_MS,
  verifyCanonicalRequestSignature,
} from '@arma/crypto';
import type { CredentialStore } from '@arma/auth';
import { checkCredential } from '@arma/auth';
import type { IdempotencyRepository, NonceRepository } from '@arma/database';
import { evaluatePolicy, type PolicyRegistry } from './index.js';

/** Schema versions this control plane currently accepts. */
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = ['1.0.0'];

/** True when the given schema version is accepted by this control plane. */
export function isSupportedSchemaVersion(version: string): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(version);
}

/**
 * True when the envelope is addressed to the expected audience. The audience
 * is the destination service the request is routed to; a request addressed
 * elsewhere must never be admitted by this service.
 */
export function checkAudience(envelope: ServiceRequestEnvelope, expectedAudience: string): boolean {
  return envelope.routing.destination === expectedAudience;
}

export type AdmissionFailureCode =
  | 'ENVELOPE_INVALID'
  | 'SCHEMA_VERSION_UNSUPPORTED'
  | 'AUDIENCE_MISMATCH'
  | 'CREDENTIAL_UNKNOWN'
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_EXPIRED'
  | 'BODY_HASH_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'NONCE_REPLAYED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'POLICY_DENIED';

export type AdmissionDecision =
  | { ok: true; requestId: string; serviceId: string; duplicate: boolean }
  | { ok: false; code: AdmissionFailureCode; detail?: Record<string, unknown> };

export interface AdmissionInput {
  /** The raw, untrusted envelope (validated inside the pipeline). */
  readonly envelope: unknown;
  /** The exact raw request body bytes as a string. */
  readonly rawBody: string;
  readonly method: string;
  readonly path: string;
  /** The service this control plane is acting as (the expected audience). */
  readonly expectedAudience: string;
  /** The capability the caller must hold for this operation. */
  readonly capability: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly now: number;
  readonly credentials: CredentialStore;
  /** Resolves the signing secret for a key id. Never logged or persisted. */
  readonly resolveSecret: (keyId: string) => string | null;
  readonly nonces: NonceRepository;
  readonly idempotency: IdempotencyRepository;
  readonly policy: PolicyRegistry;
}

/** Run the full admission pipeline. Never throws for ordinary denials. */
export async function admitServiceRequest(input: AdmissionInput): Promise<AdmissionDecision> {
  // 1. Envelope schema (strict: unknown fields rejected).
  const parsed = validate(serviceRequestEnvelopeSchema, input.envelope);
  if (!parsed.ok) {
    return { ok: false, code: 'ENVELOPE_INVALID', detail: { issues: parsed.issues.length } };
  }
  const envelope = parsed.value;

  // 2. Supported schema version.
  if (!isSupportedSchemaVersion(envelope.schemaVersion)) {
    return {
      ok: false,
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      detail: { schemaVersion: envelope.schemaVersion },
    };
  }

  // 3. Audience / destination match.
  if (!checkAudience(envelope, input.expectedAudience)) {
    return {
      ok: false,
      code: 'AUDIENCE_MISMATCH',
      detail: { destination: envelope.routing.destination },
    };
  }

  // 4. Credential state (reference only; never key material).
  const credential = checkCredential(input.credentials, envelope.keyId, input.now);
  if (!credential.ok) {
    return { ok: false, code: credential.code };
  }

  // 5. Byte-exact body hash.
  const recomputedBodyHash = bodyHashFor(input.rawBody);
  if (recomputedBodyHash !== envelope.bodyHash) {
    return { ok: false, code: 'BODY_HASH_MISMATCH' };
  }

  // 6. Canonical signature verification (timing-safe, clock-skew bounded).
  const secret = input.resolveSecret(envelope.keyId);
  if (!secret) {
    return { ok: false, code: 'CREDENTIAL_UNKNOWN' };
  }
  const verification = verifyCanonicalRequestSignature({
    secret,
    method: input.method,
    path: input.path,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    bodyHash: envelope.bodyHash,
    providedSignature: envelope.signature.value,
    algorithm: envelope.signature.algorithm,
    now: input.now,
  });
  if (!verification.ok) {
    return { ok: false, code: 'SIGNATURE_INVALID', detail: { reason: verification.code } };
  }

  // 7. Nonce replay guard (consumed only after a valid signature).
  const scope = envelope.serviceId;
  const nonceOk = await input.nonces.consume(scope, envelope.nonce, NONCE_VALIDITY_WINDOW_MS);
  if (!nonceOk) {
    return { ok: false, code: 'NONCE_REPLAYED' };
  }

  // 8. Idempotency resolution for mutating operations.
  let duplicate = false;
  if (envelope.idempotency) {
    const resolution = await input.idempotency.resolve(
      scope,
      envelope.idempotency.key,
      envelope.idempotency.requestHash,
    );
    if (resolution === 'CONFLICT') {
      return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
    }
    if (resolution === 'DUPLICATE') {
      duplicate = true;
    }
  }

  // 9. Policy evaluation (registration, approval, lifecycle, capability,
  //    classification, tenant isolation, destination allow-list, kill switch).
  const decision = evaluatePolicy(input.policy, {
    serviceId: envelope.serviceId,
    capability: input.capability,
    direction: input.direction,
    classification: envelope.classification as DataClassification,
    ...(envelope.tenant ? { tenant: envelope.tenant } : {}),
    destinationServiceId: envelope.routing.destination,
  });
  if (!decision.ok) {
    return { ok: false, code: 'POLICY_DENIED', detail: { reason: decision.code } };
  }

  // Record the idempotency outcome only after the request is admitted.
  if (envelope.idempotency && !duplicate) {
    await input.idempotency.record(
      scope,
      envelope.idempotency.key,
      envelope.idempotency.requestHash,
      envelope.requestId,
    );
  }

  return { ok: true, requestId: envelope.requestId, serviceId: envelope.serviceId, duplicate };
}
