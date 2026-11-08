// Blockfrost → core mapping, driven with plain objects. No npm import, no
// network: these are the exact JSON shapes the API documents, and the point
// of the tests is the string→bigint / string→number conversions and the
// null-parameter fallbacks.

import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, lovelaceOf, sumUtxoAssets } from "../../core/assets.ts";
import { isCardafinError } from "../../core/errors.ts";
import { CONWAY_DEFAULT_PARAMS, estimateMinAda } from "../../core/fees.ts";
import type { BlockfrostParams, BlockfrostUtxo } from "./mappers.ts";
import {
  blockfrostParamsToCore,
  blockfrostUtxoToCore,
  blockfrostUtxosToCore,
  isBlockfrost404,
} from "./mappers.ts";

const POLICY = "d27197682d71905c087c5c3b61b10e6d746db0b9bef351014d75bb26";
const UNIT = `${POLICY}6c6f766520746f6b656e`;
const ADDRESS = "addr_test1vqeux7xwusdju9dvsj8h7mca9aup2k739luac8pqmna8afhz3qfr4";

const PARAMS: BlockfrostParams = {
  min_fee_a: 44,
  min_fee_b: 155381,
  max_tx_size: 16384,
  max_val_size: "5000",
  coins_per_utxo_size: "4310",
};

// --- utxos ----------------------------------------------------------------

test("a Blockfrost UTxO becomes a core Utxo with bigint quantities", () => {
  const raw: BlockfrostUtxo = {
    tx_hash: "aa".repeat(32),
    output_index: 3,
    address: ADDRESS,
    amount: [
      { unit: "lovelace", quantity: "1500000" },
      { unit: UNIT, quantity: "42" },
    ],
  };

  assert.deepEqual(blockfrostUtxoToCore(raw), {
    txHash: "aa".repeat(32),
    outputIndex: 3,
    address: ADDRESS,
    assets: { [LOVELACE]: 1_500_000n, [UNIT]: 42n },
  });
});

test("a quantity too large for a double survives the conversion exactly", () => {
  const huge = "9007199254740993"; // 2^53 + 1: not representable as a double
  const utxo = blockfrostUtxoToCore({
    tx_hash: "bb".repeat(32),
    output_index: 0,
    address: ADDRESS,
    amount: [{ unit: "lovelace", quantity: huge }],
  });
  assert.equal(utxo.assets[LOVELACE], BigInt(huge));
  assert.equal(utxo.assets[LOVELACE]?.toString(), huge);
});

test("units pass through untouched: lovelace stays, native units are already policy+hex", () => {
  const utxo = blockfrostUtxoToCore({
    tx_hash: "cc".repeat(32),
    output_index: 0,
    address: ADDRESS,
    amount: [{ unit: UNIT, quantity: "1" }],
  });
  assert.deepEqual(Object.keys(utxo.assets), [UNIT]);
  assert.equal(UNIT.slice(0, 56), POLICY);
});

test("a repeated unit in one amount array is summed, not overwritten", () => {
  const utxo = blockfrostUtxoToCore({
    tx_hash: "dd".repeat(32),
    output_index: 0,
    address: ADDRESS,
    amount: [
      { unit: "lovelace", quantity: "1000000" },
      { unit: "lovelace", quantity: "500000" },
    ],
  });
  assert.equal(utxo.assets[LOVELACE], 1_500_000n);
});

test("an empty amount array gives an empty asset map, which core reads as zero", () => {
  const utxo = blockfrostUtxoToCore({
    tx_hash: "ee".repeat(32),
    output_index: 0,
    address: ADDRESS,
    amount: [],
  });
  assert.deepEqual(utxo.assets, {});
  assert.equal(lovelaceOf(utxo.assets), 0n);
});

test("a non-numeric quantity is a PROVIDER_ERROR, not NaN or a silent zero", () => {
  for (const quantity of ["", "1.5", "abc", "1e6", " 10"]) {
    assert.throws(
      () =>
        blockfrostUtxoToCore({
          tx_hash: "ff".repeat(32),
          output_index: 0,
          address: ADDRESS,
          amount: [{ unit: "lovelace", quantity }],
        }),
      (e: unknown) => {
        assert.ok(isCardafinError(e), `expected CardafinError for ${JSON.stringify(quantity)}`);
        assert.equal(e.code, "PROVIDER_ERROR");
        return true;
      },
      `quantity ${JSON.stringify(quantity)} should be rejected`,
    );
  }
});

test("a page of UTxOs sums the way core expects", () => {
  const utxos = blockfrostUtxosToCore([
    {
      tx_hash: "11".repeat(32),
      output_index: 0,
      address: ADDRESS,
      amount: [{ unit: "lovelace", quantity: "2000000" }],
    },
    {
      tx_hash: "22".repeat(32),
      output_index: 1,
      address: ADDRESS,
      amount: [
        { unit: "lovelace", quantity: "3000000" },
        { unit: UNIT, quantity: "9" },
      ],
    },
  ]);
  assert.equal(utxos.length, 2);
  assert.deepEqual(sumUtxoAssets(utxos), { [LOVELACE]: 5_000_000n, [UNIT]: 9n });
});

// --- protocol parameters --------------------------------------------------

test("protocol parameters convert, decimal strings included", () => {
  assert.deepEqual(blockfrostParamsToCore(PARAMS), {
    minFeeA: 44,
    minFeeB: 155381,
    maxTxSize: 16384,
    coinsPerUtxoByte: 4310,
    maxValSize: 5000,
  });
});

test("live-looking parameters give the same min-ADA as the Conway defaults", () => {
  const mapped = blockfrostParamsToCore(PARAMS);
  assert.equal(
    estimateMinAda({ [LOVELACE]: 0n }, mapped),
    estimateMinAda({ [LOVELACE]: 0n }, CONWAY_DEFAULT_PARAMS),
  );
});

test("a null coins_per_utxo_size falls back to the Conway default, not zero", () => {
  const mapped = blockfrostParamsToCore({ ...PARAMS, coins_per_utxo_size: null });
  assert.equal(mapped.coinsPerUtxoByte, CONWAY_DEFAULT_PARAMS.coinsPerUtxoByte);
  // The fallback exists so min-ADA cannot collapse to 0 and let cardafin
  // plan an output the node would reject.
  assert.ok(estimateMinAda({ [LOVELACE]: 0n }, mapped) > 0n);
});

test("a null max_val_size falls back to the Conway default", () => {
  const mapped = blockfrostParamsToCore({ ...PARAMS, max_val_size: null });
  assert.equal(mapped.maxValSize, CONWAY_DEFAULT_PARAMS.maxValSize);
});

test("a non-numeric string parameter is a PROVIDER_ERROR", () => {
  assert.throws(
    () => blockfrostParamsToCore({ ...PARAMS, coins_per_utxo_size: "lots" }),
    (e: unknown) => isCardafinError(e) && e.code === "PROVIDER_ERROR",
  );
});

test("a non-numeric min_fee_a is a PROVIDER_ERROR", () => {
  assert.throws(
    () =>
      blockfrostParamsToCore({
        ...PARAMS,
        min_fee_a: "44" as unknown as number,
      }),
    (e: unknown) => isCardafinError(e) && e.code === "PROVIDER_ERROR",
  );
});

// --- 404 detection --------------------------------------------------------

test("isBlockfrost404 matches a numeric status_code of 404 and nothing else", () => {
  assert.equal(isBlockfrost404({ status_code: 404 }), true);
  assert.equal(isBlockfrost404({ status_code: 403 }), false);
  assert.equal(isBlockfrost404({ status_code: 500 }), false);
  // A string "404" is not a match: blockfrost-js types it as a number, and
  // accepting the string would hide a shape change rather than surface it.
  assert.equal(isBlockfrost404({ status_code: "404" }), false);
  assert.equal(isBlockfrost404({ status: 404 }), false);
  assert.equal(isBlockfrost404(new Error("404 Not Found")), false);
  assert.equal(isBlockfrost404(null), false);
  assert.equal(isBlockfrost404(undefined), false);
  assert.equal(isBlockfrost404("404"), false);
});

test("isBlockfrost404 reads status_code off an Error subclass, as blockfrost-js throws it", () => {
  class FakeServerError extends Error {
    status_code = 404;
    error = "Not Found";
  }
  assert.equal(isBlockfrost404(new FakeServerError("not found")), true);
});
