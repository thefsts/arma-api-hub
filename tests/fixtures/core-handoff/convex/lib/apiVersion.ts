// FSTS Compliance Core — governed API versioning (Phase 6, Chat 1)
//
// Versioned API/service contracts with explicit compatibility rules. An unknown
// or unsupported version fails closed (UNKNOWN_API_VERSION /
// API_VERSION_UNSUPPORTED) rather than being silently coerced to the current
// version.

import { apiError } from "./apiErrors.ts";
import { requireNonEmptyString } from "./validation.ts";

export const CURRENT_API_VERSION = "v1";

// Closed registry of governed service contracts. Additive versions are added
// here; removing or re-scoping an existing version is a breaking change that
// requires a new major version.
export const API_VERSIONS: readonly {
  version: string;
  status: "CURRENT" | "SUPPORTED" | "DEPRECATED";
  // The API versions this version is backward-compatible with (can consume
  // requests addressed to them without semantic change).
  compatibleWith: readonly string[];
  // The date after which the version is no longer accepted (ISO date), or null.
  sunsetAt: string | null;
}[] = [
  {
    version: "v1",
    status: "CURRENT",
    compatibleWith: ["v1"],
    sunsetAt: null,
  },
];

export function isKnownApiVersion(version: unknown): boolean {
  return (
    typeof version === "string" &&
    API_VERSIONS.some((entry) => entry.version === version)
  );
}

export function getApiVersion(version: string) {
  return API_VERSIONS.find((entry) => entry.version === version) ?? null;
}

// Resolve a requested version. Fail closed on unknown/unsupported versions.
export function resolveApiVersion(requested: unknown): {
  version: string;
  status: "CURRENT" | "SUPPORTED" | "DEPRECATED";
  deprecated: boolean;
} {
  const version = requireNonEmptyString(requested, "apiVersion");
  const entry = getApiVersion(version);
  if (!entry) {
    throw apiError("UNKNOWN_API_VERSION", `unknown api version: ${version}`);
  }
  return {
    version: entry.version,
    status: entry.status,
    deprecated: entry.status === "DEPRECATED",
  };
}

// Compatibility rule: a request addressed to `requested` is acceptable when the
// service's `servingVersion` declares compatibility with it. Otherwise the
// caller must migrate (API_VERSION_UNSUPPORTED).
export function assertVersionCompatible(servingVersion: string, requested: string): void {
  const entry = getApiVersion(servingVersion);
  if (!entry) {
    throw apiError("UNKNOWN_API_VERSION", `unknown serving api version: ${servingVersion}`);
  }
  if (!entry.compatibleWith.includes(requested)) {
    throw apiError(
      "API_VERSION_UNSUPPORTED",
      `serving version ${servingVersion} is not compatible with requested ${requested}`,
    );
  }
}

// Machine-readable version advertisement for the service surface.
export function versionManifest() {
  return {
    current: CURRENT_API_VERSION,
    versions: API_VERSIONS.map((entry) => ({
      version: entry.version,
      status: entry.status,
      compatibleWith: [...entry.compatibleWith],
      sunsetAt: entry.sunsetAt,
    })),
  };
}
