// ARMA API Hub — shared contract primitives.
//
// Every contract in this package is built from these primitives so that
// identifier shapes, version formats, and hash encodings are defined exactly
// once. All primitives are runtime-validated with zod and are intentionally
// strict: unknown fields are rejected at the object level (see envelopes.ts).
//
// SECURITY: these primitives describe *shape only*. They never carry secret
// material. Signature and key identifiers are opaque references, never keys.

import { z } from 'zod';

/** Lowercase, hyphenated service identifier, e.g. `arma-sentinel`. */
export const serviceIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,63}$/, 'serviceId must be lowercase alphanumeric/hyphen');

/** Opaque key identifier (references key material; never the key itself). */
export const keyIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/, 'keyId must be an opaque identifier');

/** Opaque service/tenant/organization identifier. */
export const opaqueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/, 'identifier must be opaque');

/** Anti-replay nonce: URL-safe, 20–128 chars. */
export const nonceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{20,128}$/, 'nonce must be 20-128 URL-safe characters');

/** Epoch milliseconds, encoded as a decimal string (wire-safe, no float drift). */
export const timestampSchema = z
  .string()
  .regex(/^\d{1,16}$/, 'timestamp must be epoch milliseconds as a decimal string');

/** Lowercase hex SHA-256 digest. */
export const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'hash must be a lowercase hex sha256 digest');

/** Correlation / causation identifier. */
export const correlationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,128}$/, 'correlationId must be 8-128 opaque characters');

/** Idempotency key. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, 'idempotencyKey must be 8-128 URL-safe characters');

/** Semantic schema version, `MAJOR.MINOR.PATCH`. */
export const schemaVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'schemaVersion must be MAJOR.MINOR.PATCH');

/** Signature algorithm identifier. Algorithms are versioned and replaceable. */
export const signatureAlgorithmSchema = z.enum(['HMAC-SHA256', 'ED25519', 'ECDSA-P256-SHA256']);

/** Signature metadata: algorithm + key reference + opaque signature value. */
export const signatureMetadataSchema = z.strictObject({
  algorithm: signatureAlgorithmSchema,
  keyId: keyIdSchema,
  /** Opaque signature encoding (hex/base64url). Never a secret. */
  value: z.string().regex(/^[A-Za-z0-9_+/=-]{16,512}$/, 'signature value must be opaque encoded'),
  /** Optional key version for rotation. */
  keyVersion: z.number().int().nonnegative().optional(),
});

/** Tenant / organization scope. */
export const tenantScopeSchema = z.strictObject({
  tenantId: opaqueIdSchema,
  organizationId: opaqueIdSchema.optional(),
});

/** Data classification labels (see docs/security/DATA-CLASSIFICATION.md). */
export const dataClassificationSchema = z.enum([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PROTECTED',
  'REGULATED',
]);

/** Product ownership classification. */
export const ownershipSchema = z.enum(['FSTS_OWNED', 'CLIENT_OWNED', 'PARTNER_OWNED']);

/** Service lifecycle values (locked vocabulary). */
export const lifecycleSchema = z.enum([
  'DRAFT',
  'DEVELOPMENT',
  'TEST',
  'PILOT',
  'ACTIVE',
  'PAUSED',
  'DEPRECATED',
  'RETIRED',
]);

/** Environment identifier. */
export const environmentSchema = z.enum(['DEVELOPMENT', 'PREVIEW', 'PRODUCTION']);

export type ServiceId = z.infer<typeof serviceIdSchema>;
export type KeyId = z.infer<typeof keyIdSchema>;
export type Nonce = z.infer<typeof nonceSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type Sha256Hex = z.infer<typeof sha256HexSchema>;
export type CorrelationId = z.infer<typeof correlationIdSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
export type SchemaVersion = z.infer<typeof schemaVersionSchema>;
export type SignatureAlgorithm = z.infer<typeof signatureAlgorithmSchema>;
export type SignatureMetadata = z.infer<typeof signatureMetadataSchema>;
export type TenantScope = z.infer<typeof tenantScopeSchema>;
export type DataClassification = z.infer<typeof dataClassificationSchema>;
export type Ownership = z.infer<typeof ownershipSchema>;
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type Environment = z.infer<typeof environmentSchema>;
