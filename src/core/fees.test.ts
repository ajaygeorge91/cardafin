import test from "node:test";
import assert from "node:assert/strict";

import {
  CONWAY_DEFAULT_PARAMS,
  MIN_UTXO_OVERHEAD_BYTES,
  addressBytes,
  estimateFee,
  estimateMinAda,
  estimateMinAdaForAddress,
  estimateOutputBytes,
  estimateSimpleTxBytes,
  estimateValueBytes,
} from "./fees.ts";
import type { ProtocolParams } from "./fees.ts";
import { LOVELACE, assetNameToHex, toUnit } from "./assets.ts";
import type { Assets } from "./assets.ts";
import { parseAddress } from "./address.ts";
import { lovelaceToAda } from "./ada.ts";

const POLICY_A = "a".repeat(56);
const POLICY_B = "b".repeat(56);

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

const UNIT_TOKEN = must(toUnit(POLICY_A, must(assetNameToHex("TOKEN")))); // 5-byte name

test("CONWAY_DEFAULT_PARAMS are the documented mainnet values", () => {
  assert.deepEqual(CONWAY_DEFAULT_PARAMS, {
    minFeeA: 44,
    minFeeB: 155381,
    coinsPerUtxoByte: 4310,
    maxTxSize: 16384,
    maxValSize: 5000,
  });
  assert.equal(MIN_UTXO_OVERHEAD_BYTES, 160);
});

test("addressBytes: base 57, enterprise/reward 29, pointer 32", () => {
  assert.equal(addressBytes("base"), 57);
  assert.equal(addressBytes("script-base"), 57);
  assert.equal(addressBytes("enterprise"), 29);
  assert.equal(addressBytes("reward"), 29);
  assert.equal(addressBytes("pointer"), 32);
});

test("addressBytes accepts an AddressInfo", () => {
  const info = must(
    parseAddress(
      "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x",
    ),
  );
  assert.equal(addressBytes(info), 57);
});

test("estimateValueBytes: 9 for ADA only", () => {
  assert.equal(estimateValueBytes({}), 9);
  assert.equal(estimateValueBytes({ [LOVELACE]: 1_000_000n }), 9);
});

test("estimateValueBytes: 9 + 2 + per-policy 28 + 2 + per-asset (name + 1 + 8)", () => {
  // One policy, one 5-byte name: 9 + 2 + (28 + 2 + (5 + 1 + 8)) = 55.
  assert.equal(estimateValueBytes({ [LOVELACE]: 1n, [UNIT_TOKEN]: 1n }), 55);
  // Nameless asset under the same policy: 9 + 2 + (28 + 2 + (0 + 1 + 8)) = 50.
  assert.equal(estimateValueBytes({ [POLICY_A]: 1n }), 50);
  // Two assets, one policy: the policy id is paid for once.
  assert.equal(estimateValueBytes({ [POLICY_A]: 1n, [UNIT_TOKEN]: 1n }), 9 + 2 + 28 + 2 + 9 + 14);
  // Two policies: two policy ids.
  assert.equal(
    estimateValueBytes({ [POLICY_A]: 1n, [POLICY_B]: 1n }),
    9 + 2 + (28 + 2 + 9) + (28 + 2 + 9),
  );
});

test("estimateOutputBytes: 7 CBOR overhead + address + value", () => {
  assert.equal(estimateOutputBytes("base", { [LOVELACE]: 1n }), 7 + 57 + 9);
  assert.equal(estimateOutputBytes("enterprise", { [LOVELACE]: 1n }), 7 + 29 + 9);
  assert.equal(estimateOutputBytes("base", { [LOVELACE]: 1n, [UNIT_TOKEN]: 1n }), 7 + 57 + 55);
});

test("estimateMinAda: coinsPerUtxoByte x (160 + outputBytes)", () => {
  const bytes = estimateOutputBytes("base", { [LOVELACE]: 1n });
  assert.equal(estimateMinAda({ [LOVELACE]: 1n }), 4310n * BigInt(160 + bytes));
});

test("an ADA-only base-address output needs between 0.95 and 1.1 ADA", () => {
  const min = estimateMinAda({ [LOVELACE]: 0n });
  assert.ok(min > 950_000n, `${lovelaceToAda(min)} ADA is too low`);
  assert.ok(min < 1_100_000n, `${lovelaceToAda(min)} ADA is too high`);
  // Pinned exactly so a change to the heuristic is visible in review.
  assert.equal(min, 1_004_230n);
});

test("a one-token output needs between 1.1 and 1.6 ADA", () => {
  const assets: Assets = { [LOVELACE]: 0n, [UNIT_TOKEN]: 1n };
  const min = estimateMinAda(assets);
  assert.ok(min > 1_100_000n, `${lovelaceToAda(min)} ADA is too low`);
  assert.ok(min < 1_600_000n, `${lovelaceToAda(min)} ADA is too high`);
  assert.equal(min, 1_202_490n);
});

test("more assets always cost more min-ADA", () => {
  const one = estimateMinAda({ [UNIT_TOKEN]: 1n });
  const two = estimateMinAda({ [UNIT_TOKEN]: 1n, [POLICY_B]: 1n });
  assert.ok(two > one);
  assert.ok(one > estimateMinAda({}));
});

test("estimateMinAda ignores quantities: only the shape matters", () => {
  assert.equal(estimateMinAda({ [UNIT_TOKEN]: 1n }), estimateMinAda({ [UNIT_TOKEN]: 10n ** 12n }));
});

test("estimateMinAdaForAddress is cheaper for an enterprise address", () => {
  const assets: Assets = { [LOVELACE]: 0n };
  assert.ok(
    estimateMinAdaForAddress("enterprise", assets) < estimateMinAdaForAddress("base", assets),
  );
  // estimateMinAda assumes a base address, the larger of the two.
  assert.equal(estimateMinAdaForAddress("base", assets), estimateMinAda(assets));
});

test("estimateFee is minFeeA x size + minFeeB", () => {
  assert.equal(estimateFee(300), 168_581n);
  assert.equal(estimateFee(300), BigInt(44 * 300 + 155381));
  assert.equal(estimateFee(0), 155_381n);
  assert.equal(estimateFee(-5), 155_381n);
  assert.equal(estimateFee(1.9), 155_381n);
});

test("a simple transaction fee lands around 0.17 ADA", () => {
  const fee = estimateFee(estimateSimpleTxBytes(2));
  // estimateSimpleTxBytes(2) is 300 bytes, so 44*300 + 155381 = 168_581.
  assert.equal(fee, 168_581n);
  assert.ok(fee > 160_000n, `${lovelaceToAda(fee)} ADA is too low`);
  assert.ok(fee < 200_000n, `${lovelaceToAda(fee)} ADA is too high`);
});

test("estimateFee honours custom protocol params", () => {
  const params: ProtocolParams = { ...CONWAY_DEFAULT_PARAMS, minFeeA: 50, minFeeB: 1000 };
  assert.equal(estimateFee(100, params), 6_000n);
});

test("estimateMinAda honours custom coinsPerUtxoByte", () => {
  const params: ProtocolParams = { ...CONWAY_DEFAULT_PARAMS, coinsPerUtxoByte: 1 };
  assert.equal(estimateMinAda({ [LOVELACE]: 0n }, params), BigInt(160 + 73));
});

test("estimateSimpleTxBytes is the documented heuristic", () => {
  assert.equal(estimateSimpleTxBytes(1), 100 + 70 + 65);
  assert.equal(estimateSimpleTxBytes(2, 3), 100 + 210 + 130);
  assert.equal(estimateSimpleTxBytes(2, 1, true), 100 + 70 + 130 + 150);
  assert.equal(estimateSimpleTxBytes(2, 1, false, 500), 100 + 70 + 130 + 500);
  assert.equal(estimateSimpleTxBytes(2, 1, true, 500), 100 + 70 + 130 + 150 + 500);
});

test("estimateSimpleTxBytes clamps nonsense arguments", () => {
  assert.equal(estimateSimpleTxBytes(-1, -1, false, -1), 100);
  assert.equal(estimateSimpleTxBytes(1.9, 1.9, false, 1.9), 100 + 70 + 65 + 1);
});

test("a simple transaction fits well inside maxTxSize", () => {
  assert.ok(estimateSimpleTxBytes(5, 5, true, 1000) < CONWAY_DEFAULT_PARAMS.maxTxSize);
});
