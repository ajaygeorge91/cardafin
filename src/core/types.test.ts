import test from "node:test";
import assert from "node:assert/strict";

import type { Utxo } from "./types.ts";
import { utxoRef } from "./types.ts";
import { LOVELACE } from "./assets.ts";

const utxo: Utxo = {
  txHash: "b".repeat(64),
  outputIndex: 2,
  address: "addr_test1example",
  assets: { [LOVELACE]: 5_000_000n },
};

test("utxoRef is the ledger-style txHash#index key", () => {
  assert.equal(utxoRef(utxo), `${"b".repeat(64)}#2`);
});

test("utxoRef distinguishes outputs of the same transaction", () => {
  assert.notEqual(utxoRef(utxo), utxoRef({ ...utxo, outputIndex: 3 }));
});

test("Utxo assets are bigint lovelace, never numbers", () => {
  assert.equal(typeof utxo.assets[LOVELACE], "bigint");
});
