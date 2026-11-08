// The closed set of failure codes the whole service speaks. See
// docs/ARCHITECTURE.md §3 (`core/errors.ts`).

export type ErrorCode =
  | "INVALID_ADDRESS"
  | "WRONG_NETWORK"
  | "INVALID_AMOUNT"
  | "INVALID_ASSET_NAME"
  | "INVALID_POLICY_ID"
  | "INVALID_UNIT"
  | "INVALID_METADATA"
  | "INSUFFICIENT_FUNDS"
  | "BELOW_MIN_ADA"
  | "MAINNET_NOT_CONFIRMED"
  | "NOT_IMPLEMENTED"
  | "PROVIDER_ERROR"
  | "INVALID_REQUEST";

export const ERROR_CODES: readonly ErrorCode[] = [
  "INVALID_ADDRESS",
  "WRONG_NETWORK",
  "INVALID_AMOUNT",
  "INVALID_ASSET_NAME",
  "INVALID_POLICY_ID",
  "INVALID_UNIT",
  "INVALID_METADATA",
  "INSUFFICIENT_FUNDS",
  "BELOW_MIN_ADA",
  "MAINNET_NOT_CONFIRMED",
  "NOT_IMPLEMENTED",
  "PROVIDER_ERROR",
  "INVALID_REQUEST",
];

export class CardafinError extends Error {
  // Declared as fields + assigned in the body: `erasableSyntaxOnly` forbids
  // parameter properties, and we want plain own-properties either way.
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CardafinError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  /** Safe for logs and HTTP bodies: no stack, no secrets. */
  toJSON(): { code: ErrorCode; message: string; details?: unknown } {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }
}

export function isCardafinError(e: unknown): e is CardafinError {
  return e instanceof CardafinError;
}

// `err` is a value import, but result.ts only imports CardafinError as a
// *type* (erased under verbatimModuleSyntax), so there is no runtime cycle.
import { err } from "./result.ts";
import type { Err } from "./result.ts";

/** Shorthand for the `err(new CardafinError(...))` we write everywhere. */
export function fail(
  code: ErrorCode,
  message: string,
  details?: unknown,
): Err<CardafinError> {
  return err(new CardafinError(code, message, details));
}
