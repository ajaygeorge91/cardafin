// Result: explicit success/failure without exceptions. See
// docs/ARCHITECTURE.md §3 (`core/result.ts`).

import type { CardafinError } from "./errors.ts";

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = CardafinError> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Narrowing helper, handy in tests and in `if (isOk(r))` chains. */
export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

/**
 * Unwrap or throw. Only for callers that have already decided a failure is
 * unrecoverable (services turn these into HTTP 4xx/5xx instead).
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) {
    return r.value;
  }
  throw r.error;
}

/** Map the success value, leaving an error untouched. */
export function mapOk<T, U, E>(r: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}
