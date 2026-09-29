// FSTS Compliance Core — verification persistence primitives (Phase 5, Chat 2)
//
// Persists the accepted verification architecture: plans, executions, targets,
// verification kinds, engine identity, timing, input hashes, artifact
// references, results, failure/blocked reasons, evidence-candidate references,
// correlation ids, and idempotency references.
//
// HONESTY RULES (locked):
//   * The bounded result vocabulary is preserved exactly. COMPLIANT is NOT a
//     verification result and is never produced here.
//   * PASS means "the assertions held for the observed target at the recorded
//     time". PASS != COMPLIANT.
//   * A result can never be PASS without a real observation.
//   * ERROR is never FAIL; absence of data is never PASS.

import {
  ValidationError,
  requireNonEmptyString,
  requireArray,
  requireEnum,
  compact,
} from "./validation.ts";
import {
  VERIFICATION_KINDS,
  RESULT_VOCABULARY,
  TERMINAL_RESULTS,
  EXECUTION_STATUSES,
  FORBIDDEN_CONCLUSION_TOKENS,
  RUNTIME_ENGINE_NAME,
  RUNTIME_ENGINE_VERSION,
  type VerificationKind,
  type VerificationResult,
  type ExecutionStatus,
} from "./runtimeConstants.ts";

export const PLAN_ID_PATTERN = /^VP-[A-Z0-9][A-Z0-9-]*$/;
export const EXECUTION_ID_PATTERN = /^EXEC-[A-Z0-9][A-Z0-9-]*$/;
export const RESULT_ID_PATTERN = /^VRES-[A-Z0-9][A-Z0-9-]*$/;

// Reject any attempt to smuggle a compliance conclusion into a result.
export function assertNoComplianceConclusion(value: unknown): void {
  if (typeof value !== "string") return;
  const upper = value.trim().toUpperCase();
  if ((FORBIDDEN_CONCLUSION_TOKENS as readonly string[]).includes(upper)) {
    throw new ValidationError(
      "FORBIDDEN_CONCLUSION",
      `"${value}" is a compliance conclusion, not a verification result (PASS != COMPLIANT)`,
    );
  }
}

// Fail-closed result resolution. An unknown/malformed result is never PASS.
export function resolveVerificationResult(value: unknown): VerificationResult {
  if (typeof value !== "string") return "ERROR";
  assertNoComplianceConclusion(value);
  if (!(RESULT_VOCABULARY as readonly string[]).includes(value)) {
    return "ERROR";
  }
  return value as VerificationResult;
}

// A result may only be PASS when a real observation backed it.
export function assertPassRequiresObservation(
  result: unknown,
  observationCount: number,
): void {
  if (result === "PASS" && (!Number.isFinite(observationCount) || observationCount <= 0)) {
    throw new ValidationError(
      "PASS_WITHOUT_OBSERVATION",
      "PASS requires at least one real observation",
    );
  }
}

// Build a persisted verification plan.
export function buildVerificationPlan(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const planId = requireNonEmptyString(input.planId, "planId");
  if (!PLAN_ID_PATTERN.test(planId)) {
    throw new ValidationError("INVALID_ID", `planId "${planId}" must match VP-*`);
  }
  const name = requireNonEmptyString(input.name, "name");
  const description = requireNonEmptyString(input.description, "description");
  const targetRef = requireNonEmptyString(input.targetRef, "targetRef");
  const environmentRef = requireNonEmptyString(input.environmentRef, "environmentRef");
  const verificationKind = requireEnum(
    input.verificationKind,
    VERIFICATION_KINDS,
    "verificationKind",
  );
  const capabilitiesRequired = requireArray(
    input.capabilitiesRequired ?? [],
    "capabilitiesRequired",
  ).map((c) => requireNonEmptyString(c, "capability"));
  const assertions = requireArray(input.assertions ?? [], "assertions");

  return compact({
    tenantId,
    planId,
    name,
    description,
    verificationKind,
    targetRef,
    environmentRef,
    productId: input.productId ?? null,
    controlId: input.controlId ?? null,
    contractResolution: input.contractResolution ?? null,
    capabilitiesRequired,
    assertions,
    executionMode: input.executionMode ?? null,
    version: input.version ?? "1.0.0",
    recordStatus: input.recordStatus ?? "REAL",
  });
}

// Build a persisted verification execution. The result is always the
// fail-closed resolution; PASS is rejected without an observation.
export function buildVerificationExecution(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const executionId = requireNonEmptyString(input.executionId, "executionId");
  if (!EXECUTION_ID_PATTERN.test(executionId)) {
    throw new ValidationError("INVALID_ID", `executionId "${executionId}" must match EXEC-*`);
  }
  const planId = requireNonEmptyString(input.planId, "planId");
  const verificationKind = requireEnum(
    input.verificationKind,
    VERIFICATION_KINDS,
    "verificationKind",
  );
  const status = requireEnum(input.status, EXECUTION_STATUSES, "status") as ExecutionStatus;
  const result = resolveVerificationResult(input.result);
  const observationCount =
    typeof input.observationCount === "number" ? input.observationCount : 0;
  assertPassRequiresObservation(result, observationCount);

  // A terminal execution must carry a terminal result.
  if (status === "COMPLETED" && !(TERMINAL_RESULTS as readonly string[]).includes(result)) {
    throw new ValidationError(
      "NON_TERMINAL_RESULT",
      `completed execution cannot carry non-terminal result ${result}`,
    );
  }

  const failureReason = input.failureReason ?? null;
  const blockedReason = input.blockedReason ?? null;
  if ((result === "FAIL" || result === "ERROR") && !failureReason) {
    throw new ValidationError(
      "MISSING_FAILURE_REASON",
      `result ${result} requires a failureReason`,
    );
  }
  if (result === "BLOCKED" && !blockedReason) {
    throw new ValidationError("MISSING_BLOCKED_REASON", "result BLOCKED requires a blockedReason");
  }

  const evidenceCandidateRefs = requireArray(
    input.evidenceCandidateRefs ?? [],
    "evidenceCandidateRefs",
  ).map((r) => requireNonEmptyString(r, "evidenceCandidateRef"));

  return compact({
    tenantId,
    executionId,
    planId,
    verificationKind,
    engineName: input.engineName ?? RUNTIME_ENGINE_NAME,
    engineVersion: input.engineVersion ?? RUNTIME_ENGINE_VERSION,
    controlId: input.controlId ?? null,
    productId: input.productId ?? null,
    environment: input.environment ?? null,
    targetRef: input.targetRef ?? null,
    status,
    result,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    inputHash: input.inputHash ?? null,
    artifactRefs: requireArray(input.artifactRefs ?? [], "artifactRefs"),
    failureReason,
    blockedReason,
    evidenceCandidateRefs,
    correlationId: input.correlationId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    recordStatus: input.recordStatus ?? "REAL",
  });
}

// Build a persisted verification result record (bounded vocabulary).
export function buildVerificationResult(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const resultId = requireNonEmptyString(input.resultId, "resultId");
  if (!RESULT_ID_PATTERN.test(resultId)) {
    throw new ValidationError("INVALID_ID", `resultId "${resultId}" must match VRES-*`);
  }
  const executionId = requireNonEmptyString(input.executionId, "executionId");
  const verificationKind = requireEnum(
    input.verificationKind,
    VERIFICATION_KINDS,
    "verificationKind",
  );
  const result = resolveVerificationResult(input.result);
  const observationCount =
    typeof input.observationCount === "number" ? input.observationCount : 0;
  assertPassRequiresObservation(result, observationCount);

  return compact({
    tenantId,
    resultId,
    executionId,
    verificationKind,
    result,
    failureReasons: requireArray(input.failureReasons ?? [], "failureReasons"),
    blockedReasons: requireArray(input.blockedReasons ?? [], "blockedReasons"),
    assertionOutcomes: requireArray(input.assertionOutcomes ?? [], "assertionOutcomes"),
    evidenceCandidateRefs: requireArray(
      input.evidenceCandidateRefs ?? [],
      "evidenceCandidateRefs",
    ),
    correlationId: input.correlationId ?? null,
    recordStatus: input.recordStatus ?? "REAL",
  });
}

// Idempotent verification submission: same key + same request hash replays;
// same key + different hash conflicts (fail closed). Delegates to Chat 1's
// evaluateReplay semantics but keeps the decision explicit here.
export function evaluateVerificationSubmission(
  existing: { requestHash?: unknown; resultRef?: unknown } | null | undefined,
  requestHash: string,
): { replay: boolean; conflict: boolean; resultRef: string | null } {
  if (!existing) return { replay: false, conflict: false, resultRef: null };
  if (existing.requestHash !== requestHash) {
    return { replay: false, conflict: true, resultRef: null };
  }
  return {
    replay: true,
    conflict: false,
    resultRef: typeof existing.resultRef === "string" ? existing.resultRef : null,
  };
}
