// ARMA API Hub — deterministic test harness.
//
// Builds synthetic, secret-free fixtures for the control-plane tests. The
// "secret" here is a clearly-labeled placeholder used only to exercise HMAC
// signing locally; it is NOT a real credential and must never be reused.

import type { ServiceRecord } from '@arma/contracts';
import { InMemoryCredentialStore } from '@arma/auth';
import { InMemoryIdempotencyRepository, InMemoryNonceRepository } from '@arma/database';
import { InMemoryPolicyRegistry } from '@arma/policy';
import {
  buildSignedServiceRequest,
  type SignedServiceRequest,
  type SignRequestInput,
} from '@arma/sdk';
import { fixedClock, syntheticActiveService } from '@arma/testing';

/** Placeholder signing secret for tests only. Never a real credential. */
export const TEST_SECRET = 'test-only-placeholder-secret-0000000001';
export const TEST_KEY_ID = 'local-dev-key-0001';
export const TEST_SERVICE_ID = 'arma-sentinel';
export const TEST_AUDIENCE = 'arma-api-hub';
export const TEST_CAPABILITY = 'events.subscribe';
export const TEST_BODY = '{"hello":"world"}';

export interface Harness {
  readonly clock: ReturnType<typeof fixedClock>;
  readonly credentials: InMemoryCredentialStore;
  readonly nonces: InMemoryNonceRepository;
  readonly idempotency: InMemoryIdempotencyRepository;
  readonly policy: InMemoryPolicyRegistry;
  readonly resolveSecret: (keyId: string) => string | null;
}

/** Create a fully-wired, deterministic harness. */
export function createHarness(serviceOverrides: Partial<ServiceRecord> = {}): Harness {
  const clock = fixedClock();
  const credentials = new InMemoryCredentialStore();
  credentials.put({
    keyId: TEST_KEY_ID,
    serviceId: TEST_SERVICE_ID,
    state: 'ACTIVE',
    algorithm: 'HMAC-SHA256',
    createdAt: clock.now(),
  });
  const nonces = new InMemoryNonceRepository(clock.now);
  const idempotency = new InMemoryIdempotencyRepository();
  const policy = new InMemoryPolicyRegistry();
  policy.register(syntheticActiveService(serviceOverrides));
  return {
    clock,
    credentials,
    nonces,
    idempotency,
    policy,
    resolveSecret: (keyId) => (keyId === TEST_KEY_ID ? TEST_SECRET : null),
  };
}

/** Build a signed service request with sensible defaults. */
export function signedRequest(
  overrides: Partial<SignRequestInput> = {},
  now = 1_700_000_000_000,
): SignedServiceRequest {
  return buildSignedServiceRequest({
    serviceId: TEST_SERVICE_ID,
    keyId: TEST_KEY_ID,
    secret: TEST_SECRET,
    method: 'POST',
    path: '/v1/validate',
    operation: 'apiHub.event.publish',
    destination: TEST_AUDIENCE,
    classification: 'CONFIDENTIAL',
    correlationId: 'corr-00000001',
    body: TEST_BODY,
    now,
    ...overrides,
  });
}
