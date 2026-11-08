// LucidKeys: the real `KeyPort` — BIP-39 seed phrases and CIP-1852
// derivation, via `@lucid-evolution/lucid`.
//
// This is the only adapter in cardafin that holds signing material, and the
// rule it follows is simple: **a mnemonic never leaves this file in any
// form, including inside an error message**. Lucid's own errors on a bad
// phrase can quote the input, so every call that takes a mnemonic catches and
// replaces the error rather than wrapping it. See docs/ARCHITECTURE.md §6.
//
// Derivation is `walletFromSeed(mnemonic, { accountIndex, network,
// addressType: "Base" })`, i.e. CIP-1852 m/1852'/1815'/accountIndex'/0/0 with
// a staking part. `accountIndex` is cardafin's per-client boundary: one master
// mnemonic, one account per client, so a leaked account is one client's blast
// radius rather than everyone's.

import {
  generateSeedPhrase,
  mintingPolicyToId,
  paymentCredentialOf,
  scriptFromNative,
  walletFromSeed,
} from "@lucid-evolution/lucid";

import { CardafinError } from "../../core/errors.ts";
import type { NativeScript } from "../../core/native-script.ts";
import type { Network } from "../../core/network.ts";
import type { KeyPort, WalletInfo } from "../../ports/keys.ts";

/** BIP-39 phrase lengths. 24 words is what `generateMnemonic` produces. */
export const MNEMONIC_WORD_COUNTS: readonly number[] = [12, 15, 18, 21, 24];

/** CIP-1852 payment addresses; "Base" carries the staking part too. */
const ADDRESS_TYPE = "Base";

function wordCount(m: string): number {
  return m.trim().split(/\s+/).filter((w) => w !== "").length;
}

export class LucidKeys implements KeyPort {
  /** A fresh 24-word BIP-39 phrase from lucid's CSPRNG-backed generator. */
  generateMnemonic(): string {
    return generateSeedPhrase();
  }

  /**
   * True when the phrase is a valid BIP-39 mnemonic — wordlist membership and
   * checksum included, which is the part a word count cannot tell you. The
   * cheap length check runs first so an obviously wrong input does not pay
   * for a key derivation.
   */
  validateMnemonic(m: string): boolean {
    if (typeof m !== "string" || !MNEMONIC_WORD_COUNTS.includes(wordCount(m))) {
      return false;
    }
    try {
      // Any network derives the same key material; "Preview" is arbitrary and
      // the result is discarded. This is a checksum test, not a derivation.
      walletFromSeed(m.trim(), { network: "Preview", addressType: ADDRESS_TYPE });
      return true;
    } catch {
      return false;
    }
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

    let address: string;
    try {
      address = walletFromSeed(mnemonic.trim(), {
        accountIndex,
        network,
        addressType: ADDRESS_TYPE,
      }).address;
    } catch {
      // The original error is deliberately dropped, not wrapped: lucid's
      // message for an invalid phrase can echo the words back.
      throw new CardafinError(
        "INVALID_REQUEST",
        `could not derive account ${accountIndex} on ${network}: the mnemonic is not a valid BIP-39 phrase`,
        { accountIndex, network },
      );
    }

    // `paymentCredentialOf` returns { type: "Key" | "Script", hash }; a seed
    // derived address is always a key credential.
    const credential = paymentCredentialOf(address);
    if (credential.type !== "Key") {
      throw new CardafinError(
        "PROVIDER_ERROR",
        `derived a ${credential.type} address, which cannot sign`,
        { accountIndex, network },
      );
    }

    return {
      address,
      paymentKeyHash: credential.hash,
      accountIndex,
      network,
    };
  }

  /**
   * The real policy id: blake2b-224 of the native script's CBOR. cardafin's
   * `NativeScript` is structurally identical to lucid's `Native` (its arrays
   * satisfy lucid's `ReadonlyArray`), so the script goes straight through.
   */
  nativeScriptPolicyId(script: NativeScript): string {
    try {
      return mintingPolicyToId(scriptFromNative(script));
    } catch (e) {
      throw new CardafinError(
        "PROVIDER_ERROR",
        `could not hash the native script: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
