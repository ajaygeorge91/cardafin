import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, assetNameToHex, toUnit } from "../core/assets.ts";
import { isCardafinError } from "../core/errors.ts";
import type { Network } from "../core/network.ts";
import { blockfrostUrl } from "../core/network.ts";
import { unwrap } from "../core/result.ts";
import { utxoRef } from "../core/types.ts";
import { MemoryKeys } from "../adapters/memory/keys.ts";
import { MemoryLedger } from "../adapters/memory/ledger.ts";
import type { Config } from "../config.ts";
import { WalletService, tokensOf } from "./wallet.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;

function configFor(network: Network): Config {
  return {
    network,
    blockfrostProjectId: "previewFAKEnotarealblockfrostkey01",
    blockfrostUrl: blockfrostUrl(network),
    mnemonic: THROWAWAY_MNEMONIC,
    mainnetConfirmed: network === "Mainnet",
    httpPort: 8787,
    apiKeys: [],
  };
}

function wire(network: Network = "Preview") {
  const config = configFor(network);
  const keys = new MemoryKeys();
  const ledger = new MemoryLedger(network, { keys });
  return { config, keys, ledger, wallet: new WalletService({ keys, chain: ledger, config }) };
}

test("create returns a fresh 24-word mnemonic and persists nothing", () => {
  const { wallet, keys } = wire();
  const first = wallet.create();
  assert.equal(first.mnemonic.split(" ").length, 24);
  assert.equal(keys.validateMnemonic(first.mnemonic), true);
  // Fresh each time: there is no wallet store behind this.
  assert.notEqual(first.mnemonic, wallet.create().mnemonic);
  assert.deepEqual(Object.keys(first), ["mnemonic"]);
});

test("restore derives an address on the configured network", async () => {
  const preview = await wire("Preview").wallet.restore(THROWAWAY_MNEMONIC);
  assert.ok(preview.address.startsWith("addr_test1"), preview.address);
  assert.equal(preview.network, "Preview");
  assert.equal(preview.accountIndex, 0);
  assert.match(preview.paymentKeyHash, /^[0-9a-f]{56}$/);

  const preprod = await wire("Preprod").wallet.restore(THROWAWAY_MNEMONIC);
  assert.ok(preprod.address.startsWith("addr_test1"), preprod.address);

  const mainnet = await wire("Mainnet").wallet.restore(THROWAWAY_MNEMONIC);
  assert.ok(mainnet.address.startsWith("addr1"), mainnet.address);
  assert.equal(mainnet.network, "Mainnet");

  // Account index separates wallets.
  const second = await wire("Preview").wallet.restore(THROWAWAY_MNEMONIC, 1);
  assert.equal(second.accountIndex, 1);
  assert.notEqual(second.address, preview.address);
});

test("restore rejects a mnemonic the key provider will not accept", async () => {
  const { wallet } = wire();
  for (const bad of ["", "abandon", `${"abandon ".repeat(22)}art`, `${"abandon ".repeat(23)}ART`]) {
    await assert.rejects(
      () => wallet.restore(bad),
      (e: unknown) => {
        assert.ok(isCardafinError(e));
        assert.equal(e.code, "INVALID_REQUEST");
        return true;
      },
      `"${bad.slice(0, 20)}…" should have been rejected`,
    );
  }
});

test("address uses config.mnemonic and matches restore", async () => {
  const { wallet } = wire();
  assert.deepEqual(await wallet.address(), await wallet.restore(THROWAWAY_MNEMONIC));
  assert.deepEqual(await wallet.address(3), await wallet.restore(THROWAWAY_MNEMONIC, 3));
});

test("balance reports ADA as a decimal string and tokens in a flat shape", async () => {
  const { wallet, ledger } = wire();
  const me = await wallet.address();

  const policyId = "9f".repeat(28);
  const cardafin = unwrap(toUnit(policyId, unwrap(assetNameToHex("CARDAFIN"))));
  // An asset with an empty name, which is legal and must not crash fromUnit.
  const unnamed = unwrap(toUnit(policyId, ""));

  assert.deepEqual(await wallet.balance(me.address), {
    assets: {},
    ada: "0",
    tokens: [],
  });

  ledger.fund(me.address, { [LOVELACE]: 7_831_419n, [cardafin]: 1_000n });
  ledger.fund(me.address, { [LOVELACE]: 2_000_000n, [unnamed]: 1n });

  const report = await wallet.balance(me.address);
  assert.equal(report.ada, "9.831419");
  assert.deepEqual(report.assets, {
    [LOVELACE]: 9_831_419n,
    [cardafin]: 1_000n,
    [unnamed]: 1n,
  });
  assert.deepEqual(report.tokens, [
    {
      unit: unnamed,
      policyId,
      assetNameHex: "",
      assetName: "",
      quantity: "1",
    },
    {
      unit: cardafin,
      policyId,
      assetNameHex: unwrap(assetNameToHex("CARDAFIN")),
      assetName: "CARDAFIN",
      quantity: "1000",
    },
  ]);
  // Quantities are strings because JSON has no bigint.
  for (const token of report.tokens) {
    assert.equal(typeof token.quantity, "string");
  }
});

test("balance and utxos reject a foreign-network or malformed address", async () => {
  const { wallet } = wire("Preview");
  const mainnetAddress = (await wire("Mainnet").wallet.address()).address;

  for (const call of [
    () => wallet.balance(mainnetAddress),
    () => wallet.utxos(mainnetAddress),
  ]) {
    await assert.rejects(call, (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "WRONG_NETWORK");
      return true;
    });
  }
  await assert.rejects(
    () => wallet.balance("addr_test1nonsense"),
    (e: unknown) => (e as { code?: string }).code === "INVALID_ADDRESS",
  );
  // A stake address is not a payment address.
  await assert.rejects(
    () => wallet.utxos("stake_test1uqevw2xnsc0pvn9t9r9c7qryfqfeerchgrlm6uzhxxxxxxxxxxxxx"),
    (e: unknown) => isCardafinError(e),
  );
});

test("utxos lists exactly the UTxOs at that address", async () => {
  const { wallet, ledger } = wire();
  const me = await wallet.address();
  const other = await wallet.address(1);

  assert.deepEqual(await wallet.utxos(me.address), []);

  const a = ledger.fund(me.address, { [LOVELACE]: 1_000_000n });
  const b = ledger.fund(me.address, { [LOVELACE]: 2_000_000n });
  ledger.fund(other.address, { [LOVELACE]: 3_000_000n });

  const mine = await wallet.utxos(me.address);
  assert.deepEqual(mine.map(utxoRef).sort(), [utxoRef(a), utxoRef(b)].sort());
  for (const utxo of mine) {
    assert.equal(utxo.address, me.address);
    assert.match(utxo.txHash, /^[0-9a-f]{64}$/);
  }
  assert.equal((await wallet.utxos(other.address)).length, 1);
});

test("tokensOf skips lovelace and anything core cannot parse", () => {
  const unit = unwrap(toUnit("9f".repeat(28), unwrap(assetNameToHex("A"))));
  assert.deepEqual(
    tokensOf({ [LOVELACE]: 5n, [unit]: 2n, "not-a-unit": 9n }).map((t) => t.unit),
    [unit],
  );
});
