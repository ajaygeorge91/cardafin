// Blockfrost JSON → core types. Like `translate.ts`, this file imports
// nothing from npm: the Blockfrost response shapes are restated here as local
// structural types so the conversions can be tested with plain objects.
//
// The whole reason this module exists is Blockfrost's habit of sending
// numbers as decimal *strings* (`quantity`, `coins_per_utxo_size`,
// `max_val_size`) and of sending `null` for parameters an era has not set.
// Both are easy to get wrong silently — `Number("")` is 0, `parseInt(null)`
// is NaN — and both decide how much ADA an output needs, so they get a mapper
// with tests rather than an inline cast.
//
// See docs/ARCHITECTURE.md §4 and the Gotchas in the verified API notes.

import { CardafinError } from "../../core/errors.ts";
import type { Assets } from "../../core/assets.ts";
import type { ProtocolParams } from "../../core/fees.ts";
import { CONWAY_DEFAULT_PARAMS } from "../../core/fees.ts";
import type { Utxo } from "../../core/types.ts";

/** One entry of a Blockfrost `amount` array. `quantity` is a decimal string. */
export type BlockfrostAmount = {
  unit: string;
  quantity: string;
};

/** A row of `/addresses/{address}/utxos`, narrowed to the fields we read. */
export type BlockfrostUtxo = {
  tx_hash: string;
  output_index: number;
  address: string;
  amount: Array<BlockfrostAmount>;
};

/** `/epochs/latest/parameters`, narrowed to the fields core's fees need. */
export type BlockfrostParams = {
  min_fee_a: number;
  min_fee_b: number;
  max_tx_size: number;
  max_val_size: string | null;
  coins_per_utxo_size: string | null;
};

const DECIMAL_RE = /^-?\d+$/;

function quantityToBigInt(unit: string, quantity: unknown): bigint {
  if (typeof quantity !== "string" || !DECIMAL_RE.test(quantity)) {
    throw new CardafinError(
      "PROVIDER_ERROR",
      `Blockfrost returned a non-numeric quantity ${JSON.stringify(quantity)} for unit "${unit}"`,
      { unit },
    );
  }
  return BigInt(quantity);
}

/**
 * Blockfrost UTxO → core `Utxo`. Units arrive in exactly the form core uses:
 * the literal "lovelace" for ADA, and policyId + asset-name-hex concatenated
 * for everything else, so only the quantities need converting. Repeated units
 * in one `amount` array are summed rather than overwritten; the API does not
 * normally do that, but a lost quantity would be a silently wrong balance.
 */
export function blockfrostUtxoToCore(u: BlockfrostUtxo): Utxo {
  const assets: Assets = {};
  for (const entry of u.amount ?? []) {
    const quantity = quantityToBigInt(entry.unit, entry.quantity);
    assets[entry.unit] = (assets[entry.unit] ?? 0n) + quantity;
  }
  // An output always holds some ADA, but a UTxO with no lovelace entry would
  // otherwise read as "no lovelace key" rather than zero, which `lovelaceOf`
  // treats the same way. Left absent on purpose: core never assumes the key.
  return {
    txHash: u.tx_hash,
    outputIndex: u.output_index,
    address: u.address,
    assets,
  };
}

function requireInteger(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CardafinError(
      "PROVIDER_ERROR",
      `Blockfrost returned a non-numeric ${name}: ${JSON.stringify(value)}`,
      { field: name },
    );
  }
  return Math.trunc(value);
}

/**
 * A Blockfrost decimal-string parameter → number, or the Conway default when
 * the API sends `null`.
 *
 * The fallback is deliberate rather than an error: `max_val_size` and
 * `coins_per_utxo_size` are nullable in the Blockfrost schema (they did not
 * exist in every era), and a missing value must not make cardafin's min-ADA
 * estimate collapse to zero — that would let it plan outputs the node
 * rejects. `CONWAY_DEFAULT_PARAMS` is the current mainnet value, so the
 * estimate stays conservative.
 */
function stringParamOrDefault(
  name: string,
  value: string | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined || value.trim() === "") {
    return fallback;
  }
  if (!DECIMAL_RE.test(value.trim())) {
    throw new CardafinError(
      "PROVIDER_ERROR",
      `Blockfrost returned a non-numeric ${name}: ${JSON.stringify(value)}`,
      { field: name },
    );
  }
  return Number(value.trim());
}

export function blockfrostParamsToCore(p: BlockfrostParams): ProtocolParams {
  return {
    minFeeA: requireInteger("min_fee_a", p.min_fee_a),
    minFeeB: requireInteger("min_fee_b", p.min_fee_b),
    maxTxSize: requireInteger("max_tx_size", p.max_tx_size),
    coinsPerUtxoByte: stringParamOrDefault(
      "coins_per_utxo_size",
      p.coins_per_utxo_size,
      CONWAY_DEFAULT_PARAMS.coinsPerUtxoByte,
    ),
    maxValSize: stringParamOrDefault(
      "max_val_size",
      p.max_val_size,
      CONWAY_DEFAULT_PARAMS.maxValSize,
    ),
  };
}

/**
 * True for Blockfrost's "not found". `BlockfrostServerError` carries a
 * **numeric** `status_code`; there is no `.status`, and string-matching
 * `.message` breaks whenever the wording changes. Checked structurally so
 * this module stays free of a blockfrost-js import.
 *
 * A 404 is not an error for every caller: an address that has never received
 * funds 404s on `/addresses/{a}/utxos`, which means "empty", not "broken".
 */
export function isBlockfrost404(e: unknown): boolean {
  if (e === null || typeof e !== "object") {
    return false;
  }
  const status = (e as { status_code?: unknown }).status_code;
  return typeof status === "number" && status === 404;
}

/** Convenience for a whole `addressesUtxosAll` page. */
export function blockfrostUtxosToCore(utxos: readonly BlockfrostUtxo[]): Utxo[] {
  return utxos.map(blockfrostUtxoToCore);
}
