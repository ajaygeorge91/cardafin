// createMemoryApp: the test/dev composition root. These tests check the
// wiring, not the ledger rules (services/tx.test.ts covers those) — that a
// one-call app can actually move imaginary ADA, that its logger redacts, and
// that its defaults are the safe ones.

import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, lovelaceOf } from "../../core/assets.ts";
import { isCardafinError } from "../../core/errors.ts";
import { blockfrostUrl } from "../../core/network.ts";
import type { LogLevel } from "../../ports/logger.ts";
import { MEMORY_PROJECT_ID, createMemoryApp } from "./app.ts";

const TEN_ADA = 10_000_000n;

test("createMemoryApp builds a working app: fund, send, read the balance back", async () => {
  const app = createMemoryApp("Preview", { slot: 1_000 });
  const me = await app.wallet.address(0);
  const other = await app.wallet.address(1);
  app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  const receipt = await app.tx.sendAda({ to: other.address, amount: "3" });

  assert.equal(receipt.route, "l1");
  assert.match(receipt.txHash, /^[0-9a-f]{64}$/);
  const balance = await app.wallet.balance(other.address);
  assert.equal(lovelaceOf(balance.assets), 3_000_000n);
  assert.equal(balance.ada, "3");
});

test("the config it builds is internally consistent and carries no real key", () => {
  const app = createMemoryApp("Preprod");
  assert.equal(app.config.network, "Preprod");
  assert.equal(app.config.blockfrostUrl, blockfrostUrl("Preprod"));
  assert.equal(app.config.blockfrostProjectId, MEMORY_PROJECT_ID);
  assert.equal(app.config.mainnetConfirmed, false);
  assert.equal(app.chain, app.ledger);
});

test("a Mainnet memory app is confirmed, so the mainnet gate does not fire", async () => {
  const app = createMemoryApp("Mainnet", { slot: 10 });
  assert.equal(app.config.mainnetConfirmed, true);
  const me = await app.wallet.address(0);
  app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  const other = await app.wallet.address(1);
  // Imaginary money on an imaginary ledger: nothing touches Mainnet.
  const receipt = await app.tx.sendAda({ to: other.address, amount: "2" });
  assert.match(receipt.explorerUrl ?? "", /^https:\/\/cardanoscan\.io\//);
});

test("the default mnemonic is generated, never a BIP-39 phrase hard-coded in src", () => {
  const a = createMemoryApp("Preview");
  const b = createMemoryApp("Preview");
  assert.notEqual(a.config.mnemonic, b.config.mnemonic);
  assert.equal(a.config.mnemonic.split(" ").length, 24);
  assert.equal(a.config.mnemonic.includes("abandon"), false);
});

test("an explicit mnemonic is honoured, and two apps on it derive the same address", async () => {
  const mnemonic = createMemoryApp("Preview").config.mnemonic;
  const one = createMemoryApp("Preview", { mnemonic });
  const two = createMemoryApp("Preview", { mnemonic });
  assert.equal((await one.wallet.address(0)).address, (await two.wallet.address(0)).address);
});

test("the logger is wired with the config's secrets and redacts them", async () => {
  const lines: Array<{ level: LogLevel; msg: string; data: Record<string, unknown> }> = [];
  const app = createMemoryApp("Preview", {
    slot: 1_000,
    logSink: (level, msg, data) => lines.push({ level, msg, data }),
  });
  const me = await app.wallet.address(0);
  app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  await app.tx.sendAda({ to: (await app.wallet.address(1)).address, amount: "2" });

  assert.ok(lines.length > 0, "nothing was logged");
  const all = JSON.stringify(lines, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.equal(all.includes(app.config.mnemonic), false);
  assert.equal(all.includes(MEMORY_PROJECT_ID), false);
});

test("the hydra route is wired by default and refuses with NOT_IMPLEMENTED", async () => {
  const app = createMemoryApp("Preview", { slot: 1_000 });
  assert.equal(app.router.hasHydra, true);
  const me = await app.wallet.address(0);
  const other = await app.wallet.address(1);
  app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  await assert.rejects(
    () => app.tx.sendAda({ to: other.address, amount: "2", hydra: true }),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "NOT_IMPLEMENTED");
      assert.match(e.message, /designed but not built/);
      return true;
    },
  );
});

test("hydra: false leaves the route unwired, which is a different refusal", async () => {
  const app = createMemoryApp("Preview", { slot: 1_000, hydra: false });
  assert.equal(app.router.hasHydra, false);
  const me = await app.wallet.address(0);
  const other = await app.wallet.address(1);
  app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  await assert.rejects(
    () => app.tx.sendAda({ to: other.address, amount: "2", hydra: true }),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "NOT_IMPLEMENTED");
      assert.match(e.message, /no hydra executor is configured/);
      return true;
    },
  );
});

test("a custom starting slot reaches the ledger", async () => {
  const app = createMemoryApp("Preview", { slot: 55_555 });
  assert.equal(await app.chain.getCurrentSlot(), 55_555);
});
