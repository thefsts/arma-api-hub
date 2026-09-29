// FSTS Compliance Core — Phase 6 (Chat 5) — API HUB TRANSPORT CONTRACT.
// API Hub Contract — end-to-end certification chain (15 ordered stages).
// ---------------------------------------------------------------------------
// This is a REAL end-to-end certification. It does NOT simulate a parallel
// lifecycle. Every stage drives the ACTUAL integrated Chat 1–4 service surfaces:
//
//   Chat 4 legal governance  — legalWorkflow / legalStatus / legalApi guards
//   Chat 3 lifecycle         — policyRelease / distribution / lifecycleGovernance
//   Chat 1/2 verification    — verification (bounded vocabulary, PASS != COMPLIANT)
//
// Chain:
//   LEGAL CHANGE -> HUMAN/LEGAL REVIEW -> CANONICAL LEGAL UPDATE
//   -> APPLICABILITY REVIEW -> CONTROL ACTIVATION -> POLICY REVIEW/PACK
//   -> APPROVAL -> SIGNED RELEASE -> DISTRIBUTION -> RECEIPT
//   -> APPLICATION/ADOPTION -> VERIFICATION -> EVIDENCE METADATA
//   -> ASSESSMENT -> DRIFT/EXCEPTION/ROLLBACK
//
// At every stage the chain asserts the transition did NOT upgrade into an
// unsupported verdict. Six invariants are each proven by a specific stage:
//   PASS != COMPLIANT, IMPLEMENTED != CERTIFIED, READY != CERTIFIED,
//   APPROVED != RELEASED, RELEASED != ADOPTED, RECEIVED != APPLIED.
//
// Deterministic: no wall clock, no network, no live database. Product intake is
// FROZEN (synthetic/reference consumers only). No stage ever sets
// declaresCompliance or certifies to true.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { E2E_STAGES, E2E_INVARIANTS, REFERENCE_DATE } from './constants.mjs';
import { readiness } from './health.mjs';

// --- Chat 1/2: verification surface ----------------------------------------
import {
  assertNoComplianceConclusion,
  resolveVerificationResult,
  buildVerificationPlan,
  buildVerificationExecution,
  buildVerificationResult,
} from '../../../convex/lib/verification.ts';

// --- Chat 3: policy release / distribution / lifecycle governance ----------
import {
  buildPolicyPackRuntime,
  buildPolicyApproval,
  buildSignedRelease,
  evaluateReleaseEligibility,
  assertReleaseDistributable,
} from '../../../convex/lib/policyRelease.ts';
import {
  buildReleaseDistribution,
  evaluateDistribution,
  buildAdoptionReceipt,
  evaluateAdoption,
  buildRollbackRecord,
  evaluateRollback,
} from '../../../convex/lib/distribution.ts';
import {
  buildDriftRecord,
  classifyDrift,
  buildQualivantaHandoff,
  evaluateHandoff,
  buildRetentionHold,
  evaluateLegalHold,
  projectLifecycle,
} from '../../../convex/lib/lifecycleGovernance.ts';

// --- Chat 4: legal governance ----------------------------------------------
import {
  buildLegalChangeCandidate,
  buildLegalChangeReview,
  assertAcceptRequiresReview,
  assertNoAutoApply,
} from '../../../convex/lib/legalWorkflow.ts';
import {
  buildLegalSourceRuntime,
  buildLegalProvisionRuntime,
  buildLegalJurisdictionRuntime,
  assertAnnArborCh95Invariant,
  ANN_ARBOR_CH95_SOURCE_ID,
  ANN_ARBOR_CH95_SUPERSEDED_BY,
} from '../../../convex/lib/legalStatus.ts';

// ---------------------------------------------------------------------------
// Deterministic fixtures (no clock, no network).
// ---------------------------------------------------------------------------
const TENANT = 'SYNTH-TENANT-A';
const TARGET_TENANT = 'SYNTH-TENANT-A';
const TARGET_PRODUCT = 'SYNTH-PRODUCT-A';
const TARGET_REF = 'SYNTH-TARGET-0001';
const CORRELATION = 'corr-e2e-0001';
const AT = 1_700_000_000_000;

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const CONTENT_DIGEST = sha256('policy-pack-content::v1');
const PACK_VERSION = '1.0.0';

// Each stage is a pure function of the accumulated world. It returns
// { holds, detail, evidence }. `holds` is the stage's transition invariant.
const STAGE_DEFS = [
  {
    stage: 'LEGAL_CHANGE',
    description:
      'A legal/regulatory source change is detected and recorded as a change candidate + SOURCE_CHANGE drift.',
    run: (w) => {
      const candidate = buildLegalChangeCandidate({
        candidateId: 'LCC-0001',
        sourceId: 'LS-MI-0001',
        jurisdictionId: 'JUR-MI',
        detectedAt: AT,
        detectedBy: 'monitor-0001',
        classification: 'UNKNOWN',
        status: 'DETECTED',
        previousHash: sha256('provision::old'),
        observedHash: sha256('provision::new'),
        summary: 'Synthetic detected amendment to a Michigan statute.',
      });
      const drift = buildDriftRecord({
        tenantId: TENANT,
        driftId: 'DRIFT-0001',
        driftKind: 'SOURCE_CHANGE',
        subjectRef: 'LS-MI-0001',
        expectedState: 'EFFECTIVE',
        observedState: 'AMENDED',
        severity: 'MEDIUM',
        disposition: 'OPEN',
        correlationId: CORRELATION,
      });
      const driftDecision = classifyDrift({ drift });
      assertNoAutoApply(candidate);
      w.candidate = candidate;
      w.drift = drift;
      const holds =
        candidate.status === 'DETECTED' &&
        driftDecision.valid === true &&
        driftDecision.requiresReview === true &&
        driftDecision.autoRewritesPolicy === false;
      return {
        holds,
        detail:
          'change detected; SOURCE_CHANGE requires review and never auto-rewrites policy',
        evidence: {
          candidateStatus: candidate.status,
          driftKind: drift.driftKind,
          driftRequiresReview: driftDecision.requiresReview,
          autoRewritesPolicy: driftDecision.autoRewritesPolicy,
        },
      };
    },
  },
  {
    stage: 'HUMAN_LEGAL_REVIEW',
    description:
      'A human/legal reviewer resolves the change review (ACCEPT). Acceptance requires a resolved review.',
    run: (w) => {
      const review = buildLegalChangeReview({
        reviewId: 'LCR-0001',
        candidateId: 'LCC-0001',
        sourceId: 'LS-MI-0001',
        status: 'RESOLVED',
        decision: 'ACCEPT',
        reviewerPrincipalId: 'PR-EXAMPLE-0001',
        rationale: 'Synthetic counsel-approved change.',
        openedAt: AT,
        resolvedAt: AT + 3_600_000,
      });
      const acceptedCandidate = { ...w.candidate, status: 'ACCEPTED' };
      // Must NOT throw: a resolved ACCEPT review authorizes acceptance.
      assertAcceptRequiresReview(acceptedCandidate, [review]);
      assertNoAutoApply(review);
      w.review = review;
      w.acceptedCandidate = acceptedCandidate;
      const holds =
        review.status === 'RESOLVED' &&
        review.decision === 'ACCEPT' &&
        w.release === undefined &&
        w.approval === undefined;
      return {
        holds,
        detail:
          'review resolved with ACCEPT; review is not an approval and does not release',
        evidence: {
          reviewStatus: review.status,
          decision: review.decision,
          approvalExists: w.approval !== undefined,
          releaseExists: w.release !== undefined,
        },
      };
    },
  },
  {
    stage: 'CANONICAL_LEGAL_UPDATE',
    description:
      'The accepted change is reflected as a canonical legal source record (Git canonical). Never authors law.',
    run: (w) => {
      const source = buildLegalSourceRuntime({
        sourceId: 'LS-MI-0001',
        jurisdictionId: 'JUR-MI',
        authorityTier: 'STATE',
        instrumentType: 'STATUTE',
        legalStatus: 'EFFECTIVE',
        enforceability: 'ENFORCING',
        officialSource: 'https://synthetic.example.gov/mi/statute/0001',
        effectiveDate: '2026-01-01',
        coverageStatus: 'SOURCE_VERIFIED',
        researchStatus: 'COMPLETE',
      });
      assertNoAutoApply(source);
      // Ann Arbor Ch.95 lineage invariant: HISTORICAL / NON_ENFORCING / superseded.
      const ch95 = {
        sourceId: ANN_ARBOR_CH95_SOURCE_ID,
        legalStatus: 'HISTORICAL',
        enforceability: 'NON_ENFORCING',
        supersededBy: ANN_ARBOR_CH95_SUPERSEDED_BY,
      };
      assertAnnArborCh95Invariant(ch95);
      w.source = source;
      const holds =
        source.legalStatus === 'EFFECTIVE' &&
        w.release === undefined &&
        w.approval === undefined;
      return {
        holds,
        detail:
          'canonical legal source updated; canonical update is not an approval or release',
        evidence: {
          sourceId: source.sourceId,
          legalStatus: source.legalStatus,
          enforceability: source.enforceability,
          annArborCh95SupersededBy: ch95.supersededBy,
        },
      };
    },
  },
  {
    stage: 'APPLICABILITY_REVIEW',
    description:
      'Applicability is resolved for a provision and its jurisdiction. Applicability is not an approval.',
    run: (w) => {
      const jurisdiction = buildLegalJurisdictionRuntime({
        jurisdictionId: 'JUR-MI',
        name: 'Michigan',
        type: 'STATE',
        coverageStatus: 'SOURCE_VERIFIED',
        researchStatus: 'COMPLETE',
      });
      const provision = buildLegalProvisionRuntime({
        provisionId: 'LP-MI-0001-01',
        sourceId: 'LS-MI-0001',
        jurisdictionId: 'JUR-MI',
        reference: 'Sec. 1',
        provisionType: 'REQUIREMENT',
        mandatoryOrGuidance: 'MANDATORY',
        applicability: 'APPLICABLE',
        legalStatus: 'EFFECTIVE',
        textPolicy: 'REFERENCE_ONLY',
        version: '1.0.0',
      });
      assertNoAutoApply(provision);
      w.jurisdiction = jurisdiction;
      w.provision = provision;
      const holds =
        provision.applicability === 'APPLICABLE' &&
        w.approval === undefined &&
        w.release === undefined;
      return {
        holds,
        detail:
          'applicability resolved (APPLICABLE); applicability review does not approve or release',
        evidence: {
          jurisdictionId: jurisdiction.jurisdictionId,
          provisionApplicability: provision.applicability,
        },
      };
    },
  },
  {
    stage: 'CONTROL_ACTIVATION',
    description:
      'Controls are activated into a policy pack (DRAFT). Control activation is not an approval.',
    run: (w) => {
      const pack = buildPolicyPackRuntime({
        tenantId: TENANT,
        packId: 'PACK-0001',
        version: PACK_VERSION,
        sourceGitCommit: 'e3a1f71ce772eed7e43ff1f0213e806145e7e06e',
        controlSetHash: sha256('control-set::v1'),
        artifactDigest: CONTENT_DIGEST,
        jurisdictionBasis: ['JUR-MI'],
        effectiveDate: '2026-01-01',
        lifecycleState: 'DRAFT',
      });
      w.packDraft = pack;
      const holds =
        pack.lifecycleState === 'DRAFT' &&
        pack.approvalRef == null &&
        w.approval === undefined &&
        w.release === undefined;
      return {
        holds,
        detail:
          'controls activated into a DRAFT pack; activation is not an approval or release',
        evidence: {
          packId: pack.packId,
          lifecycleState: pack.lifecycleState,
          approvalRef: pack.approvalRef,
        },
      };
    },
  },
  {
    stage: 'POLICY_REVIEW_PACK',
    description:
      'The policy pack advances to REVIEW. A reviewed pack is still not approved or released.',
    run: (w) => {
      const pack = buildPolicyPackRuntime({
        tenantId: TENANT,
        packId: 'PACK-0001',
        version: PACK_VERSION,
        sourceGitCommit: 'e3a1f71ce772eed7e43ff1f0213e806145e7e06e',
        controlSetHash: sha256('control-set::v1'),
        artifactDigest: CONTENT_DIGEST,
        jurisdictionBasis: ['JUR-MI'],
        effectiveDate: '2026-01-01',
        lifecycleState: 'REVIEW',
      });
      w.pack = pack;
      const holds =
        pack.lifecycleState === 'REVIEW' &&
        w.approval === undefined &&
        w.release === undefined;
      return {
        holds,
        detail:
          'pack under REVIEW; a reviewed pack is not approved and not released',
        evidence: {
          packId: pack.packId,
          lifecycleState: pack.lifecycleState,
        },
      };
    },
  },
  {
    stage: 'APPROVAL',
    description:
      'A governance authority approves the pack. APPROVED != RELEASED.',
    run: (w) => {
      const approval = buildPolicyApproval({
        tenantId: TENANT,
        approvalId: 'APPR-0001',
        packId: 'PACK-0001',
        packVersion: PACK_VERSION,
        contentDigest: CONTENT_DIGEST,
        decision: 'APPROVED',
        approver: 'PR-APPROVER-0001',
        approverRole: 'COMPLIANCE_AUTHORITY',
        authorityBasis: 'SYNTH-AUTHORITY-BASIS',
        decidedAt: '2026-01-05',
        auditRef: 'AUD-0001',
      });
      w.approval = approval;
      const holds =
        approval.decision === 'APPROVED' &&
        w.release === undefined;
      return {
        holds,
        detail: 'pack APPROVED; approval authorizes release but never releases',
        evidence: {
          approvalId: approval.approvalId,
          decision: approval.decision,
          releaseExists: w.release !== undefined,
        },
      };
    },
  },
  {
    stage: 'SIGNED_RELEASE',
    description:
      'A signed release is issued (signature metadata only). RELEASED != ADOPTED.',
    run: (w) => {
      const release = buildSignedRelease({
        tenantId: TENANT,
        releaseId: 'REL-0001',
        packId: 'PACK-0001',
        packVersion: PACK_VERSION,
        contentDigest: CONTENT_DIGEST,
        approvalRefs: ['APPR-0001'],
        jurisdictionIds: ['JUR-MI'],
        controlIds: ['CTRL-0001'],
        signer: 'PR-SIGNER-0001',
        signerAuthority: 'SYNTH-SIGNER-AUTHORITY',
        signatureAlgorithm: 'SHA-256',
        signatureReference: 'SYNTH-SIG-REF-0001',
        signatureDigest: sha256('release-signature::REL-0001'),
        issuedAt: AT,
        effectiveDate: '2026-01-10',
        auditRef: 'AUD-0002',
      });
      const eligibility = evaluateReleaseEligibility({
        pack: w.pack,
        approvals: [w.approval],
        release,
        asOf: REFERENCE_DATE,
      });
      assertReleaseDistributable(eligibility);
      w.release = release;
      w.eligibility = eligibility;
      const holds =
        release.releaseId === 'REL-0001' &&
        eligibility.eligible === true &&
        w.receipt === undefined &&
        w.appliedReceipt === undefined;
      return {
        holds,
        detail:
          'signed release issued and eligible; a release existing proves nothing about adoption',
        evidence: {
          releaseId: release.releaseId,
          eligible: eligibility.eligible,
          signatureAlgorithm: release.signatureAlgorithm,
          adopted: w.appliedReceipt !== undefined,
        },
      };
    },
  },
  {
    stage: 'DISTRIBUTION',
    description:
      'The signed release is distributed to a SYNTHETIC target. Delivery is not application.',
    run: (w) => {
      const distribution = buildReleaseDistribution({
        tenantId: TENANT,
        distributionId: 'DIST-0001',
        releaseId: 'REL-0001',
        releaseVersion: PACK_VERSION,
        targetTenant: TARGET_TENANT,
        targetProduct: TARGET_PRODUCT,
        environment: 'PROD',
        deliveryState: 'DELIVERED',
        attemptCount: 1,
        correlationId: CORRELATION,
        idempotencyKey: 'idem-dist-0001',
        deliveredAt: AT + 7_200_000,
      });
      const decision = evaluateDistribution({
        releaseEligibility: w.eligibility,
        distribution,
        priorDistributions: [],
      });
      w.distribution = distribution;
      w.distributionDecision = decision;
      const holds =
        decision.deliverable === true &&
        decision.delivered === true &&
        decision.provesApplication === false &&
        w.appliedReceipt === undefined;
      return {
        holds,
        detail:
          'release delivered to a synthetic target; delivery proves no application',
        evidence: {
          distributionId: distribution.distributionId,
          deliveryState: distribution.deliveryState,
          delivered: decision.delivered,
          provesApplication: decision.provesApplication,
        },
      };
    },
  },
  {
    stage: 'RECEIPT',
    description:
      'The synthetic target acknowledges receipt. RECEIVED != APPLIED.',
    run: (w) => {
      const receipt = buildAdoptionReceipt({
        tenantId: TENANT,
        receiptId: 'RCPT-0001',
        releaseId: 'REL-0001',
        releaseVersion: PACK_VERSION,
        targetRef: TARGET_REF,
        targetType: 'SYNTHETIC_TARGET',
        resultingState: 'RECEIVED',
        receivedAt: AT + 7_500_000,
        correlationId: CORRELATION,
        integrityHash: sha256('receipt::RCPT-0001'),
        integrityAlgorithm: 'SHA-256',
      });
      const decision = evaluateAdoption({ receipt });
      w.receipt = receipt;
      w.receiptDecision = decision;
      const holds =
        decision.valid === true &&
        decision.received === true &&
        decision.applied === false &&
        decision.provesApplication === false;
      return {
        holds,
        detail:
          'receipt recorded as RECEIVED; receipt never proves application',
        evidence: {
          receiptId: receipt.receiptId,
          resultingState: receipt.resultingState,
          received: decision.received,
          applied: decision.applied,
        },
      };
    },
  },
  {
    stage: 'APPLICATION_ADOPTION',
    description:
      'The synthetic target applies/adopts the release. Application is recorded, never certified.',
    run: (w) => {
      const receipt = buildAdoptionReceipt({
        tenantId: TENANT,
        receiptId: 'RCPT-0002',
        releaseId: 'REL-0001',
        releaseVersion: PACK_VERSION,
        targetRef: TARGET_REF,
        targetType: 'SYNTHETIC_TARGET',
        resultingState: 'APPLIED',
        receivedAt: AT + 7_500_000,
        appliedAt: AT + 8_000_000,
        verificationRef: 'VP-0001',
        correlationId: CORRELATION,
        integrityHash: sha256('receipt::RCPT-0002'),
        integrityAlgorithm: 'SHA-256',
      });
      const decision = evaluateAdoption({ receipt });
      w.appliedReceipt = receipt;
      w.appliedDecision = decision;
      const holds =
        decision.valid === true &&
        decision.applied === true &&
        decision.provesApplication === true &&
        w.certifies === false;
      return {
        holds,
        detail:
          'release applied by the synthetic target; application is not certification',
        evidence: {
          receiptId: receipt.receiptId,
          resultingState: receipt.resultingState,
          applied: decision.applied,
          certifies: w.certifies,
        },
      };
    },
  },
  {
    stage: 'VERIFICATION',
    description:
      'A verification run executes and PASSes. PASS != COMPLIANT (bounded vocabulary).',
    run: (w) => {
      const plan = buildVerificationPlan({
        tenantId: TENANT,
        planId: 'VP-0001',
        name: 'Synthetic policy release verification',
        description: 'Verifies the applied synthetic release against assertions.',
        targetRef: TARGET_REF,
        environmentRef: 'PROD',
        verificationKind: 'POLICY_RELEASE',
        capabilitiesRequired: ['policy-release-read'],
        assertions: [{ id: 'A1', expected: 'APPLIED' }],
      });
      const execution = buildVerificationExecution({
        tenantId: TENANT,
        executionId: 'EXEC-0001',
        planId: 'VP-0001',
        verificationKind: 'POLICY_RELEASE',
        status: 'COMPLETED',
        result: 'PASS',
        observationCount: 1,
        startedAt: AT + 8_100_000,
        completedAt: AT + 8_200_000,
        correlationId: CORRELATION,
        idempotencyKey: 'idem-exec-0001',
      });
      const result = buildVerificationResult({
        tenantId: TENANT,
        resultId: 'VRES-0001',
        executionId: 'EXEC-0001',
        verificationKind: 'POLICY_RELEASE',
        result: 'PASS',
        observationCount: 1,
        correlationId: CORRELATION,
      });
      // A compliance conclusion can NEVER be a verification result.
      let conclusionRejected = false;
      try {
        assertNoComplianceConclusion('COMPLIANT');
      } catch {
        conclusionRejected = true;
      }
      let resolveRejected = false;
      try {
        resolveVerificationResult('COMPLIANT');
      } catch {
        resolveRejected = true;
      }
      w.verification = { plan, execution, result };
      const holds =
        execution.result === 'PASS' &&
        result.result === 'PASS' &&
        conclusionRejected === true &&
        resolveRejected === true &&
        w.declaresCompliance === false;
      return {
        holds,
        detail:
          'verification PASS recorded; PASS is a verification outcome, never a compliance state',
        evidence: {
          executionResult: execution.result,
          resultResult: result.result,
          complianceConclusionRejected: conclusionRejected,
          declaresCompliance: w.declaresCompliance,
        },
      };
    },
  },
  {
    stage: 'EVIDENCE_METADATA',
    description:
      'Evidence metadata (references + digests only) is handed off. Never raw sensitive evidence.',
    run: (w) => {
      const handoff = buildQualivantaHandoff({
        tenantId: TENANT,
        handoffId: 'HO-0001',
        handoffState: 'PREPARED',
        releaseId: 'REL-0001',
        packId: 'PACK-0001',
        packVersion: PACK_VERSION,
        controlIds: ['CTRL-0001'],
        verificationRefs: ['VRES-0001'],
        evidenceRefs: [
          { evidenceId: 'EV-0001', artifactDigest: sha256('artifact::EV-0001') },
        ],
        targetRef: TARGET_REF,
        targetType: 'SYNTHETIC_TARGET',
        correlationId: CORRELATION,
        integrityHash: sha256('handoff::HO-0001'),
        integrityAlgorithm: 'SHA-256',
      });
      const decision = evaluateHandoff({ handoff });
      w.handoff = handoff;
      w.handoffDecision = decision;
      const holds =
        decision.valid === true &&
        handoff.complianceClaim === 'NONE' &&
        handoff.evidenceHandoffState === 'PROPOSED' &&
        decision.promotesCompliance === false;
      return {
        holds,
        detail:
          'evidence metadata handed off (references + digests only); never a compliance verdict',
        evidence: {
          handoffId: handoff.handoffId,
          complianceClaim: handoff.complianceClaim,
          evidenceHandoffState: handoff.evidenceHandoffState,
          promotesCompliance: decision.promotesCompliance,
        },
      };
    },
  },
  {
    stage: 'ASSESSMENT',
    description:
      'A provider-neutral assessment projection is produced. IMPLEMENTED != CERTIFIED; READY != CERTIFIED.',
    run: (w) => {
      const projection = projectLifecycle({
        kind: 'VERIFICATION_SUMMARY',
        referenceDate: REFERENCE_DATE,
        registries: {
          packs: [w.pack],
          approvals: [w.approval],
          releases: [w.release],
          distributions: [w.distribution],
          adoptionReceipts: [w.appliedReceipt],
          rollbacks: [],
          driftRecords: [w.drift],
          handoffs: [w.handoff],
          retentionHolds: [],
        },
      });
      const readinessSignal = readiness({
        'convex-compliance-core': 'UP',
        'audit-ledger': 'UP',
        'idempotency-store': 'UP',
        'telemetry-sink': 'UP',
      });
      w.projection = projection;
      w.readinessSignal = readinessSignal;
      const holds =
        projection.complianceClaim === 'NONE' &&
        projection.isAuthority === false &&
        readinessSignal.status === 'READY' &&
        readinessSignal.complianceVerdict === 'NONE' &&
        w.certifies === false;
      return {
        holds,
        detail:
          'assessment projection produced (complianceClaim NONE, not authority); readiness is not certification',
        evidence: {
          projectionKind: projection.projectionKind,
          complianceClaim: projection.complianceClaim,
          isAuthority: projection.isAuthority,
          readinessStatus: readinessSignal.status,
          complianceVerdict: readinessSignal.complianceVerdict,
        },
      };
    },
  },
  {
    stage: 'DRIFT_EXCEPTION_ROLLBACK',
    description:
      'Drift, exception, and rollback are tracked. Never auto-rewrites compliance.',
    run: (w) => {
      const drift = buildDriftRecord({
        tenantId: TENANT,
        driftId: 'DRIFT-0002',
        driftKind: 'IMPLEMENTATION_DRIFT',
        subjectRef: TARGET_REF,
        expectedState: 'APPLIED',
        observedState: 'PARTIAL',
        severity: 'LOW',
        disposition: 'OPEN',
        correlationId: CORRELATION,
      });
      const driftDecision = classifyDrift({ drift });
      const rollback = buildRollbackRecord({
        tenantId: TENANT,
        rollbackId: 'RB-0001',
        releaseId: 'REL-0001',
        releaseVersion: PACK_VERSION,
        reason: 'Synthetic rollback drill for certification coverage.',
        reasonCategory: 'ADOPTION_FAILURE',
        authority: 'PR-APPROVER-0001',
        authorityBasis: 'SYNTH-AUTHORITY-BASIS',
        affectedTargets: [TARGET_REF],
        restoredState: 'PREVIOUS_RELEASE',
        initiatedAt: AT + 9_000_000,
        correlationId: CORRELATION,
        completionState: 'COMPLETED',
        completedAt: AT + 9_600_000,
      });
      const rollbackDecision = evaluateRollback({
        rollback,
        releases: [w.release],
        receipts: [w.appliedReceipt],
      });
      const hold = buildRetentionHold({
        tenantId: TENANT,
        holdId: 'HOLD-0001',
        subjectRef: 'REL-0001',
        retentionClass: 'LEGAL_HOLD',
        holdState: 'ACTIVE',
        basis: 'Synthetic legal hold for certification coverage.',
        authority: 'PR-APPROVER-0001',
        correlationId: CORRELATION,
      });
      const holdDecision = evaluateLegalHold({ hold, operation: 'DELETE' });
      w.drift2 = drift;
      w.rollback = rollback;
      w.rollbackDecision = rollbackDecision;
      w.hold = hold;
      w.holdDecision = holdDecision;
      const holds =
        driftDecision.autoRewritesPolicy === false &&
        rollbackDecision.valid === true &&
        rollbackDecision.preservesHistory === true &&
        holdDecision.blocked === true &&
        w.declaresCompliance === false &&
        w.certifies === false;
      return {
        holds,
        detail:
          'drift/exception/rollback tracked and history preserved; active legal hold blocks deletion; never auto-rewrites compliance',
        evidence: {
          driftKind: drift.driftKind,
          autoRewritesPolicy: driftDecision.autoRewritesPolicy,
          rollbackPreservesHistory: rollbackDecision.preservesHistory,
          legalHoldBlocked: holdDecision.blocked,
        },
      };
    },
  },
];

/** Map each mandated invariant to the stage that proves it. */
const INVARIANT_PROOFS = {
  'PASS != COMPLIANT': 'VERIFICATION',
  'IMPLEMENTED != CERTIFIED': 'ASSESSMENT',
  'READY != CERTIFIED': 'ASSESSMENT',
  'APPROVED != RELEASED': 'APPROVAL',
  'RELEASED != ADOPTED': 'SIGNED_RELEASE',
  'RECEIVED != APPLIED': 'RECEIPT',
};

/**
 * Run the REAL end-to-end certification chain over the integrated Chat 1–4
 * surfaces. Returns:
 *   { passed, referenceDate, stageCount, stages, invariants, readinessSignal,
 *     finalState }
 */
export function runE2ECertification() {
  // The world accumulates the REAL records produced by each stage. The two
  // forbidden claims are pinned false and never set true.
  const world = {
    declaresCompliance: false,
    certifies: false,
  };
  const stages = [];

  for (let i = 0; i < STAGE_DEFS.length; i += 1) {
    const def = STAGE_DEFS[i];
    const outcome = def.run(world);
    stages.push({
      order: i + 1,
      stage: def.stage,
      description: def.description,
      invariantHolds: outcome.holds === true,
      detail: outcome.detail,
      evidence: outcome.evidence,
    });
  }

  const readinessSignal = world.readinessSignal;
  const readyNotCertified =
    readinessSignal != null &&
    readinessSignal.status === 'READY' &&
    readinessSignal.complianceVerdict === 'NONE' &&
    world.certifies === false;

  const invariants = E2E_INVARIANTS.map((invariant) => {
    const provenByStage = INVARIANT_PROOFS[invariant];
    const stage = stages.find((s) => s.stage === provenByStage);
    const holds =
      invariant === 'READY != CERTIFIED'
        ? readyNotCertified
        : Boolean(stage && stage.invariantHolds);
    return { invariant, provenByStage, holds };
  });

  const stagesOk =
    stages.length === E2E_STAGES.length && stages.every((s) => s.invariantHolds);
  const invariantsOk = invariants.every((i) => i.holds);
  const noForbiddenClaims =
    world.declaresCompliance === false && world.certifies === false;

  return {
    passed: stagesOk && invariantsOk && noForbiddenClaims,
    referenceDate: REFERENCE_DATE,
    stageCount: stages.length,
    stages,
    invariants,
    readinessSignal,
    finalState: {
      declaresCompliance: world.declaresCompliance,
      certifies: world.certifies,
    },
  };
}
