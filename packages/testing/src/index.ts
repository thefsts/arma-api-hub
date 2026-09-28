// ARMA API Hub — synthetic test fixtures.
//
// All fixtures use placeholder identifiers and synthetic values. No real
// secrets, credentials, or customer data may ever appear here.

import type { ServiceRecord } from '@arma/contracts';

/** A deterministic, synthetic active service used across tests. */
export function syntheticActiveService(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    serviceId: 'arma-sentinel',
    displayName: 'ARMA Sentinel',
    productId: 'prod-arma-sentinel',
    ownership: 'FSTS_OWNED',
    environment: 'DEVELOPMENT',
    lifecycle: 'ACTIVE',
    onboardingStatus: 'APPROVED',
    owner: {
      ownerId: 'owner-platform',
      displayName: 'Platform Team',
      contactRef: 'platform@example.invalid',
    },
    classification: 'CONFIDENTIAL',
    capabilities: [
      {
        capability: 'events.publish',
        direction: 'OUTBOUND',
        maxClassification: 'CONFIDENTIAL',
        requiresApproval: true,
      },
      {
        capability: 'events.subscribe',
        direction: 'INBOUND',
        maxClassification: 'CONFIDENTIAL',
        requiresApproval: true,
      },
    ],
    connections: [
      {
        connectionId: 'conn-sentinel-to-hub',
        direction: 'OUTBOUND',
        remoteServiceId: 'arma-command-center',
        destinationRef: 'dest-command-center',
        contract: { contractId: 'apiHub.event.publish', version: '1.0.0', status: 'ACTIVE' },
        capabilities: ['events.publish'],
        classification: 'CONFIDENTIAL',
        enabled: true,
      },
    ],
    keyIds: ['local-dev-key-0001'],
    dependencies: [],
    killSwitchEngaged: false,
    contracts: [{ contractId: 'apiHub.event.publish', version: '1.0.0', status: 'ACTIVE' }],
    ...overrides,
  };
}

/** A synthetic revoked service. */
export function syntheticRevokedService(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return syntheticActiveService({
    serviceId: 'arma-retired-service',
    displayName: 'ARMA Retired Service',
    lifecycle: 'RETIRED',
    onboardingStatus: 'SUSPENDED',
    killSwitchEngaged: true,
    ...overrides,
  });
}

/** A fixed clock for deterministic tests. */
export function fixedClock(startMs = 1_700_000_000_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}
