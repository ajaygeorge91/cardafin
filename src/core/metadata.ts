// Transaction metadata: canonical JSON, sha256, UTF-8-safe 64-byte chunking,
// and the CIP-25 NFT shape. See docs/ARCHITECTURE.md §3 (`core/metadata.ts`).

import { createHash } from "node:crypto";
import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";
import { utf8Bytes, validateAssetNameHex, validatePolicyId } from "./assets.ts";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/**
 * A Cardano transaction metadatum. Note what is absent: the on-chain
 * metadatum type has only ints, byte strings, text strings, lists and maps —
 * there is no boolean and no null. `toMetadatum` therefore rejects `true`,
 * `false` and `null` rather than silently encoding them as 0/1 or "".
 */
export type Metadatum = string | bigint | Metadatum[] | { [k: string]: Metadatum };

export const METADATUM_MAX_BYTES = 64;
export const METADATA_LABEL_CIP25 = 721;
/** CIP-20 transaction message/comment label, used for free-text memos. */
export const METADATA_LABEL_MESSAGE = 674;

/**
 * Deterministic JSON: object keys sorted recursively by UTF-16 code unit
 * (the order `Array.prototype.sort` gives), no whitespace. Numbers are
 * rendered with `String()` and must be finite. Used with `sha256Hex` to
 * fingerprint a payload.
 */
export function canonicalJson(v: Json): Result<string> {
  return writeCanonical(v, "$");
}

function writeCanonical(v: unknown, path: string): Result<string> {
  if (v === null) {
    return ok("null");
  }
  switch (typeof v) {
    case "string":
      return ok(JSON.stringify(v));
    case "boolean":
      return ok(v ? "true" : "false");
    case "number":
      if (!Number.isFinite(v)) {
        return fail("INVALID_METADATA", `${path}: ${String(v)} is not a finite number`);
      }
      return ok(String(v));
    case "bigint":
      return ok(v.toString());
    case "undefined":
      return fail("INVALID_METADATA", `${path}: undefined is not valid JSON`);
    case "function":
    case "symbol":
      return fail("INVALID_METADATA", `${path}: ${typeof v} is not valid JSON`);
    default:
      break;
  }
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (let i = 0; i < v.length; i++) {
      const part = writeCanonical(v[i], `${path}[${i}]`);
      if (!part.ok) {
        return part;
      }
      parts.push(part.value);
    }
    return ok(`[${parts.join(",")}]`);
  }
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const parts: string[] = [];
  for (const [key, value] of entries) {
    const part = writeCanonical(value, `${path}.${key}`);
    if (!part.ok) {
      return part;
    }
    parts.push(`${JSON.stringify(key)}:${part.value}`);
  }
  return ok(`{${parts.join(",")}}`);
}

export function sha256Hex(bytes: string | Uint8Array): string {
  const input = typeof bytes === "string" ? utf8Bytes(bytes) : bytes;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Split `s` so that every chunk is at most `maxBytes` of UTF-8 and no code
 * point is split across chunks. Surrogate pairs (emoji) stay intact. An empty
 * string yields `[]` — there is nothing to store.
 */
export function chunkUtf8(s: string, maxBytes: number = METADATUM_MAX_BYTES): string[] {
  if (typeof s !== "string" || s === "") {
    return [];
  }
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : METADATUM_MAX_BYTES;
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  // Iterating a string yields whole code points, so a 4-byte emoji is one step.
  for (const codePoint of s) {
    const size = encoder.encode(codePoint).length;
    if (size > limit) {
      // A single code point longer than the limit cannot be chunked; emit it
      // on its own rather than dropping or splitting it.
      if (current !== "") {
        chunks.push(current);
        current = "";
        currentBytes = 0;
      }
      chunks.push(codePoint);
      continue;
    }
    if (currentBytes + size > limit) {
      chunks.push(current);
      current = codePoint;
      currentBytes = size;
    } else {
      current += codePoint;
      currentBytes += size;
    }
  }
  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
}

/** True when the UTF-8 encoding of `s` fits in a single metadatum string. */
export function fitsMetadatum(s: string): boolean {
  return utf8Bytes(s).length <= METADATUM_MAX_BYTES;
}

/**
 * Convert plain JSON into a metadatum:
 * - strings up to 64 UTF-8 bytes stay strings; longer ones become arrays of
 *   64-byte chunks (CIP-20/CIP-25 convention),
 * - safe integers become bigint; non-integers are INVALID_METADATA,
 * - booleans and null are INVALID_METADATA (no such metadatum type),
 * - object keys must be at most 64 UTF-8 bytes; keys are sorted so the result
 *   is deterministic.
 */
export function toMetadatum(v: Json): Result<Metadatum> {
  return convert(v, "$");
}

function convert(v: unknown, path: string): Result<Metadatum> {
  if (v === null) {
    return fail(
      "INVALID_METADATA",
      `${path}: null has no Cardano metadatum representation`,
    );
  }
  if (typeof v === "boolean") {
    return fail(
      "INVALID_METADATA",
      `${path}: booleans have no Cardano metadatum representation`,
    );
  }
  if (typeof v === "bigint") {
    return ok(v);
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      return fail("INVALID_METADATA", `${path}: ${String(v)} is not a finite number`);
    }
    if (!Number.isInteger(v)) {
      return fail(
        "INVALID_METADATA",
        `${path}: ${v} is not an integer; metadata has no decimal type`,
      );
    }
    if (!Number.isSafeInteger(v)) {
      return fail(
        "INVALID_METADATA",
        `${path}: ${v} exceeds the safe integer range; pass a string`,
      );
    }
    return ok(BigInt(v));
  }
  if (typeof v === "string") {
    const byteLength = utf8Bytes(v).length;
    if (byteLength <= METADATUM_MAX_BYTES) {
      return ok(v);
    }
    return ok(chunkUtf8(v, METADATUM_MAX_BYTES));
  }
  if (Array.isArray(v)) {
    const out: Metadatum[] = [];
    for (let i = 0; i < v.length; i++) {
      const item = convert(v[i], `${path}[${i}]`);
      if (!item.ok) {
        return item;
      }
      out.push(item.value);
    }
    return ok(out);
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: { [k: string]: Metadatum } = {};
    for (const [key, value] of entries) {
      const keyBytes = utf8Bytes(key).length;
      if (keyBytes > METADATUM_MAX_BYTES) {
        return fail(
          "INVALID_METADATA",
          `${path}.${key}: metadata keys must be at most ${METADATUM_MAX_BYTES} UTF-8 bytes, got ${keyBytes}`,
          { key, bytes: keyBytes, max: METADATUM_MAX_BYTES },
        );
      }
      if (value === undefined) {
        continue;
      }
      const converted = convert(value, `${path}.${key}`);
      if (!converted.ok) {
        return converted;
      }
      out[key] = converted.value;
    }
    return ok(out);
  }
  return fail("INVALID_METADATA", `${path}: ${typeof v} is not valid metadata`);
}

export type Cip25Fields = {
  name: string;
  image?: string | string[];
  description?: string | string[];
  [k: string]: Json | undefined;
};

/**
 * Build the CIP-25 label-721 payload for one asset.
 *
 * CIP-25 **version 2** is used: the asset is keyed by its asset name in
 * **hex**, and `version` is `2n`. (Version 1 keys the asset by its raw UTF-8
 * name, which is ambiguous for non-UTF-8 names — hence v2.) The architecture
 * doc's "version 1" is superseded here on purpose.
 */
export function cip25Metadata(
  policyId: string,
  assetNameHex: string,
  fields: Cip25Fields,
): Result<Metadatum> {
  const p = validatePolicyId(policyId);
  if (!p.ok) {
    return p;
  }
  const n = validateAssetNameHex(assetNameHex);
  if (!n.ok) {
    return n;
  }
  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    return fail("INVALID_METADATA", "cip25 fields must be an object");
  }
  const name = fields.name;
  if (typeof name !== "string" || name === "") {
    return fail("INVALID_METADATA", "cip25 `name` is required and must be a non-empty string");
  }
  const nameBytes = utf8Bytes(name).length;
  if (nameBytes > METADATUM_MAX_BYTES) {
    return fail(
      "INVALID_METADATA",
      `cip25 \`name\` must be at most ${METADATUM_MAX_BYTES} UTF-8 bytes, got ${nameBytes}`,
      { bytes: nameBytes, max: METADATUM_MAX_BYTES },
    );
  }

  const asset: { [k: string]: Metadatum } = {};
  const keys = Object.keys(fields).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    const value = fields[key];
    if (value === undefined) {
      continue;
    }
    const keyBytes = utf8Bytes(key).length;
    if (keyBytes > METADATUM_MAX_BYTES) {
      return fail(
        "INVALID_METADATA",
        `cip25 field key "${key}" is ${keyBytes} UTF-8 bytes; the maximum is ${METADATUM_MAX_BYTES}`,
      );
    }
    const converted = toMetadatum(value);
    if (!converted.ok) {
      return converted;
    }
    asset[key] = converted.value;
  }

  return ok({
    [p.value]: { [n.value]: asset },
    version: 2n,
  });
}
