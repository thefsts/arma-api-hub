// ARMA API Hub — Compliance Core transport client (Phase 7 · Chat 5).
//
// STATUS: PREPARED — NOT FINALIZED (dependency hold active).
//
// The governed connection to the FSTS Compliance Core is gated on the Phase 7
// Chat 1-4 contracts. This module defines the transport-side boundary and a
// fail-closed guard. It does NOT define the governed wire contract: that
// contract is owned by the Compliance Core and is consumed verbatim once
// available. No field, version, or operation is invented here.
//
// The API Hub transports. The Compliance Core decides. There is no direct
// database access from the API Hub to the Compliance Core Convex deployment.

import type { ApiError, ServiceRequestEnvelope } from '@arma/contracts';

/** Integration status. Remains PENDING until the Phase 7 contracts land. */
export const COMPLIANCE_CORE_INTEGRATION_STATUS = 'PENDING_DEPENDENCY' as const;
export type ComplianceCoreIntegrationStatus = 'PENDING_DEPENDENCY' | 'FINALIZED';

/**
 * The Phase 7 Chat 1-4 artifacts this lane consumes. IDs mirror
 * `contracts/compliance-core/intake-manifest.json`; content is owned by the
 * producing chat and is never restated or invented here.
 */
export const REQUIRED_PHASE7_CONTRACT_IDS = Object.freeze([
  'phase7.chat1.governed-request',
  'phase7.chat1.governed-response',
  'phase7.chat2.tenant-product-environment-authorization',
  'phase7.chat2.replay-idempotency-semantics',
  'phase7.chat3.legal-governance-handoff',
  'phase7.chat3.policy-release-adoption-drift-handoff',
  'phase7.chat4.audit-correlation',
  'phase7.chat4.service-identity-credential-exchange',
] as const);
export type RequiredPhase7ContractId = (typeof REQUIRED_PHASE7_CONTRACT_IDS)[number];

/** Concerns the Compliance Core owns (authority). The API Hub never decides these. */
export const CORE_OWNED_CONCERNS = Object.freeze([
  'compliance-authority',
  'compliance-state',
  'legal-governance',
  'policy-governance',
  'applicability',
  'controls',
  'evidence-metadata',
  'release-adoption-drift-rollback-authority',
] as const);

/** Concerns the API Hub owns (transport). The API Hub never exceeds these. */
export const TRANSPORT_OWNED_CONCERNS = Object.freeze([
  'external-transport',
  'connectors',
  'webhooks',
  'delivery',
  'retries',
  'external-rate-limits',
  'vendor-quotas',
  'api-usage-cost-telemetry-transport',
  'routing',
] as const);

/** Thrown when the integration is asked to operate before its contracts exist. */
export class ContractsUnavailableError extends Error {
  readonly code = 'COMPLIANCE_CORE_CONTRACTS_UNAVAILABLE';
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Compliance Core integration is not finalized: ${missing.length} required Phase 7 contract(s) unavailable (${missing.join(', ')})`,
    );
    this.name = 'ContractsUnavailableError';
    this.missing = Object.freeze([...missing]);
  }
}

/**
 * Fail-closed guard. Refuses to operate until every required Phase 7 contract
 * is present. The integration must never run against an invented contract.
 */
export function assertContractsAvailable(presentIds: readonly string[]): void {
  const present = new Set(presentIds);
  const missing = REQUIRED_PHASE7_CONTRACT_IDS.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new ContractsUnavailableError(missing);
  }
}

/**
 * A resolved governed contract descriptor. Supplied by the intake (the real
 * Phase 7 artifact), never synthesized locally.
 */
export interface GovernedContractDescriptor {
  readonly contractId: string;
  readonly version: string;
  readonly operations: readonly string[];
}

/** Bounded outcome of forwarding a governed request. */
export type TransportResult =
  | { readonly ok: true; readonly body: string; readonly correlationId: string }
  | { readonly ok: false; readonly error: ApiError; readonly retryable: boolean };

/** Connector health for the Compliance Core connection (fail-closed aggregation). */
export interface TransportHealth {
  readonly status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly killSwitchEngaged: boolean;
  /** Negotiated governed contract version, or null when unavailable. */
  readonly contractVersion: string | null;
}

/**
 * Transport adapter interface for the governed connection.
 *
 * Payloads are opaque (`unknown`) until the governed contract defines them.
 * The adapter signs the exact bytes it forwards and never decides compliance.
 * An implementation may only be constructed after `assertContractsAvailable`
 * has passed for the real contracts.
 */
export interface ComplianceCoreTransport {
  /** Forward a signed governed request; return a bounded response or bounded failure. */
  forward(signed: ServiceRequestEnvelope, governedBody: string): Promise<TransportResult>;
  /** Connector health for the Compliance Core connection. */
  health(): Promise<TransportHealth>;
}

/** True only when the integration has been finalized against the real contracts. */
export function isFinalized(status: ComplianceCoreIntegrationStatus): boolean {
  return status === 'FINALIZED';
}
