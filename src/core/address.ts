// Bech32 (BIP-173) codec and Shelley address parsing, implemented here so
// that core keeps zero npm dependencies. See docs/ARCHITECTURE.md §3.
//
// Deliberate deviation from BIP-173: the 90-character total length limit is
// NOT enforced. Cardano base addresses are 103 characters (a 57-byte payload)
// and are perfectly valid; the checksum is still verified in full.

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";
import { bytesToHex, hexToBytes, isHex } from "./assets.ts";
import type { Network } from "./network.ts";
import { networkId as networkIdOf } from "./network.ts";

export type AddressKind = "base" | "script-base" | "pointer" | "enterprise" | "reward";

export type AddressInfo = {
  /** The address, normalised to lowercase. */
  bech32: string;
  networkId: 0 | 1;
  /** High nibble of the header byte: 0-7 payment types, 14/15 reward. */
  headerType: number;
  kind: AddressKind;
  /** 28-byte payment credential hash, for header types 0-7. */
  paymentCredentialHex?: string;
  /** 28-byte stake credential hash, for base (0-3) and reward (14/15) types. */
  stakeCredentialHex?: string;
};

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CHECKSUM_LENGTH = 6;
const CREDENTIAL_BYTES = 28;
const BYRON_PREFIX_RE = /^(Ae2|DdzFF)/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function polymod(values: readonly number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GENERATOR[i] ?? 0;
      }
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    out.push(hrp.charCodeAt(i) >> 5);
  }
  out.push(0);
  for (let i = 0; i < hrp.length; i++) {
    out.push(hrp.charCodeAt(i) & 31);
  }
  return out;
}

function convertBits(
  data: readonly number[],
  from: number,
  to: number,
  pad: boolean,
): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) {
      return null;
    }
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) {
      out.push((acc << (to - bits)) & maxv);
    }
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

/**
 * Decode a bech32 string into its human-readable part and payload bytes.
 * Verifies the checksum. Accepts all-lowercase or all-uppercase input (mixed
 * case is rejected per BIP-173) and returns the hrp lowercased.
 */
export function decodeBech32(s: string): Result<{ hrp: string; data: Uint8Array }> {
  if (typeof s !== "string" || s.length === 0) {
    return fail("INVALID_ADDRESS", "bech32 string must be a non-empty string");
  }
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  if (hasLower && hasUpper) {
    return fail("INVALID_ADDRESS", "bech32 string must not mix upper and lower case");
  }
  const lower = s.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    if (code < 33 || code > 126) {
      return fail("INVALID_ADDRESS", "bech32 string contains an out-of-range character");
    }
  }
  const sep = lower.lastIndexOf("1");
  if (sep < 1) {
    return fail("INVALID_ADDRESS", "bech32 string has no human-readable part");
  }
  if (lower.length - sep - 1 < CHECKSUM_LENGTH) {
    return fail("INVALID_ADDRESS", "bech32 data part is too short for a checksum");
  }
  const hrp = lower.slice(0, sep);
  const dataChars = lower.slice(sep + 1);
  const values: number[] = [];
  for (const ch of dataChars) {
    const idx = CHARSET.indexOf(ch);
    if (idx === -1) {
      return fail("INVALID_ADDRESS", `invalid bech32 data character "${ch}"`);
    }
    values.push(idx);
  }
  if (polymod([...hrpExpand(hrp), ...values]) !== 1) {
    return fail("INVALID_ADDRESS", "bech32 checksum mismatch");
  }
  const payload = convertBits(values.slice(0, -CHECKSUM_LENGTH), 5, 8, false);
  if (payload === null) {
    return fail("INVALID_ADDRESS", "bech32 payload has invalid padding");
  }
  return ok({ hrp, data: Uint8Array.from(payload) });
}

/**
 * Encode bytes as bech32 under `hrp`. Needed by tests (round-trip fixtures)
 * and by the memory KeyPort fake in step 3.
 */
export function encodeBech32(hrp: string, data: Uint8Array): Result<string> {
  if (typeof hrp !== "string" || hrp.length === 0) {
    return fail("INVALID_ADDRESS", "bech32 hrp must be a non-empty string");
  }
  if (hrp !== hrp.toLowerCase()) {
    return fail("INVALID_ADDRESS", "bech32 hrp must be lowercase");
  }
  for (let i = 0; i < hrp.length; i++) {
    const code = hrp.charCodeAt(i);
    if (code < 33 || code > 126) {
      return fail("INVALID_ADDRESS", "bech32 hrp contains an out-of-range character");
    }
  }
  const values = convertBits([...data], 8, 5, true);
  if (values === null) {
    return fail("INVALID_ADDRESS", "bech32 payload could not be encoded");
  }
  const checksumInput = [...hrpExpand(hrp), ...values, 0, 0, 0, 0, 0, 0];
  const mod = polymod(checksumInput) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    checksum.push((mod >> (5 * (5 - i))) & 31);
  }
  let out = `${hrp}1`;
  for (const v of [...values, ...checksum]) {
    out += CHARSET[v] ?? "";
  }
  return ok(out);
}

function kindOf(headerType: number): AddressKind | null {
  if (headerType === 0) {
    return "base";
  }
  if (headerType >= 1 && headerType <= 3) {
    // 1 script/key, 2 key/script, 3 script/script: anything with a script
    // credential in a base address.
    return "script-base";
  }
  if (headerType === 4 || headerType === 5) {
    return "pointer";
  }
  if (headerType === 6 || headerType === 7) {
    return "enterprise";
  }
  if (headerType === 14 || headerType === 15) {
    return "reward";
  }
  return null;
}

function expectedHrp(kind: AddressKind, netId: 0 | 1): string {
  if (kind === "reward") {
    return netId === 1 ? "stake" : "stake_test";
  }
  return netId === 1 ? "addr" : "addr_test";
}

function looksLikeByron(s: string): boolean {
  if (BYRON_PREFIX_RE.test(s)) {
    return true;
  }
  return s.length >= 40 && BASE58_RE.test(s) && !s.includes("1");
}

/** Parse any Shelley bech32 address (payment or reward). */
export function parseAddress(s: string): Result<AddressInfo> {
  if (typeof s !== "string" || s.trim() === "") {
    return fail("INVALID_ADDRESS", "address must be a non-empty string");
  }
  const raw = s.trim();
  if (looksLikeByron(raw)) {
    return fail("INVALID_ADDRESS", "Byron addresses are not supported in v1");
  }
  const decoded = decodeBech32(raw);
  if (!decoded.ok) {
    return decoded;
  }
  const { hrp, data } = decoded.value;
  if (data.length < 1) {
    return fail("INVALID_ADDRESS", "address payload is empty");
  }
  const header = data[0] ?? 0;
  const headerType = header >> 4;
  const low = header & 0x0f;

  if (headerType === 8) {
    return fail("INVALID_ADDRESS", "Byron addresses are not supported in v1");
  }
  const kind = kindOf(headerType);
  if (kind === null) {
    return fail("INVALID_ADDRESS", `unknown address header type ${headerType}`);
  }
  if (low !== 0 && low !== 1) {
    return fail("INVALID_ADDRESS", `unknown network id ${low} in address header`);
  }
  const netId: 0 | 1 = low === 1 ? 1 : 0;

  const want = expectedHrp(kind, netId);
  if (hrp !== want) {
    return fail(
      "INVALID_ADDRESS",
      `address prefix "${hrp}" does not match header (expected "${want}")`,
      { hrp, expected: want, headerType, networkId: netId },
    );
  }

  const lengthCheck = checkPayloadLength(kind, headerType, data.length);
  if (!lengthCheck.ok) {
    return lengthCheck;
  }

  const info: AddressInfo = {
    bech32: raw.toLowerCase(),
    networkId: netId,
    headerType,
    kind,
  };
  if (headerType <= 7) {
    info.paymentCredentialHex = bytesToHex(data.slice(1, 1 + CREDENTIAL_BYTES));
    if (headerType <= 3) {
      info.stakeCredentialHex = bytesToHex(
        data.slice(1 + CREDENTIAL_BYTES, 1 + 2 * CREDENTIAL_BYTES),
      );
    }
  } else {
    info.stakeCredentialHex = bytesToHex(data.slice(1, 1 + CREDENTIAL_BYTES));
  }
  return ok(info);
}

function checkPayloadLength(
  kind: AddressKind,
  headerType: number,
  length: number,
): Result<true> {
  const base = 1 + CREDENTIAL_BYTES; // 29
  const both = 1 + 2 * CREDENTIAL_BYTES; // 57
  if (kind === "base" || kind === "script-base") {
    return length === both
      ? ok(true)
      : fail(
          "INVALID_ADDRESS",
          `base address (type ${headerType}) must be ${both} bytes, got ${length}`,
        );
  }
  if (kind === "pointer") {
    // header + payment credential + three variable-length naturals.
    return length > base
      ? ok(true)
      : fail(
          "INVALID_ADDRESS",
          `pointer address (type ${headerType}) must be more than ${base} bytes, got ${length}`,
        );
  }
  return length === base
    ? ok(true)
    : fail(
        "INVALID_ADDRESS",
        `address type ${headerType} must be ${base} bytes, got ${length}`,
      );
}

/**
 * Parse and additionally require: a payment address (not a stake/reward
 * address) on exactly `network`.
 */
export function validateAddress(s: string, network: Network): Result<AddressInfo> {
  const parsed = parseAddress(s);
  if (!parsed.ok) {
    return parsed;
  }
  const info = parsed.value;
  if (info.kind === "reward") {
    return fail(
      "INVALID_ADDRESS",
      "a reward (stake…) address is not a payment address",
      { kind: info.kind },
    );
  }
  const want = networkIdOf(network);
  if (info.networkId !== want) {
    return fail(
      "WRONG_NETWORK",
      `address is for network id ${info.networkId}, but this service is on ${network} (network id ${want})`,
      { addressNetworkId: info.networkId, expectedNetworkId: want, network },
    );
  }
  return ok(info);
}

function encodeCredentialAddress(
  header: number,
  hrp: string,
  credentials: readonly string[],
): Result<string> {
  const bytes: number[] = [header];
  for (const hex of credentials) {
    if (!isHex(hex) || hex.length !== CREDENTIAL_BYTES * 2) {
      return fail(
        "INVALID_ADDRESS",
        `credential must be ${CREDENTIAL_BYTES * 2} hex characters, got "${hex}"`,
      );
    }
    bytes.push(...hexToBytes(hex.toLowerCase()));
  }
  return encodeBech32(hrp, Uint8Array.from(bytes));
}

/** Header type 6: payment-key-only address, no staking part. */
export function encodeEnterpriseAddress(
  netId: 0 | 1,
  paymentCredentialHex: string,
): Result<string> {
  return encodeCredentialAddress(0x60 | netId, netId === 1 ? "addr" : "addr_test", [
    paymentCredentialHex,
  ]);
}

/** Header type 0: payment key + stake key. */
export function encodeBaseAddress(
  netId: 0 | 1,
  paymentCredentialHex: string,
  stakeCredentialHex: string,
): Result<string> {
  return encodeCredentialAddress(0x00 | netId, netId === 1 ? "addr" : "addr_test", [
    paymentCredentialHex,
    stakeCredentialHex,
  ]);
}

/** Header type 14: stake (reward) address. */
export function encodeRewardAddress(
  netId: 0 | 1,
  stakeCredentialHex: string,
): Result<string> {
  return encodeCredentialAddress(0xe0 | netId, netId === 1 ? "stake" : "stake_test", [
    stakeCredentialHex,
  ]);
}

/** First 12 + last 6 characters, for logs. Never truncates below full length. */
export function truncateAddress(addr: string): string {
  if (typeof addr !== "string" || addr.length <= 18) {
    return addr;
  }
  return `${addr.slice(0, 12)}…${addr.slice(-6)}`;
}
