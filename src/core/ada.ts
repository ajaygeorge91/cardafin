// ADA / lovelace arithmetic. Every amount is a bigint of lovelace; the only
// decimal handling is string<->bigint conversion at the API boundary. There is
// deliberately no floating-point arithmetic anywhere in this file.
// See docs/ARCHITECTURE.md §3 (`core/ada.ts`).

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";

export type Lovelace = bigint;

export const LOVELACE_PER_ADA = 1_000_000n;
export const ADA_DECIMALS = 6;

const INTEGER_RE = /^[0-9]+$/;
const DECIMAL_RE = /^([0-9]+)(?:\.([0-9]+))?$/;

/**
 * Accepts a bigint, a safe-integer number, or a decimal-integer string
 * ("1500000"). Rejects floats, non-finite numbers, negatives and anything
 * non-numeric. Note: a *string* here is lovelace, not ADA — use
 * `adaToLovelace` for "1.5".
 */
export function parseLovelace(input: string | number | bigint): Result<Lovelace> {
  if (typeof input === "bigint") {
    return input < 0n
      ? fail("INVALID_AMOUNT", `lovelace must be >= 0, got ${input}`)
      : ok(input);
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return fail("INVALID_AMOUNT", `lovelace must be a finite number, got ${input}`);
    }
    if (!Number.isInteger(input)) {
      return fail(
        "INVALID_AMOUNT",
        `lovelace must be a whole number of lovelace, got ${input}`,
      );
    }
    if (!Number.isSafeInteger(input)) {
      return fail(
        "INVALID_AMOUNT",
        `lovelace ${input} exceeds the safe integer range; pass a string or bigint`,
      );
    }
    return input < 0
      ? fail("INVALID_AMOUNT", `lovelace must be >= 0, got ${input}`)
      : ok(BigInt(input));
  }

  if (typeof input === "string") {
    const s = input.trim();
    if (s === "") {
      return fail("INVALID_AMOUNT", "lovelace must not be empty");
    }
    if (!INTEGER_RE.test(s)) {
      return fail(
        "INVALID_AMOUNT",
        `lovelace must be a non-negative whole number, got "${input}"`,
      );
    }
    return ok(BigInt(s));
  }

  return fail("INVALID_AMOUNT", "lovelace must be a string, number or bigint");
}

/** "1.5" -> 1_500_000n. At most 6 decimals; more is INVALID_AMOUNT. */
export function adaToLovelace(ada: string): Result<Lovelace> {
  if (typeof ada !== "string") {
    return fail("INVALID_AMOUNT", "ADA amount must be a string");
  }
  const s = ada.trim();
  if (s === "") {
    return fail("INVALID_AMOUNT", "ADA amount must not be empty");
  }
  const m = DECIMAL_RE.exec(s);
  if (!m) {
    return fail(
      "INVALID_AMOUNT",
      `ADA amount must be a non-negative decimal number, got "${ada}"`,
    );
  }
  const whole = m[1] ?? "0";
  const frac = m[2] ?? "";
  if (frac.length > ADA_DECIMALS) {
    return fail(
      "INVALID_AMOUNT",
      `ADA amount has ${frac.length} decimals; at most ${ADA_DECIMALS} are representable in lovelace`,
      { decimals: frac.length, max: ADA_DECIMALS },
    );
  }
  const padded = frac.padEnd(ADA_DECIMALS, "0");
  return ok(BigInt(whole) * LOVELACE_PER_ADA + BigInt(padded));
}

/** 1_500_000n -> "1.5", 1_000_000n -> "1", 1n -> "0.000001". */
export function lovelaceToAda(l: Lovelace): string {
  const negative = l < 0n;
  const abs = negative ? -l : l;
  const whole = abs / LOVELACE_PER_ADA;
  const frac = abs % LOVELACE_PER_ADA;
  const sign = negative ? "-" : "";
  if (frac === 0n) {
    return `${sign}${whole}`;
  }
  const fracStr = frac.toString().padStart(ADA_DECIMALS, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fracStr}`;
}

export function formatAda(l: Lovelace): string {
  return `${lovelaceToAda(l)} ADA`;
}
