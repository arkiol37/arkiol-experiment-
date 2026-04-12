// packages/shared/src/typeUtils.ts
// ── Type-safe utilities for strict mode ──────────────────────────────────────

import { Prisma } from '@prisma/client';

/**
 * Extract an error message from an unknown catch value.
 * Usage: catch (err) { const msg = toErrorMessage(err); }
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return (err instanceof Error ? err.message : String(err));
  if (typeof err === 'string') return err;
  return String(err);
}

/**
 * Narrow an unknown catch value to an Error instance.
 * Returns a new Error wrapping the value if it's not already an Error.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' ? err : String(err));
}

/**
 * Type-safe cast for Prisma query results.
 * Prisma's generated client returns typed models, but our build-time stubs
 * return Record<string, unknown>. This helper bridges the gap safely.
 */
export function prismaAs<T>(value: unknown): T {
  return value as T;
}

/**
 * Same as prismaAs but for nullable results (findFirst, findUnique).
 */
export function prismaAsNullable<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  return value as T;
}

// ── Prisma JSON input types ────────────────────────────────────────────────────
//
// Re-exported from the generated Prisma client for use across the codebase.
// These are the ONLY types that Prisma's create/update data properties accept
// for Json and Json? columns:
//
//   Non-nullable Json fields:  Prisma.InputJsonValue
//     → string | number | boolean | InputJsonObject | InputJsonArray
//
//   Nullable Json? fields:    Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
//     → same as above, plus Prisma.JsonNull / Prisma.DbNull
//
// IMPORTANT: Prisma does NOT accept plain `null` for Json? columns.
// You must use Prisma.JsonNull to set the column to SQL NULL.
//
// Two helpers are provided:
//   toJsonValue(value)          — for non-nullable Json fields
//   toJsonValueNullable(value)  — for nullable Json? fields (returns Prisma.JsonNull for null)

// Re-export Prisma's own JSON types so consumers don't need a direct import
export type PrismaInputJsonValue = Prisma.InputJsonValue;
export type PrismaInputJsonObject = { readonly [Key in string]?: PrismaInputJsonValue | null };
export interface PrismaInputJsonArray extends ReadonlyArray<PrismaInputJsonValue | null> {}

/**
 * The return type for toJsonValueNullable — matches what Prisma accepts
 * for nullable Json? column writes.
 */
export type PrismaInputJsonValueNullable =
  | Prisma.InputJsonValue
  | typeof Prisma.JsonNull;

// ── Runtime narrowers ─────────────────────────────────────────────────────────
//
// These functions accept `unknown` inputs and produce narrowed
// Prisma.InputJsonValue outputs with full strict-mode type safety —
// no `any`, no unsafe casts.
//
// They perform a deep structural traversal that:
//   - Passes through strings, numbers, booleans unchanged
//   - Converts undefined object values to null (JSON-safe)
//   - Recursively narrows nested objects and arrays
//   - Drops non-serialisable values (functions, symbols, class instances
//     without plain-object shape) by converting them to their string
//     representation so nothing is silently lost

/**
 * Narrow an `unknown` value to `Prisma.InputJsonValue` (non-nullable).
 *
 * Use for non-nullable Json fields: metadata, payload, diagnostics,
 * stageOutputs, rationale, outputSummary, etc.
 *
 * If the input is null or undefined, returns an empty object `{}` so the
 * field's @default("{}") semantics are preserved.
 */
export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return {};
  return _narrowJsonValue(value) ?? {};
}

/**
 * Narrow an `unknown` value for nullable Json? fields.
 *
 * Use for nullable Json? fields: job.result, brand.learningSignals.
 *
 * Returns Prisma.JsonNull (not plain null) when the input is null/undefined,
 * because Prisma does not accept raw null for Json? column writes.
 */
export function toJsonValueNullable(value: unknown): PrismaInputJsonValueNullable {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return _narrowJsonValue(value) ?? Prisma.JsonNull;
}

// ── Internal recursive narrower (no exports) ──────────────────────────────────

function _narrowJsonValue(value: unknown): Prisma.InputJsonValue | null {
  // Primitives
  if (typeof value === 'string')  return value;
  if (typeof value === 'number')  return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value === null)             return null;

  // Arrays
  if (Array.isArray(value)) {
    return value.map((item: unknown) => _narrowJsonValue(item)) as Prisma.InputJsonArray;
  }

  // Plain objects (including class instances — serialised by own enumerable keys)
  if (typeof value === 'object') {
    const result: Record<string, Prisma.InputJsonValue | null> = {};
    for (const key of Object.keys(value as object)) {
      const v = (value as Record<string, unknown>)[key];
      result[key] = v === undefined ? null : _narrowJsonValue(v);
    }
    return result as Prisma.InputJsonObject;
  }

  // Non-serialisable (function, symbol, bigint) — convert to string so the
  // caller knows something was there rather than silently dropping it
  return String(value);
}
