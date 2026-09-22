// ARMA API Hub — contract validation helpers.
//
// Thin, deterministic wrappers around zod parsing that return a discriminated
// result instead of throwing. These are used by the API, worker, and tests so
// that validation behavior is identical everywhere.

import type { z } from 'zod';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/** Validate a value against a schema without throwing. */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}

/** Validate and throw a compact error on failure (for internal call sites). */
export function validateOrThrow<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = validate(schema, input);
  if (!result.ok) {
    const summary = result.issues.map((i) => `${i.path || '<root>'}: ${i.message}`).join('; ');
    throw new Error(`${label}_INVALID: ${summary}`);
  }
  return result.value;
}
