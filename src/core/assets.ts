// Multi-asset values. A `Unit` is either the literal "lovelace" or the
// concatenation policyId(56 hex) + assetNameHex(0-64 hex). Quantities are
// bigint. See docs/ARCHITECTURE.md §3 (`core/assets.ts`).

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";
import type { Utxo } from "./types.ts";

export type Unit = string;
export type Assets = Record<Unit, bigint>;

export const LOVELACE: Unit = "lovelace";

/** On-chain limit for an asset name. */
export const MAX_ASSET_NAME_BYTES = 32;
export const POLICY_ID_HEX_LENGTH = 56;
export const MAX_ASSET_NAME_HEX_LENGTH = MAX_ASSET_NAME_BYTES * 2;

const HEX_RE = /^[0-9a-fA-F]*$/;
const LOWER_HEX_RE = /^[0-9a-f]*$/;
const DIGITS_RE = /^-?[0-9]+$/;

/**
 * True for a (possibly empty) run of hex digits, either case. The empty
 * string is hex: an asset name of zero bytes is legal on Cardano. Stricter
 * length/parity/case rules live in `validatePolicyId` and
 * `validateAssetNameHex`; canonical hex in cardafin is always lowercase.
 */
export function isHex(s: string): boolean {
  return typeof s === "string" && HEX_RE.test(s);
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    s += b.toString(16).padStart(2, "0");
  }
  return s;
}

export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Exactly 56 lowercase hex characters (a 28-byte blake2b-224 script hash). */
export function validatePolicyId(s: string): Result<string> {
  if (typeof s !== "string") {
    return fail("INVALID_POLICY_ID", "policyId must be a string");
  }
  if (s.length !== POLICY_ID_HEX_LENGTH) {
    return fail(
      "INVALID_POLICY_ID",
      `policyId must be ${POLICY_ID_HEX_LENGTH} hex characters, got ${s.length}`,
    );
  }
  if (!LOWER_HEX_RE.test(s)) {
    return fail("INVALID_POLICY_ID", "policyId must be lowercase hex");
  }
  return ok(s);
}

/** 0-64 lowercase hex characters, even length. */
export function validateAssetNameHex(s: string): Result<string> {
  if (typeof s !== "string") {
    return fail("INVALID_ASSET_NAME", "assetNameHex must be a string");
  }
  if (s.length > MAX_ASSET_NAME_HEX_LENGTH) {
    return fail(
      "INVALID_ASSET_NAME",
      `assetNameHex must be at most ${MAX_ASSET_NAME_HEX_LENGTH} hex characters (${MAX_ASSET_NAME_BYTES} bytes), got ${s.length}`,
    );
  }
  if (s.length % 2 !== 0) {
    return fail("INVALID_ASSET_NAME", "assetNameHex must have an even length");
  }
  if (!LOWER_HEX_RE.test(s)) {
    return fail("INVALID_ASSET_NAME", "assetNameHex must be lowercase hex");
  }
  return ok(s);
}

/** UTF-8 encode an asset name; at most 32 bytes on chain. */
export function assetNameToHex(name: string): Result<string> {
  if (typeof name !== "string") {
    return fail("INVALID_ASSET_NAME", "assetName must be a string");
  }
  const bytes = utf8Bytes(name);
  if (bytes.length > MAX_ASSET_NAME_BYTES) {
    return fail(
      "INVALID_ASSET_NAME",
      `assetName is ${bytes.length} UTF-8 bytes; the maximum is ${MAX_ASSET_NAME_BYTES}`,
      { bytes: bytes.length, max: MAX_ASSET_NAME_BYTES },
    );
  }
  return ok(bytesToHex(bytes));
}

/**
 * Decode an asset name for display. Lossy: bytes that are not valid UTF-8
 * become U+FFFD. Never use the result as an identifier — units are hex.
 */
export function hexToAssetName(hex: string): string {
  if (!isHex(hex) || hex.length % 2 !== 0) {
    return "";
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(hexToBytes(hex));
}

export function toUnit(policyId: string, assetNameHex: string): Result<Unit> {
  const p = validatePolicyId(policyId);
  if (!p.ok) {
    return p;
  }
  const n = validateAssetNameHex(assetNameHex);
  if (!n.ok) {
    return n;
  }
  return ok(p.value + n.value);
}

export function fromUnit(
  unit: Unit,
): Result<{ policyId: string; assetNameHex: string; assetName: string }> {
  if (typeof unit !== "string") {
    return fail("INVALID_UNIT", "unit must be a string");
  }
  if (unit === LOVELACE) {
    return fail(
      "INVALID_UNIT",
      "lovelace is not a native asset: it has no policy id or asset name",
    );
  }
  if (unit.length < POLICY_ID_HEX_LENGTH) {
    return fail(
      "INVALID_UNIT",
      `unit must be at least ${POLICY_ID_HEX_LENGTH} hex characters (a policy id), got ${unit.length}`,
    );
  }
  const policyId = unit.slice(0, POLICY_ID_HEX_LENGTH);
  const assetNameHex = unit.slice(POLICY_ID_HEX_LENGTH);
  const p = validatePolicyId(policyId);
  if (!p.ok) {
    return fail("INVALID_UNIT", `unit has an invalid policy id: ${p.error.message}`);
  }
  const n = validateAssetNameHex(assetNameHex);
  if (!n.ok) {
    return fail("INVALID_UNIT", `unit has an invalid asset name: ${n.error.message}`);
  }
  return ok({
    policyId: p.value,
    assetNameHex: n.value,
    assetName: hexToAssetName(n.value),
  });
}

/** Validate any unit, including "lovelace". */
export function validateUnit(unit: Unit): Result<Unit> {
  if (unit === LOVELACE) {
    return ok(LOVELACE);
  }
  const parsed = fromUnit(unit);
  return parsed.ok ? ok(unit) : parsed;
}

/**
 * Sum two asset maps. Exact-zero entries are dropped so that asset maps have
 * one canonical form. Negative quantities are preserved (a mint map uses them
 * for burns).
 */
export function addAssets(a: Assets, b: Assets): Assets {
  const out: Assets = {};
  for (const [unit, qty] of Object.entries(a)) {
    if (qty !== 0n) {
      out[unit] = qty;
    }
  }
  for (const [unit, qty] of Object.entries(b)) {
    const next = (out[unit] ?? 0n) + qty;
    if (next === 0n) {
      delete out[unit];
    } else {
      out[unit] = next;
    }
  }
  return out;
}

/** a - b. INSUFFICIENT_FUNDS if any unit would go negative. Drops zeros. */
export function subtractAssets(a: Assets, b: Assets): Result<Assets> {
  const out: Assets = {};
  for (const [unit, qty] of Object.entries(a)) {
    if (qty !== 0n) {
      out[unit] = qty;
    }
  }
  const short: Array<{ unit: Unit; required: bigint; available: bigint }> = [];
  for (const [unit, qty] of Object.entries(b)) {
    const available = out[unit] ?? 0n;
    const next = available - qty;
    if (next < 0n) {
      short.push({ unit, required: qty, available });
      continue;
    }
    if (next === 0n) {
      delete out[unit];
    } else {
      out[unit] = next;
    }
  }
  if (short.length > 0) {
    return fail(
      "INSUFFICIENT_FUNDS",
      `not enough of: ${short.map((s) => s.unit).join(", ")}`,
      { short },
    );
  }
  return ok(out);
}

export function sumUtxoAssets(utxos: readonly Utxo[]): Assets {
  let total: Assets = {};
  for (const u of utxos) {
    total = addAssets(total, u.assets);
  }
  return total;
}

/** Quantity of a single unit, 0n when absent. */
export function assetQuantity(assets: Assets, unit: Unit): bigint {
  return assets[unit] ?? 0n;
}

export function lovelaceOf(assets: Assets): bigint {
  return assets[LOVELACE] ?? 0n;
}

/** Everything except lovelace. */
export function nativeAssetsOf(assets: Assets): Assets {
  const out: Assets = {};
  for (const [unit, qty] of Object.entries(assets)) {
    if (unit !== LOVELACE) {
      out[unit] = qty;
    }
  }
  return out;
}

export function isEmptyAssets(assets: Assets): boolean {
  return Object.keys(assets).length === 0;
}

/** Distinct policy ids present (lovelace ignored). */
export function policyIdsOf(assets: Assets): string[] {
  const seen = new Set<string>();
  for (const unit of Object.keys(assets)) {
    if (unit !== LOVELACE && unit.length >= POLICY_ID_HEX_LENGTH) {
      seen.add(unit.slice(0, POLICY_ID_HEX_LENGTH));
    }
  }
  return [...seen].sort();
}

/**
 * Validate an untrusted asset map from the API boundary. Every unit must be
 * well formed and every quantity a positive integer (an output asking for
 * zero or negative of something is a client bug, not a burn).
 */
export function parseAssets(
  input: Record<string, string | number | bigint>,
): Result<Assets> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return fail("INVALID_REQUEST", "assets must be an object of unit -> quantity");
  }
  const out: Assets = {};
  for (const [unit, raw] of Object.entries(input)) {
    const u = validateUnit(unit);
    if (!u.ok) {
      return u;
    }
    const qty = parseQuantity(raw, unit);
    if (!qty.ok) {
      return qty;
    }
    out[u.value] = qty.value;
  }
  return ok(out);
}

function parseQuantity(raw: unknown, unit: Unit): Result<bigint> {
  let value: bigint;
  if (typeof raw === "bigint") {
    value = raw;
  } else if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw)) {
      return fail(
        "INVALID_AMOUNT",
        `quantity for ${unit} must be a safe whole number, got ${raw}`,
      );
    }
    value = BigInt(raw);
  } else if (typeof raw === "string") {
    const s = raw.trim();
    if (!DIGITS_RE.test(s)) {
      return fail(
        "INVALID_AMOUNT",
        `quantity for ${unit} must be a whole number, got "${raw}"`,
      );
    }
    value = BigInt(s);
  } else {
    return fail(
      "INVALID_AMOUNT",
      `quantity for ${unit} must be a string, number or bigint`,
    );
  }
  if (value <= 0n) {
    return fail("INVALID_AMOUNT", `quantity for ${unit} must be > 0, got ${value}`);
  }
  return ok(value);
}
