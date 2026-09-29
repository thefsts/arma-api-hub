// FSTS Compliance Core — Phase 7 (Chat 1) governed onboarding state machine
//
// Pure, dependency-free, deterministic. No Convex, no I/O. This module is the
// single source of truth for the onboarding lifecycle shared by the schema
// closed enums, the Convex functions, the governed pipeline gate and the tests.
//
// MISSION INVARIANTS (fail closed):
//   * APPROVED != ACTIVE          — a subject approved but not yet provisioned,
//                                   verified and activated is NOT consumable.
//   * PROVISIONED != VERIFIED     — provisioning is not verification.
//   * VERIFIED != CERTIFIED       — there is deliberately NO CERTIFIED state;
//                                   verification is an operational milestone,
//                                   never a certification claim.
//   * Only ACTIVE is consumable.  Every other state fails closed.
//   * REVOKED and REJECTED are terminal. A revoked subject cannot be revived
//     by re-entering the machine; a new onboarding is required.
//
// PASS != COMPLIANT. Reaching ACTIVE is an operational onboarding outcome, not
// a compliance or certification statement.

export const ONBOARDING_STATES = [
  "PROPOSED",
  "REVIEWED",
  "APPROVED",
  "PROVISIONED",
  "VERIFIED",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
  "REJECTED",
] as const;

export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const ONBOARDING_SUBJECT_TYPES = [
  "SERVICE_IDENTITY",
  "PRODUCT",
  "TENANT_BINDING",
] as const;

export type OnboardingSubjectType = (typeof ONBOARDING_SUBJECT_TYPES)[number];

// Terminal states: no outbound transitions. A revoked subject is permanently
// out; recovery requires a brand-new onboarding, never a state mutation.
export const TERMINAL_STATES: readonly OnboardingState[] = ["REVOKED", "REJECTED"];

// The closed transition table. Any pair not listed here is rejected. This is
// what prevents an APPROVED -> ACTIVE shortcut or a PROVISIONED -> ACTIVE jump.
const TRANSITIONS: Record<OnboardingState, readonly OnboardingState[]> = {
  PROPOSED: ["REVIEWED", "REJECTED"],
  REVIEWED: ["APPROVED", "REJECTED"],
  APPROVED: ["PROVISIONED", "REJECTED", "REVOKED"],
  PROVISIONED: ["VERIFIED", "SUSPENDED", "REVOKED"],
  VERIFIED: ["ACTIVE", "SUSPENDED", "REVOKED"],
  ACTIVE: ["SUSPENDED", "REVOKED"],
  SUSPENDED: ["ACTIVE", "REVOKED"],
  REVOKED: [],
  REJECTED: [],
};

// The ordered forward path. Used to prove that a subject claiming ACTIVE has
// actually traversed every required milestone (anti-forgery).
export const FORWARD_PATH: readonly OnboardingState[] = [
  "PROPOSED",
  "REVIEWED",
  "APPROVED",
  "PROVISIONED",
  "VERIFIED",
  "ACTIVE",
];

// Explicitly forbidden shortcuts. These are the specific "forged onboarding
// status" attempts the mission calls out. They are already excluded by the
// closed transition table; they are enumerated here so they can be asserted
// directly and so the intent is unambiguous.
export const FORBIDDEN_SHORTCUTS: ReadonlyArray<readonly [OnboardingState, OnboardingState]> = [
  ["PROPOSED", "APPROVED"],
  ["PROPOSED", "ACTIVE"],
  ["REVIEWED", "ACTIVE"],
  ["APPROVED", "ACTIVE"],
  ["APPROVED", "VERIFIED"],
  ["PROVISIONED", "ACTIVE"],
  ["PROPOSED", "PROVISIONED"],
  ["REVIEWED", "PROVISIONED"],
  ["REVIEWED", "VERIFIED"],
  ["ACTIVE", "VERIFIED"],
  ["REVOKED", "ACTIVE"],
  ["REJECTED", "ACTIVE"],
  ["REVOKED", "APPROVED"],
];

export function isOnboardingState(value: unknown): value is OnboardingState {
  return typeof value === "string" && (ONBOARDING_STATES as readonly string[]).includes(value);
}

export function isOnboardingSubjectType(value: unknown): value is OnboardingSubjectType {
  return (
    typeof value === "string" && (ONBOARDING_SUBJECT_TYPES as readonly string[]).includes(value)
  );
}

export function isTerminal(state: OnboardingState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function nextStates(state: OnboardingState): readonly OnboardingState[] {
  return TRANSITIONS[state] ?? [];
}

export function canTransition(from: OnboardingState, to: OnboardingState): boolean {
  if (!isOnboardingState(from) || !isOnboardingState(to)) return false;
  return nextStates(from).includes(to);
}

// Thrown-state helpers keep the error surface bounded and machine-readable.
export class OnboardingStateError extends Error {
  code: "ONBOARDING_STATE_INVALID" | "ONBOARDING_NOT_APPROVED" | "ONBOARDING_FORGED";
  from: string | null;
  to: string | null;
  constructor(
    code: "ONBOARDING_STATE_INVALID" | "ONBOARDING_NOT_APPROVED" | "ONBOARDING_FORGED",
    message: string,
    from: string | null = null,
    to: string | null = null,
  ) {
    super(message);
    this.name = "OnboardingStateError";
    this.code = code;
    this.from = from;
    this.to = to;
  }
}

// Assert a single legal transition. Unknown states and illegal pairs both fail
// closed to ONBOARDING_STATE_INVALID.
export function assertTransition(from: unknown, to: unknown): OnboardingState {
  if (!isOnboardingState(from) || !isOnboardingState(to)) {
    throw new OnboardingStateError(
      "ONBOARDING_STATE_INVALID",
      "unknown onboarding state",
      typeof from === "string" ? from : null,
      typeof to === "string" ? to : null,
    );
  }
  if (!canTransition(from, to)) {
    throw new OnboardingStateError(
      "ONBOARDING_STATE_INVALID",
      `illegal onboarding transition ${from} -> ${to}`,
      from,
      to,
    );
  }
  return to;
}

// A subject is consumable ONLY when ACTIVE. Everything else fails closed to
// ONBOARDING_NOT_APPROVED. This is the gate the governed pipeline calls.
export function isConsumable(state: unknown): boolean {
  return state === "ACTIVE";
}

export function assertConsumable(state: unknown): OnboardingState {
  if (!isOnboardingState(state)) {
    throw new OnboardingStateError("ONBOARDING_STATE_INVALID", "unknown onboarding state");
  }
  if (!isConsumable(state)) {
    throw new OnboardingStateError(
      "ONBOARDING_NOT_APPROVED",
      `onboarding subject not ACTIVE (state=${state})`,
      state,
      "ACTIVE",
    );
  }
  return state;
}

// Anti-forgery: given an ordered history of states, verify it is a legal walk
// of the machine that starts at PROPOSED and ends at the claimed state. Any
// illegal step, any gap, or any claimed state not reached by the walk is
// ONBOARDING_FORGED. This is how a forged "ACTIVE" claim is rejected.
export function verifyTransitionHistory(
  history: readonly unknown[],
  claimedState: unknown,
): boolean {
  if (!Array.isArray(history) || history.length === 0) return false;
  if (!isOnboardingState(claimedState)) return false;
  if (history[0] !== "PROPOSED") return false;
  for (let i = 0; i < history.length; i += 1) {
    if (!isOnboardingState(history[i])) return false;
    if (i > 0 && !canTransition(history[i - 1] as OnboardingState, history[i] as OnboardingState)) {
      return false;
    }
  }
  // The last recorded state must equal the claimed state.
  return history[history.length - 1] === claimedState;
}

export function assertTransitionHistory(
  history: readonly unknown[],
  claimedState: unknown,
): OnboardingState {
  if (!verifyTransitionHistory(history, claimedState)) {
    throw new OnboardingStateError(
      "ONBOARDING_FORGED",
      "onboarding transition history does not support the claimed state",
      null,
      typeof claimedState === "string" ? claimedState : null,
    );
  }
  return claimedState as OnboardingState;
}

// The state a transition is expected to be driven by (used by functions to
// label the actor role). Returns null for non-forward states.
export function forwardIndexOf(state: OnboardingState): number {
  return FORWARD_PATH.indexOf(state);
}
