// FSTS Governed Product Client — governed envelope assembly + payload guards.
//
// The client assembles and signs the governed envelope over the 14 SIGNED_FIELDS
// using the SAME primitives proven in @arma/compliance-core-client. It does not
// fork them. The material that makes the signature authoritative is resolved
// Hub-side from the credential reference; the product never holds it.
//
// Two payload guards are enforced before any byte leaves the process:
//   * raw sensitive evidence is rejected (metadata + secure reference only);
//   * no compliance/certification conclusion token or verdict field is allowed.

import {
  buildGovernedEnvelope,
  hashPayload,
  validateGovernedEnvelope,
} from '@arma/compliance-core-client';
import type { GovernedRequest } from '@arma/compliance-core-client';
import { FORBIDDEN_CONCLUSION_TOKENS, FORBIDDEN_VERDICT_FIELDS } from './constants.js';
import { GovernedClientConfigError } from './errors.js';

/** Reject any payload that carries a compliance/certification verdict field. */
export function assertNoVerdictFields(payload: unknown, path = 'payload'): void {
  if (payload === null || typeof payload !== 'object') return;
  if (Array.isArray(payload)) {
    payload.forEach((item, i) => assertNoVerdictFields(item, `${path}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if ((FORBIDDEN_VERDICT_FIELDS as readonly string[]).includes(key)) {
      throw new GovernedClientConfigError(
        'FALSE_COMPLIANCE_CLAIM',
        `${path}.${key} is a forbidden verdict field; a governed client cannot assert compliance`,
      );
    }
    assertNoVerdictFields(value, `${path}.${key}`);
  }
}

/** Reject any string value that asserts a compliance/certification conclusion. */
export function assertNoConclusionTokens(payload: unknown, path = 'payload'): void {
  if (typeof payload === 'string') {
    const upper = payload.toUpperCase();
    for (const token of FORBIDDEN_CONCLUSION_TOKENS) {
      // Match the token as a standalone word so "COMPLIANT_STATUS" also trips it.
      if (new RegExp(`\\b${token}\\b`).test(upper)) {
        throw new GovernedClientConfigError(
          'FALSE_COMPLIANCE_CLAIM',
          `${path} asserts the conclusion token ${token}; a governed client cannot manufacture compliance`,
        );
      }
    }
    return;
  }
  if (payload === null || typeof payload !== 'object') return;
  if (Array.isArray(payload)) {
    payload.forEach((item, i) => assertNoConclusionTokens(item, `${path}[${i}]`));
    return;
  }
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    assertNoConclusionTokens(value, `${path}.${key}`);
  }
}

/** Reject raw sensitive evidence where only metadata + a secure reference is allowed. */
export function assertNoRawSensitiveEvidence(payload: unknown, evidenceSensitive: boolean): void {
  if (!evidenceSensitive) return;
  if (payload === null || typeof payload !== 'object') return;
  const obj = payload as Record<string, unknown>;
  const rawKeys = [
    'raw',
    'rawContent',
    'rawEvidence',
    'content',
    'blob',
    'fileContents',
    'documentBody',
  ];
  for (const key of rawKeys) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) {
      throw new GovernedClientConfigError(
        'RAW_EVIDENCE_REJECTED',
        `evidence payload must carry a secure reference, not raw ${key}`,
      );
    }
  }
  if (
    obj['reference'] === undefined &&
    obj['evidenceRef'] === undefined &&
    obj['secureReference'] === undefined
  ) {
    throw new GovernedClientConfigError(
      'RAW_EVIDENCE_REJECTED',
      'evidence payload for a sensitive operation must carry a secure reference',
    );
  }
}

/** Apply every outbound payload guard. */
export function guardOutboundPayload(payload: unknown, evidenceSensitive: boolean): void {
  assertNoVerdictFields(payload);
  assertNoConclusionTokens(payload);
  assertNoRawSensitiveEvidence(payload, evidenceSensitive);
}

export interface SignedEnvelopeInput {
  readonly apiVersion: string;
  readonly tenantId: string;
  readonly serviceIdentityId: string;
  readonly productId: string;
  readonly environment: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly timestamp: number;
  readonly nonce: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  /** Resolved Hub-side from the credential reference. Never persisted by product. */
  readonly secret: string;
}

/** Build and locally self-validate a signed governed envelope. */
export function buildSignedEnvelope(input: SignedEnvelopeInput): GovernedRequest {
  const envelope = buildGovernedEnvelope({
    apiVersion: input.apiVersion,
    tenantId: input.tenantId,
    serviceIdentityId: input.serviceIdentityId,
    productId: input.productId,
    environment: input.environment,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    requestId: input.requestId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
    secret: input.secret,
  });
  const check = validateGovernedEnvelope(envelope);
  if (!check.ok) {
    throw new GovernedClientConfigError(
      'INTEGRITY_FAILED',
      'locally built envelope failed validation',
    );
  }
  return envelope;
}

/** Recompute the payload hash for integrity assertions in tests/conformance. */
export function payloadHashOf(payload: unknown): string {
  return hashPayload(payload);
}
