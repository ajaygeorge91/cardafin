// Fee and min-ADA *estimates*. The lucid adapter computes exact values when
// it builds a transaction; these exist so core can reject an obviously
// underfunded plan without a network round trip. Every number here is a
// documented heuristic, deliberately rounded up rather than down.
// See docs/ARCHITECTURE.md §3 (`core/fees.ts`).

import type { Lovelace } from "./ada.ts";
import type { Assets } from "./assets.ts";
import { LOVELACE, POLICY_ID_HEX_LENGTH } from "./assets.ts";
import type { AddressInfo, AddressKind } from "./address.ts";

export type ProtocolParams = {
  minFeeA: number;
  minFeeB: number;
  coinsPerUtxoByte: number;
  maxTxSize: number;
  maxValSize: number;
};

/** Conway-era mainnet defaults, per docs/ARCHITECTURE.md §3. */
export const CONWAY_DEFAULT_PARAMS: ProtocolParams = {
  minFeeA: 44,
  minFeeB: 155381,
  coinsPerUtxoByte: 4310,
  maxTxSize: 16384,
  maxValSize: 5000,
};

/** Constant the ledger adds to every output's serialised size. */
export const MIN_UTXO_OVERHEAD_BYTES = 160;

const OUTPUT_CBOR_OVERHEAD_BYTES = 7;
const ADDRESS_BYTES_BASE = 57;
const ADDRESS_BYTES_ENTERPRISE = 29;
const ADDRESS_BYTES_POINTER = 32;
const COIN_BYTES = 9;
const MULTIASSET_MAP_BYTES = 2;
const POLICY_ID_BYTES = 28;
const ASSET_MAP_BYTES = 2;
const ASSET_QUANTITY_BYTES = 8;

export function addressBytes(address: AddressInfo | AddressKind): number {
  const kind: AddressKind = typeof address === "string" ? address : address.kind;
  switch (kind) {
    case "base":
    case "script-base":
      return ADDRESS_BYTES_BASE;
    case "pointer":
      return ADDRESS_BYTES_POINTER;
    case "enterprise":
    case "reward":
      return ADDRESS_BYTES_ENTERPRISE;
  }
}

/**
 * Serialised size of the value part of an output: 9 bytes for the coin, plus,
 * when native assets are present, a 2-byte map header, 28 + 2 bytes per
 * policy and (nameBytes + 1 + 8) per asset under it.
 */
export function estimateValueBytes(assets: Assets): number {
  const byPolicy = new Map<string, number[]>();
  for (const unit of Object.keys(assets)) {
    if (unit === LOVELACE) {
      continue;
    }
    const policyId = unit.slice(0, POLICY_ID_HEX_LENGTH);
    const nameBytes = Math.ceil(Math.max(0, unit.length - POLICY_ID_HEX_LENGTH) / 2);
    const names = byPolicy.get(policyId);
    if (names) {
      names.push(nameBytes);
    } else {
      byPolicy.set(policyId, [nameBytes]);
    }
  }
  if (byPolicy.size === 0) {
    return COIN_BYTES;
  }
  let total = COIN_BYTES + MULTIASSET_MAP_BYTES;
  for (const names of byPolicy.values()) {
    total += POLICY_ID_BYTES + ASSET_MAP_BYTES;
    for (const nameBytes of names) {
      total += nameBytes + 1 + ASSET_QUANTITY_BYTES;
    }
  }
  return total;
}

export function estimateOutputBytes(
  address: AddressInfo | AddressKind,
  assets: Assets,
): number {
  return OUTPUT_CBOR_OVERHEAD_BYTES + addressBytes(address) + estimateValueBytes(assets);
}

/**
 * The ledger's min-ADA rule: coinsPerUtxoByte × (160 + output size). Assumes
 * a base address, the largest of the common payment address shapes, so the
 * estimate is never too low for an enterprise address.
 */
export function estimateMinAda(
  assets: Assets,
  params: ProtocolParams = CONWAY_DEFAULT_PARAMS,
): Lovelace {
  const bytes = estimateOutputBytes("base", assets);
  return BigInt(params.coinsPerUtxoByte) * BigInt(MIN_UTXO_OVERHEAD_BYTES + bytes);
}

/** Same rule, but for a known address shape. */
export function estimateMinAdaForAddress(
  address: AddressInfo | AddressKind,
  assets: Assets,
  params: ProtocolParams = CONWAY_DEFAULT_PARAMS,
): Lovelace {
  const bytes = estimateOutputBytes(address, assets);
  return BigInt(params.coinsPerUtxoByte) * BigInt(MIN_UTXO_OVERHEAD_BYTES + bytes);
}

/** minFeeA × size + minFeeB. Exact for a given size; the size is the estimate. */
export function estimateFee(
  txSizeBytes: number,
  params: ProtocolParams = CONWAY_DEFAULT_PARAMS,
): Lovelace {
  const size = Number.isSafeInteger(txSizeBytes) && txSizeBytes > 0 ? txSizeBytes : 0;
  return BigInt(params.minFeeA) * BigInt(size) + BigInt(params.minFeeB);
}

/**
 * Heuristic transaction size: 100 bytes of body/witness overhead, 70 per
 * input, 65 per output, 150 for a minting policy + witness, plus the
 * serialised metadata. Rounded generously; the adapter replaces it with the
 * real CBOR length at build time.
 */
export function estimateSimpleTxBytes(
  nOutputs: number,
  nInputs: number = 1,
  hasMint: boolean = false,
  metadataBytes: number = 0,
): number {
  const outputs = Math.max(0, Math.trunc(nOutputs));
  const inputs = Math.max(0, Math.trunc(nInputs));
  const meta = Math.max(0, Math.trunc(metadataBytes));
  return 100 + 70 * inputs + 65 * outputs + (hasMint ? 150 : 0) + meta;
}
