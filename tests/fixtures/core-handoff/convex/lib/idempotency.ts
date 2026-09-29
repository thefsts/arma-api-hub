// FSTS Compliance Core — idempotency primitives (Phase 5, Chat 1)
//
// Reusable idempotency infrastructure for product registration, verification
// submission, evidence receipt, policy distribution, adoption receipts,
// QUALIVANTA handoffs, API Hub callbacks, and legal-source monitoring.
//
// Tenant scope participates in uniqueness. Replay must not duplicate
// authoritative records.

import { requireNonEmptyString } from "./validation.ts";

export const IDEMPOTENCY_SCOPES = [
  "product-registration",
  "verification-submission",
  "evidence-receipt",
  "policy-distribution",
  "adoption-receipt",
  "qualivanta-handoff",
  "api-hub-callback",
  "legal-source-monitoring",
  // Phase 6 (Chat 4) ADDITIVE: governed legal/regulatory intelligence API
  // command scope. Every mutating legal-API operation carries an idempotency
  // key under this scope so replays never duplicate authoritative records.
  "legal-api",
] as const;

export function buildIdempotencyKey(input: {
  tenantId: unknown;
  scope: unknown;
  key: unknown;
}): string {
  const tenantId = requireNonEmptyString(input.tenantId, "tenantId");
  const scope = requireNonEmptyString(input.scope, "scope");
  const key = requireNonEmptyString(input.key, "key");
  return `${tenantId}::${scope}::${key}`;
}

export function evaluateReplay(
  existing:
    | { requestHash?: unknown; status?: unknown; resultRef?: unknown }
    | null
    | undefined,
  requestHash: string,
): { replay: boolean; conflict: boolean; resultRef: string | null } {
  if (!existing) return { replay: false, conflict: false, resultRef: null };
  if (existing.requestHash !== requestHash) {
    // Same key, different payload: fail closed, never overwrite.
    return { replay: false, conflict: true, resultRef: null };
  }
  const resultRef =
    typeof existing.resultRef === "string" ? existing.resultRef : null;
  // Same key + same payload: replay the stored outcome, never duplicate.
  return { replay: true, conflict: false, resultRef };
}
