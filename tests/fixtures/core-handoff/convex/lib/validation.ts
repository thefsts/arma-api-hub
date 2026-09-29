// FSTS Compliance Core — validation primitives (Phase 5, Chat 1)
//
// Pure, dependency-free, fail-closed. Every helper throws a ValidationError
// rather than silently accepting an invalid value.

export class ValidationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

export function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function requireNonEmptyString(value: unknown, name: string): string {
  if (!isNonEmptyString(value)) {
    throw new ValidationError("INVALID_STRING", `${name} must be a non-empty string`);
  }
  return value as string;
}

export function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError("INVALID_NUMBER", `${name} must be a finite number`);
  }
  return value;
}

export function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ValidationError("INVALID_ARRAY", `${name} must be an array`);
  }
  return value;
}

export function requirePlainObject(value: unknown, name: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new ValidationError("INVALID_OBJECT", `${name} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError("INVALID_ENUM", `${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export function requireIdPattern(value: unknown, pattern: RegExp, name: string): string {
  const s = requireNonEmptyString(value, name);
  if (!pattern.test(s)) {
    throw new ValidationError("INVALID_ID", `${name} "${s}" does not match ${pattern}`);
  }
  return s;
}

// Fail-closed default: when a value cannot be validated, return the fallback
// (never silently accept the unvalidated value).
export function failClosed<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// Drop null/undefined entries. Convex optional fields must be OMITTED, not set
// to null, so builders pass their result through compact() before insertion.
export function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}
