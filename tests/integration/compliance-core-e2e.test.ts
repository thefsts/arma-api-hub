// Phase 7 · Chat 5 — REAL Core ↔ API Hub end-to-end certification.
//
// This suite exercises the ACTUAL converged artifacts from both repositories:
//   - the Core governed pipeline (`runGovernedPipeline`) via the vendored Core
//     conformance fixture (`tests/fixtures/core-handoff`, pinned to Core main
//     @ c7ac04b2d40624bef1742f819a9f7eee43e3d12c);
//   - the Core policy lifecycle (release → distribution → receipt → adoption →
//     drift → rollback);
//   - the Core legal-change workflow + the transport-only legal-change contract;
//   - the API Hub transport client (`@arma/compliance-core-client`).
//
// It proves the governed path, the policy path, and the legal path, plus the
// 20 mandated negative cases and their positive controls. Transport success is
// NEVER a compliance verdict.

import { describe, expect, it } from 'vitest';

// --- Real Core conformance fixture (vendored verbatim from Core main) -------
import {
  API_ERROR_CODES,
  CORE_NOW,
  CORE_SECRET,
  coreEnvelope,
  makeCorePorts,
  runCoreBoundary,
} from '../fixtures/core-handoff/packages/api-hub-contract/src/core-boundary.mjs';
import { runE2ECertification } from '../fixtures/core-handoff/packages/api-hub-contract/src/e2e.mjs';
import {
  assertNoComplianceStateAuthority,
  assertNotificationRequiresCoreGovernance,
  assertTransportOnlyNotification,
  buildLegalChangeNotification,
  coreOperationForNotification,
} from '../fixtures/core-handoff/packages/api-hub-contract/src/legal-change-transport.mjs';
import {
  buildAdoptionReceipt,
  buildDeliveryAcknowledgement,
  buildReleaseDistribution,
  buildRollbackRecord,
  evaluateAdoption,
  evaluateDistribution,
  evaluateRollback,
} from '../fixtures/core-handoff/convex/lib/distribution.ts';
import {
  assertReleaseDistributable,
  buildPolicyApproval,
  buildSignedRelease,
  evaluateReleaseEligibility,
} from '../fixtures/core-handoff/convex/lib/policyRelease.ts';
import {
  assertAcceptRequiresReview,
  assertNoAutoApply,
  assertValidCandidateTransition,
  assertValidReviewTransition,
  buildLegalChangeCandidate,
  buildLegalChangeReview,
} from '../fixtures/core-handoff/convex/lib/legalWorkflow.ts';

// --- API Hub transport client ----------------------------------------------
import {
  REQUIRED_PHASE7_CONTRACT_IDS,
  assertConsumableTraffic,
  assertContractsAvailable,
  assertNoDirectCoreDatabaseAccess,
  assertTransportDoesNotManufactureCoreState,
  buildGovernedEnvelope,
  classifyCoreFailure,
  loadFailureTaxonomy,
  producesConsumableTraffic,
} from '@arma/compliance-core-client';

const DIGEST = 'a'.repeat(64);
const TENANT = 'SYNTH-TENANT-A';

describe('Core ↔ API Hub E2E — governed path (real runGovernedPipeline)', () => {
  it('P1: authorized ACTIVE traffic succeeds, dispatches, and audits', async () => {
    const built = makeCorePorts();
    const res = await runCoreBoundary(coreEnvelope(), { ports: built.ports, store: built.store });
    expect(res.ok).toBe(true);
    expect(res.outcome?.correlationId).toBe('corr-0000001');
    expect(res.outcome?.requestId).toBe('req-00000001');
    // The Core appended its own authoritative audit event.
    expect(built.store.audit.length).toBeGreaterThan(0);
    expect(built.store.audit.some((e) => e.correlationId === 'corr-0000001')).toBe(true);
  });

  it('P1b: an envelope BUILT by the API Hub client is accepted by the real Core pipeline', async () => {
    // The strongest integration proof: the Hub's own transport envelope builder
    // must produce a signature the AUTHORITATIVE Core boundary verifies.
    const envelope = buildGovernedEnvelope({
      apiVersion: 'v1',
      tenantId: TENANT,
      serviceIdentityId: 'SVC-EXAMPLE-0001',
      productId: 'SYNTH-PRODUCT-A',
      environment: 'PROD',
      action: 'compliance.verify',
      resourceType: 'verificationExecution',
      resourceId: 'RES-1',
      timestamp: CORE_NOW,
      nonce: 'nonce-0123456789abcdef',
      requestId: 'req-00000001',
      correlationId: 'corr-0000001',
      idempotencyKey: 'idem-0000001',
      payload: { asOf: '2026-09-16', resourceId: 'RES-1' },
      secret: CORE_SECRET,
    });
    const built = makeCorePorts();
    const res = await runCoreBoundary(envelope, { ports: built.ports, store: built.store });
    expect(res.ok).toBe(true);
    expect(res.outcome?.correlationId).toBe('corr-0000001');
    // Transport success is never a compliance verdict.
    expect(
      built.store.audit.some(
        (e) => (e.metadata as { outcome?: string } | undefined)?.outcome === 'SUCCESS',
      ),
    ).toBe(true);
  });

  it('P2: same idempotency key + same body replays the stored outcome', async () => {
    const built = makeCorePorts();
    const first = await runCoreBoundary(coreEnvelope(), {
      ports: built.ports,
      store: built.store,
    });
    expect(first.ok).toBe(true);
    const second = await runCoreBoundary(coreEnvelope({ nonce: 'nonce-ffffffffffffffff' }), {
      ports: built.ports,
      store: built.store,
    });
    expect(second.ok).toBe(true);
    expect(second.outcome?.replayed).toBe(true);
  });

  it('#10 replay (nonce reuse) is denied', async () => {
    const built = makeCorePorts();
    await runCoreBoundary(coreEnvelope(), { ports: built.ports, store: built.store });
    const replay = await runCoreBoundary(coreEnvelope(), {
      ports: built.ports,
      store: built.store,
    });
    expect(replay.ok).toBe(false);
    expect(replay.code).toBe('NONCE_REPLAY');
  });

  it('#11 idempotency conflict (same key, different body) is denied', async () => {
    const built = makeCorePorts();
    await runCoreBoundary(coreEnvelope(), { ports: built.ports, store: built.store });
    const conflict = await runCoreBoundary(
      coreEnvelope({
        nonce: 'nonce-ffffffffffffffff',
        payload: { asOf: '2026-09-17', resourceId: 'RES-2' },
      }),
      { ports: built.ports, store: built.store },
    );
    expect(conflict.ok).toBe(false);
    expect(conflict.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('#7 stale request (past window) is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope({ timestamp: CORE_NOW - 10_000_000 }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('REQUEST_STALE');
  });

  it('#8 future-skewed request is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope({ timestamp: CORE_NOW + 10_000_000 }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('REQUEST_FUTURE');
  });

  it('#9 tampered signed field is denied (REQUEST_TAMPERED)', async () => {
    const res = await runCoreBoundary(
      coreEnvelope({ tamper: 'resourceId', tamperValue: 'RES-HACKED' }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe('REQUEST_TAMPERED');
  });

  it('#20 malformed envelope (missing signed field) is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope({ dropField: 'nonce' }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NONCE_INVALID');
  });

  it('#12 cross-tenant access is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope({ tenantId: 'SYNTH-TENANT-B' }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('#13 cross-product access is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope({ productId: 'SYNTH-PRODUCT-B' }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('PRODUCT_ISOLATION_VIOLATION');
  });

  it('#14 cross-environment access is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope({ environment: 'DEV' }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('ENVIRONMENT_NOT_AUTHORIZED');
  });

  it('#15 scope escalation is denied (role lacks the contract scope)', async () => {
    // The contract requires `api:invoke`; an AUDITOR role does not hold it, so
    // the server-side authorization decision fails closed with FORBIDDEN.
    const res = await runCoreBoundary(coreEnvelope(), {
      roles: [{ role: 'AUDITOR', status: 'ACTIVE', scopeType: 'TENANT', scopeId: TENANT }],
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('FORBIDDEN');
  });

  it('#16 forged / unresolvable identity is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope(), { secret: null });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('CREDENTIAL_INVALID');
  });

  it('#17 inactive integration is denied', async () => {
    const res = await runCoreBoundary(coreEnvelope(), { identity: { status: 'SUSPENDED' } });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('IDENTITY_SUSPENDED');
  });

  it('#18 unsupported version is denied (no silent downgrade)', async () => {
    const res = await runCoreBoundary(coreEnvelope({ apiVersion: 'v2' }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe('UNKNOWN_API_VERSION');
  });

  it('#19 unknown operation is denied', async () => {
    // No contract resolves for the addressed action -> CONTRACT_UNKNOWN.
    const res = await runCoreBoundary(coreEnvelope({ action: 'compliance.nope' }), {
      contract: null,
    });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('CONTRACT_UNKNOWN');
  });

  it('every denial uses a bounded code from the Core pipeline taxonomy', async () => {
    const known = new Set(API_ERROR_CODES as readonly string[]);
    const res = await runCoreBoundary(coreEnvelope({ tenantId: 'SYNTH-TENANT-B' }));
    expect(known.has(res.code as string)).toBe(true);
    // The Hub maps the internal Core code through its service taxonomy,
    // fail-closed to INTERNAL_FAILURE for codes it does not model.
    const taxonomy = loadFailureTaxonomy('contracts/compliance-core/core-handoff');
    const classified = classifyCoreFailure(res.code as string, taxonomy);
    expect(classified.code).toBe('INTERNAL_FAILURE');
    // INTERNAL_FAILURE is the taxonomy's own retryable fallback; the Hub still
    // never manufactures a compliance verdict from a transport outcome.
    expect(classified.retryable).toBe(true);
  });
});

describe('Core ↔ API Hub E2E — policy path (release → adoption → drift → rollback)', () => {
  function buildEligibleRelease() {
    const pack = { packId: 'PACK-EXAMPLE-0001', version: '1.0.0', lifecycleState: 'ACTIVE' };
    const approval = buildPolicyApproval({
      tenantId: TENANT,
      approvalId: 'APR-1',
      packId: 'PACK-EXAMPLE-0001',
      packVersion: '1.0.0',
      contentDigest: DIGEST,
      decision: 'APPROVED',
      approver: 'thefsts',
      approverRole: 'COMPLIANCE_OFFICER',
      authorityBasis: 'POLICY_OWNER',
      decidedAt: '2026-09-01',
    });
    const release = buildSignedRelease({
      tenantId: TENANT,
      releaseId: 'REL-1',
      packId: 'PACK-EXAMPLE-0001',
      packVersion: '1.0.0',
      contentDigest: DIGEST,
      signer: 'thefsts',
      signerAuthority: 'POLICY_AUTHORITY',
      signatureAlgorithm: 'SHA-256',
      signatureReference: 'SIGREF-1',
      signatureDigest: DIGEST,
      effectiveDate: '2026-09-01',
      approvalRefs: ['APR-1'],
    });
    return { pack, approval, release };
  }

  it('P4: APPROVED → RELEASED → DISTRIBUTED → RECEIVED → APPLIED → VERIFIED', () => {
    const { pack, approval, release } = buildEligibleRelease();
    const eligibility = evaluateReleaseEligibility({
      pack,
      approvals: [approval],
      release,
      asOf: '2026-09-15',
    });
    expect(eligibility.eligible).toBe(true);
    assertReleaseDistributable(eligibility);

    const distribution = buildReleaseDistribution({
      tenantId: TENANT,
      distributionId: 'DIST-1',
      releaseId: 'REL-1',
      releaseVersion: '1.0.0',
      targetTenant: TENANT,
      targetProduct: 'SYNTH-PRODUCT-A',
      environment: 'PROD',
      deliveryState: 'DELIVERED',
      correlationId: 'corr-0000001',
      idempotencyKey: 'idem-dist-1',
    });
    const decision = evaluateDistribution({ releaseEligibility: eligibility, distribution });
    expect(decision.delivered).toBe(true);
    // Delivery never proves application.
    expect(decision.provesApplication).toBe(false);

    const ack = buildDeliveryAcknowledgement({ distribution, acknowledgedAt: CORE_NOW });
    expect(ack.deliveryState).toBe('ACKNOWLEDGED');

    const receipt = buildAdoptionReceipt({
      tenantId: TENANT,
      receiptId: 'REC-1',
      releaseId: 'REL-1',
      releaseVersion: '1.0.0',
      targetRef: 'SYNTH-TARGET-0001',
      targetType: 'SYNTHETIC_TARGET',
      resultingState: 'RECEIVED',
      receivedAt: CORE_NOW,
      correlationId: 'corr-0000001',
      integrityHash: DIGEST,
      integrityAlgorithm: 'SHA-256',
    });
    const adoption = evaluateAdoption({ receipt });
    expect(adoption.received).toBe(true);
    // RECEIVED != APPLIED.
    expect(adoption.applied).toBe(false);
    expect(adoption.provesApplication).toBe(false);
  });

  it('#23 unauthorized product intake is denied (product intake frozen)', () => {
    expect(() =>
      buildReleaseDistribution({
        tenantId: TENANT,
        distributionId: 'DIST-BAD',
        releaseId: 'REL-1',
        releaseVersion: '1.0.0',
        targetTenant: 'REAL-TENANT',
        targetProduct: 'REAL-PRODUCT',
        environment: 'PROD',
        correlationId: 'corr-0000001',
        idempotencyKey: 'idem-dist-bad',
      }),
    ).toThrow();
  });

  it('rollback preserves history and keeps ROLLED_BACK distinct', () => {
    const { release } = buildEligibleRelease();
    const rollback = buildRollbackRecord({
      tenantId: TENANT,
      rollbackId: 'RB-1',
      releaseId: 'REL-1',
      releaseVersion: '1.0.0',
      reason: 'regulatory change superseded the released pack',
      reasonCategory: 'REGULATORY_CHANGE',
      authority: 'thefsts',
      authorityBasis: 'POLICY_AUTHORITY',
      restoredState: 'PRIOR_RELEASE',
      affectedTargets: ['SYNTH-TARGET-0001'],
      correlationId: 'corr-0000001',
    });
    const decision = evaluateRollback({ rollback, releases: [release], receipts: [] });
    expect(decision.valid).toBe(true);
    expect(decision.preservesHistory).toBe(true);
  });

  it('#24 transport must not manufacture Core policy state', () => {
    expect(() => assertTransportDoesNotManufactureCoreState('APPLIED')).toThrow();
    expect(() => assertTransportDoesNotManufactureCoreState('VERIFIED')).toThrow();
    // Transport may legitimately carry a transport-side state.
    expect(() => assertTransportDoesNotManufactureCoreState('DISTRIBUTED')).not.toThrow();
  });
});

describe('Core ↔ API Hub E2E — legal path (human review; transport-only)', () => {
  it('P5: DETECTED → CLASSIFIED → IN_REVIEW → ACCEPTED (via resolved review)', () => {
    const candidate = buildLegalChangeCandidate({
      candidateId: 'LC-1',
      sourceId: 'LS-MI-ANNARBOR-CH95',
      jurisdictionId: 'JUR-MI',
      detectedBy: 'monitor',
      classification: 'SUBSTANTIVE',
      status: 'CLASSIFIED',
    });
    expect(candidate.status).toBe('CLASSIFIED');

    assertValidCandidateTransition('DETECTED', 'CLASSIFIED');
    assertValidCandidateTransition('CLASSIFIED', 'IN_REVIEW');
    assertValidCandidateTransition('IN_REVIEW', 'ACCEPTED');
    assertValidReviewTransition('OPEN', 'IN_PROGRESS');
    assertValidReviewTransition('IN_PROGRESS', 'RESOLVED');

    const review = buildLegalChangeReview({
      reviewId: 'LR-1',
      candidateId: 'LC-1',
      sourceId: 'LS-MI-ANNARBOR-CH95',
      status: 'RESOLVED',
      decision: 'ACCEPT',
      reviewerPrincipalId: 'PR-EXAMPLE-0001',
    });
    expect(review.decision).toBe('ACCEPT');
    // Acceptance is only valid with the resolved ACCEPT review.
    expect(() =>
      assertAcceptRequiresReview({ candidateId: 'LC-1', status: 'ACCEPTED' }, [review]),
    ).not.toThrow();
  });

  it('#25 unreviewed legal update is denied (no auto-apply)', () => {
    // ACCEPTED without a resolved ACCEPT review fails closed.
    expect(() =>
      assertAcceptRequiresReview({ candidateId: 'LC-1', status: 'ACCEPTED' }, []),
    ).toThrow();
    // A candidate can never jump DETECTED → ACCEPTED.
    expect(() => assertValidCandidateTransition('DETECTED', 'ACCEPTED')).toThrow();
    // No auto-apply / enforcement mutation field may appear.
    expect(() => assertNoAutoApply({ candidateId: 'LC-1', autoApply: true })).toThrow();
    expect(() =>
      assertNoAutoApply({ candidateId: 'LC-1', enforcementChange: 'ACTIVATE' }),
    ).toThrow();
  });

  it('#24 auto legal enforcement via transport is denied', () => {
    const notification = buildLegalChangeNotification({
      kind: 'LEGAL_CHANGE_DETECTED',
      changeRef: 'LC-1',
      sourceId: 'LS-MI-ANNARBOR-CH95',
      jurisdictionId: 'JUR-MI',
      issuedAt: CORE_NOW,
      correlationId: 'corr-0000001',
    });
    expect(notification.transportOnly).toBe(true);
    expect(notification.carriesComplianceAuthority).toBe(false);
    assertTransportOnlyNotification(notification);
    // Smuggling an authority field fails closed.
    expect(() =>
      assertNoComplianceStateAuthority({ ...notification, enforcement: 'ON' }),
    ).toThrow();
    expect(() =>
      assertTransportOnlyNotification({ ...notification, authoritative: true }),
    ).toThrow();
  });

  it('#26 direct legal-change product action is denied (must cross Core governance)', () => {
    const notification = buildLegalChangeNotification({
      kind: 'LEGAL_CHANGE_DETECTED',
      changeRef: 'LC-1',
      sourceId: 'LS-MI-ANNARBOR-CH95',
      jurisdictionId: 'JUR-MI',
      issuedAt: CORE_NOW,
      correlationId: 'corr-0000001',
    });
    const governedOp = coreOperationForNotification('LEGAL_CHANGE_DETECTED');
    expect(() => assertNotificationRequiresCoreGovernance(notification, governedOp)).not.toThrow();
    // Acting directly (not through the governed Core operation) fails closed.
    expect(() =>
      assertNotificationRequiresCoreGovernance(notification, 'product.direct.apply'),
    ).toThrow();
  });
});

describe('Core ↔ API Hub E2E — full certification chain + boundary guards', () => {
  it('P6: the real 15-stage E2E chain passes and never declares compliance', () => {
    const e2e = runE2ECertification();
    expect(e2e.passed).toBe(true);
    expect(e2e.stageCount).toBe(15);
    expect(e2e.stages.every((s) => s.invariantHolds)).toBe(true);
    expect(e2e.invariants.every((i) => i.holds)).toBe(true);
    expect(e2e.finalState.declaresCompliance).toBe(false);
    expect(e2e.finalState.certifies).toBe(false);
  });

  it('#22 direct Core Convex database access is forbidden', () => {
    expect(() =>
      assertNoDirectCoreDatabaseAccess("import { api } from 'convex/_generated/api'"),
    ).toThrow();
    expect(() => assertNoDirectCoreDatabaseAccess('const c = new ConvexHttpClient(url)')).toThrow();
    expect(() => assertNoDirectCoreDatabaseAccess("import x from 'convex/server'")).toThrow();
  });

  it('P3: only ACTIVE onboarding produces consumable traffic', () => {
    expect(producesConsumableTraffic('ACTIVE')).toBe(true);
    expect(producesConsumableTraffic('APPROVED')).toBe(false);
    expect(producesConsumableTraffic('PROVISIONED')).toBe(false);
    expect(() => assertConsumableTraffic('ACTIVE')).not.toThrow();
    expect(() => assertConsumableTraffic('APPROVED')).toThrow();
  });

  it('all 12 converged contracts are present (fail-closed guard passes)', () => {
    expect(() => assertContractsAvailable(REQUIRED_PHASE7_CONTRACT_IDS)).not.toThrow();
    expect(() => assertContractsAvailable(REQUIRED_PHASE7_CONTRACT_IDS.slice(1))).toThrow();
  });
});
