// MemoryKeys: a deterministic, dependency-free KeyPort for tests.
//
// ==========================================================================
// FAKE DERIVATION. NOT CIP-1852. NOT BIP-39. NOT BIP-32.
//
// `deriveWallet` hashes the mnemonic string with sha256 and calls the first
// 28 bytes a "payment key hash". That makes the resulting bech32 address
// *structurally* valid — core's `validateAddress` accepts it, the network id
// is right, the checksum is right — while being completely unrelated to the
// key any real wallet would derive from the same words. Funds sent to an
// address from this adapter are unrecoverable because no private key exists
// for it. This module is for tests only; the real derivation lives in
// `adapters/lucid/keys.ts` (step 4).
//
// `generateMnemonic` draws from the small word list below, which is NOT the
// BIP-39 English list. A phrase it produces is not a valid BIP-39 mnemonic
// and no real wallet will restore from it.
// ==========================================================================

import { randomInt } from "node:crypto";

import { encodeEnterpriseAddress } from "../../core/address.ts";
import { CardafinError } from "../../core/errors.ts";
import { canonicalJson, sha256Hex } from "../../core/metadata.ts";
import type { Json } from "../../core/metadata.ts";
import type { NativeScript } from "../../core/native-script.ts";
import type { Network } from "../../core/network.ts";
import { networkId } from "../../core/network.ts";
import { unwrap } from "../../core/result.ts";
import type { KeyPort, WalletInfo } from "../../ports/keys.ts";

/** Mnemonics are always this long, matching the real adapter's output. */
export const MNEMONIC_WORDS = 24;

/** 28 bytes, hex-encoded: the width of a Cardano credential hash. */
const KEY_HASH_HEX_LENGTH = 56;

/** A policy id is blake2b-224 in reality: 28 bytes, 56 hex characters. */
const POLICY_ID_HEX_LENGTH = 56;

/**
 * 64 plain English words. Not BIP-39, fake adapter — see the header. Kept
 * short deliberately: a phrase from this list has ~6 bits of entropy per
 * word, so it is obviously not a real seed phrase.
 */
export const FAKE_WORDLIST: readonly string[] = [
  "amber", "anchor", "apron", "atlas", "basin", "beacon", "bellow", "birch",
  "bison", "bramble", "bridge", "bucket", "canyon", "cedar", "cinder", "cobble",
  "copper", "crater", "dapple", "dowel", "ember", "fathom", "fennel", "ferry",
  "flint", "fossil", "gable", "gasket", "girder", "granite", "gravel", "harbor",
  "hollow", "ingot", "jetty", "kettle", "lantern", "ledger", "lichen", "marble",
  "meadow", "mortar", "nickel", "nutmeg", "obsidian", "orchard", "pebble", "pewter",
  "pillar", "quarry", "quartz", "rafter", "ravine", "ripple", "saddle", "sawmill",
  "shingle", "slate", "sorrel", "thicket", "timber", "trellis", "walnut", "willow",
];

const LOWERCASE_WORD_RE = /^[a-z]+$/;

/** NativeScript → Json, so core's `canonicalJson` can fingerprint it. */
export function nativeScriptToJson(script: NativeScript): Json {
  switch (script.type) {
    case "sig":
      return { type: "sig", keyHash: script.keyHash };
    case "before":
    case "after":
      return { type: script.type, slot: script.slot };
    case "all":
    case "any":
      return { type: script.type, scripts: script.scripts.map(nativeScriptToJson) };
    case "atLeast":
      return {
        type: "atLeast",
        required: script.required,
        scripts: script.scripts.map(nativeScriptToJson),
      };
  }
}

/**
 * The fake policy id: sha256 of the script's canonical JSON, truncated to 28
 * bytes. Pure and exported so tests (and `MemoryLedger`) can compute the id
 * a script *should* have without constructing a `MemoryKeys`.
 *
 * Real policy ids are blake2b-224 of the script's CBOR. These are neither,
 * but they are 56 lowercase hex characters, which is all core checks.
 */
export function policyIdOf(script: NativeScript): string {
  return sha256Hex(unwrap(canonicalJson(nativeScriptToJson(script)))).slice(
    0,
    POLICY_ID_HEX_LENGTH,
  );
}

/** The fake payment key hash for a (mnemonic, accountIndex) pair. */
export function paymentKeyHashOf(mnemonic: string, accountIndex: number): string {
  return sha256Hex(`${mnemonic}|${accountIndex}`).slice(0, KEY_HASH_HEX_LENGTH);
}

export class MemoryKeys implements KeyPort {
  /** Same pure helper as the module-level export, for call-site convenience. */
  static policyIdOf(script: NativeScript): string {
    return policyIdOf(script);
  }

  static paymentKeyHashOf(mnemonic: string, accountIndex: number): string {
    return paymentKeyHashOf(mnemonic, accountIndex);
  }

  /**
   * 24 words drawn with `node:crypto`'s `randomInt` (uniform, rejection
   * sampled) from `FAKE_WORDLIST`. Not BIP-39, fake adapter.
   */
  generateMnemonic(): string {
    const words: string[] = [];
    for (let i = 0; i < MNEMONIC_WORDS; i++) {
      const word = FAKE_WORDLIST[randomInt(FAKE_WORDLIST.length)];
      // `noUncheckedIndexedAccess`: randomInt is in range, so this cannot be
      // undefined, but the type system does not know that.
      words.push(word ?? "amber");
    }
    return words.join(" ");
  }

  /**
   * Exactly 24 whitespace-separated lowercase words. Deliberately weaker
   * than BIP-39: there is no wordlist membership check and no checksum, so
   * the public `abandon … art` test vector validates here too.
   */
  validateMnemonic(m: string): boolean {
    if (typeof m !== "string") {
      return false;
    }
    const words = m.trim().split(/\s+/);
    if (words.length !== MNEMONIC_WORDS) {
      return false;
    }
    return words.every((w) => LOWERCASE_WORD_RE.test(w));
  }

  async deriveWallet(
    mnemonic: string,
    accountIndex: number,
    network: Network,
  ): Promise<WalletInfo> {
    if (typeof mnemonic !== "string" || mnemonic.trim() === "") {
      throw new CardafinError("INVALID_REQUEST", "mnemonic must be a non-empty string");
    }
    if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
      throw new CardafinError(
        "INVALID_REQUEST",
        "accountIndex must be a non-negative whole number",
      );
    }
    const paymentKeyHash = paymentKeyHashOf(mnemonic, accountIndex);
    const address = encodeEnterpriseAddress(networkId(network), paymentKeyHash);
    if (!address.ok) {
      throw address.error;
    }
    return { address: address.value, paymentKeyHash, accountIndex, network };
  }

  nativeScriptPolicyId(script: NativeScript): string {
    return policyIdOf(script);
  }
}
