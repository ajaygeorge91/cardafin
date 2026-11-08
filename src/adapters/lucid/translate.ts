// TxPlan → transaction builder, as a pure function.
//
// This module has ZERO imports from @lucid-evolution/lucid or
// @blockfrost/blockfrost-js on purpose. The one interesting thing the lucid
// executor does — decide which builder calls a plan implies, in what order,
// with what arguments — is the part most likely to be wrong, and the part
// that is impossible to test if it only exists inside a function that also
// needs a Blockfrost key and a network. So it lives here, against the
// structural `MinimalTxBuilder` subset below, and `translate.test.ts` drives
// it with a recording fake. The real `TxBuilder` satisfies `MinimalTxBuilder`
// structurally; `executor.ts` passes `lucid.newTx()` straight in and the
// compiler checks the fit.
//
// See docs/ARCHITECTURE.md §4 (`adapters/lucid`).

import { CardafinError } from "../../core/errors.ts";
import type { Metadatum } from "../../core/metadata.ts";
import type { NativeScript } from "../../core/native-script.ts";
import type { TxPlan } from "../../core/plan.ts";

/**
 * The subset of lucid's `TxBuilder` that a cardafin plan can reach.
 *
 * Declared with *method* syntax rather than arrow-property syntax, which
 * matters: TypeScript checks method parameters bivariantly, so the real
 * `attachMetadata(label: Label, metadata: TransactionMetadata)` is assignable
 * to our `attachMetadata(label: number, metadata: unknown)`. With property
 * syntax `strictFunctionTypes` would reject it, because `unknown` is not
 * assignable to `TransactionMetadata`. The looser parameter types are what
 * keep lucid's types out of this file.
 */
export type MinimalTxBuilder = {
  pay: {
    ToAddress(address: string, assets: Record<string, bigint>): MinimalTxBuilder;
  };
  mintAssets(assets: Record<string, bigint>): MinimalTxBuilder;
  attach: {
    MintingPolicy(script: unknown): MinimalTxBuilder;
  };
  validTo(unixTimeMs: number): MinimalTxBuilder;
  attachMetadata(label: number, metadata: unknown): MinimalTxBuilder;
};

/**
 * The two things translation needs from the outside world: the slot→time
 * mapping (lucid's `validTo` takes POSIX milliseconds, a plan carries a slot)
 * and the native-script serialiser (`scriptFromNative`, which hashes to a
 * policy id and therefore cannot be reimplemented here).
 */
export type ApplyPlanDeps = {
  slotToUnixTime(slot: number): number;
  scriptFromNative(script: NativeScript): unknown;
};

/**
 * Lucid's `TransactionMetadata`, restated locally. The notable absence is
 * `bigint`: the on-chain metadatum type has arbitrary-precision integers but
 * lucid's TypeScript surface takes `number`, so every bigint has to be
 * narrowed before it can be attached. (`Uint8Array` is also a valid
 * `TransactionMetadata` member, but core's `Metadatum` has no byte-string
 * case, so nothing here can produce one.)
 */
export type LucidMetadatum =
  | string
  | number
  | LucidMetadatum[]
  | { [k: string]: LucidMetadatum };

/**
 * Core `Metadatum` → lucid `TransactionMetadata`.
 *
 * Integers are the whole difficulty. Core models a metadatum integer as a
 * `bigint` because the ledger's is unbounded; lucid wants a `number`. Rather
 * than silently losing precision past 2^53 — which would write the *wrong*
 * number on chain, permanently — anything outside the safe-integer range is
 * refused with INVALID_METADATA. Callers who need a larger value should pass
 * it as a string, which is what CIP-25 and CIP-20 do anyway.
 */
export function metadatumToLucid(m: Metadatum): LucidMetadatum {
  return convert(m, "$");
}

function convert(m: Metadatum, path: string): LucidMetadatum {
  if (typeof m === "string") {
    return m;
  }
  if (typeof m === "bigint") {
    if (m < BigInt(Number.MIN_SAFE_INTEGER) || m > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CardafinError(
        "INVALID_METADATA",
        `${path}: ${m} is outside the safe integer range lucid can represent; pass it as a string`,
        { value: m.toString(), path },
      );
    }
    return Number(m);
  }
  if (Array.isArray(m)) {
    return m.map((item, i) => convert(item, `${path}[${i}]`));
  }
  const out: { [k: string]: LucidMetadatum } = {};
  for (const [key, value] of Object.entries(m)) {
    out[key] = convert(value, `${path}.${key}`);
  }
  return out;
}

/**
 * Apply a plan to a builder, in a fixed order: outputs, then the mint and its
 * policy script, then the validity bound, then metadata. The order is part of
 * the contract — `translate.test.ts` asserts it — because a mint without its
 * attached policy, or a time-locked mint without a `validTo`, is a
 * transaction the node rejects.
 *
 * Deliberately *not* here: coin selection, change, fees and the min-ADA
 * recheck. Lucid's `.complete()` does all four against real UTxOs.
 */
export function applyPlan(
  builder: MinimalTxBuilder,
  plan: TxPlan,
  deps: ApplyPlanDeps,
): MinimalTxBuilder {
  let b = builder;

  for (const output of plan.outputs) {
    b = b.pay.ToAddress(output.address, { ...output.assets });
  }

  if (plan.mint) {
    b = b.mintAssets({ ...plan.mint.assets });
    // The script must be attached as a witness or the node cannot check the
    // mint. Attached after `mintAssets` only for readability; lucid
    // accumulates both and orders the CBOR itself.
    b = b.attach.MintingPolicy(deps.scriptFromNative(plan.mint.script));
  }

  if (plan.validToSlot !== undefined) {
    b = b.validTo(deps.slotToUnixTime(plan.validToSlot));
  }

  for (const entry of plan.metadata ?? []) {
    b = b.attachMetadata(entry.label, metadatumToLucid(entry.value));
  }

  return b;
}
