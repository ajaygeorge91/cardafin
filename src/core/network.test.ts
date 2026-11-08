import test from "node:test";
import assert from "node:assert/strict";

import {
  NETWORKS,
  addressPrefix,
  blockfrostUrl,
  explorerTxUrl,
  isMainnet,
  networkId,
  parseNetwork,
  rewardAddressPrefix,
} from "./network.ts";

test("NETWORKS is the closed set", () => {
  assert.deepEqual([...NETWORKS], ["Preview", "Preprod", "Mainnet"]);
});

test("parseNetwork accepts exact names only", () => {
  for (const n of NETWORKS) {
    const r = parseNetwork(n);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.value, n);
  }
  for (const bad of ["preview", "PREVIEW", "mainnet", "", "Testnet"]) {
    const r = parseNetwork(bad);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.code, "INVALID_REQUEST");
  }
});

test("networkId is 1 for mainnet and 0 for the testnets", () => {
  assert.equal(networkId("Mainnet"), 1);
  assert.equal(networkId("Preview"), 0);
  assert.equal(networkId("Preprod"), 0);
});

test("address prefixes follow the network id", () => {
  assert.equal(addressPrefix("Mainnet"), "addr");
  assert.equal(addressPrefix("Preview"), "addr_test");
  assert.equal(addressPrefix("Preprod"), "addr_test");
  assert.equal(rewardAddressPrefix("Mainnet"), "stake");
  assert.equal(rewardAddressPrefix("Preprod"), "stake_test");
});

test("isMainnet is true only for Mainnet", () => {
  assert.equal(isMainnet("Mainnet"), true);
  assert.equal(isMainnet("Preview"), false);
});

test("blockfrostUrl is derived from the network, never configured", () => {
  assert.equal(blockfrostUrl("Preview"), "https://cardano-preview.blockfrost.io/api/v0");
  assert.equal(blockfrostUrl("Preprod"), "https://cardano-preprod.blockfrost.io/api/v0");
  assert.equal(blockfrostUrl("Mainnet"), "https://cardano-mainnet.blockfrost.io/api/v0");
});

test("explorerTxUrl points at the right cardanoscan", () => {
  const hash = "a".repeat(64);
  assert.equal(explorerTxUrl("Mainnet", hash), `https://cardanoscan.io/transaction/${hash}`);
  assert.equal(
    explorerTxUrl("Preprod", hash),
    `https://preprod.cardanoscan.io/transaction/${hash}`,
  );
  assert.equal(
    explorerTxUrl("Preview", hash),
    `https://preview.cardanoscan.io/transaction/${hash}`,
  );
});
