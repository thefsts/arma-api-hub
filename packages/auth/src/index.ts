// ARMA API Hub — service identity and credential lifecycle.
//
// Models service identities and their credential (key) lifecycle. Key material
// is NEVER stored here: this module tracks key *references* and their state so
// rotation and revocation are auditable. Actual key material is provisioned
// through the secrets manager.

import type { KeyId, ServiceId } from '@arma/contracts';

export type CredentialState = 'ACTIVE' | 'ROTATING' | 'REVOKED' | 'EXPIRED';

export interface CredentialRecord {
  readonly keyId: KeyId;
  readonly serviceId: ServiceId;
  readonly state: CredentialState;
  readonly algorithm: 'HMAC-SHA256' | 'ED25519' | 'ECDSA-P256-SHA256';
  readonly createdAt: number;
  readonly expiresAt?: number;
  /** During rotation, the overlap window in which both keys verify. */
  readonly overlapUntil?: number;
  readonly revokedAt?: number;
  readonly revokedReason?: string;
}

export interface CredentialStore {
  get(keyId: string): CredentialRecord | null;
  put(record: CredentialRecord): void;
  listForService(serviceId: string): CredentialRecord[];
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly records = new Map<string, CredentialRecord>();

  get(keyId: string): CredentialRecord | null {
    return this.records.get(keyId) ?? null;
  }

  put(record: CredentialRecord): void {
    this.records.set(record.keyId, record);
  }

  listForService(serviceId: string): CredentialRecord[] {
    return [...this.records.values()].filter((r) => r.serviceId === serviceId);
  }
}

export type CredentialCheck =
  | { ok: true; record: CredentialRecord }
  | { ok: false; code: 'CREDENTIAL_UNKNOWN' | 'CREDENTIAL_REVOKED' | 'CREDENTIAL_EXPIRED' };

/** Check whether a credential may currently be used to verify a request. */
export function checkCredential(
  store: CredentialStore,
  keyId: string,
  now: number = Date.now(),
): CredentialCheck {
  const record = store.get(keyId);
  if (!record) return { ok: false, code: 'CREDENTIAL_UNKNOWN' };
  if (record.state === 'REVOKED') return { ok: false, code: 'CREDENTIAL_REVOKED' };
  if (record.expiresAt !== undefined && now >= record.expiresAt) {
    return { ok: false, code: 'CREDENTIAL_EXPIRED' };
  }
  return { ok: true, record };
}

/** Revoke a credential. Returns the updated record. */
export function revokeCredential(
  store: CredentialStore,
  keyId: string,
  reason: string,
  now: number = Date.now(),
): CredentialRecord | null {
  const record = store.get(keyId);
  if (!record) return null;
  const updated: CredentialRecord = {
    ...record,
    state: 'REVOKED',
    revokedAt: now,
    revokedReason: reason,
  };
  store.put(updated);
  return updated;
}
