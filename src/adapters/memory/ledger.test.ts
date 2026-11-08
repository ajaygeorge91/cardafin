import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, assetNameToHex, lovelaceOf, toUnit } from "../../core/assets.ts";
import { isCardafinError } from "../../core/errors.ts";
import { CONWAY_DEFAULT_PARAMS, estimateFee, estimateSimpleTxBytes } from "../../core/fees.ts";
import { sigAndBeforePolicy } from "../../core/native-script.ts";
import type { NativeScript } from "../../core/native-script.ts";
import type { TxPlan } from "../../core/plan.ts";
import { unwrap } from "../../core/result.ts";
import { utxoRef } from "../../core/types.ts";
import { MemoryKeys, policyIdOf } from "./keys.ts";
import { MemoryLedger } from "./ledger.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;
const SIGNER = { mnemonic: THROWAWAY_MNEMONIC, accountIndex: 0 };

const keys = new MemoryKeys();

async function addresses(): Promise<{ me: string; keyHash: string; other: string; otherKeyHash: string }> {
  const a = await keys.deriveWallet(THROWAWAY_MNEMONIC, 0, "Preview");
  const b = await keys.deriveWallet(THROWAWAY_MNEMONIC, 1, "Preview");
  return {
    me: a.address,
    keyHash: a.paymentKeyHash,
    other: b.address,
    otherKeyHash: b.paymentKeyHash,
  };
}

function code(e: unknown): string | undefined {
  return isCardafinError(e) ? e.code : undefined;
}

function sendPlan(from: string, to: string, lovelace: bigint): TxPlan {
  return {
    kind: "send-ada",
    network: "Preview",
    route: "l1",
    from,
    outputs: [{ address: to, assets: { [LOVELACE]: lovelace } }],
  };
}

async function mintFixture(script?: NativeScript) {
  const { me, keyHash } = await addresses();
  const policyScript = script ?? sigAndBeforePolicy(keyHash, 50_000);
  const policyId = policyIdOf(policyScript);
  const unit = unwrap(toUnit(policyId, unwrap(assetNameToHex("TOK"))));
  const plan: TxPlan = {
    kind: "mint",
    network: "Preview",
    route: "l1",
    from: me,
    outputs: [{ address: me, assets: { [unit]: 5n, [LOVELACE]: 2_000_000n } }],
    mint: { script: policyScript, policyId, assets: { [unit]: 5n } },
    validToSlot: 10_000,
  };
  return { me, keyHash, script: policyScript, policyId, unit, plan };
}

test("fund creates one UTxO with a deterministic 64-hex tx hash", async () => {
  const { me, other } = await addresses();
  const a = new MemoryLedger("Preview");
  const b = new MemoryLedger("Preview");

  const u1 = a.fund(me, { [LOVELACE]: 10_000_000n });
  const u2 = b.fund(me, { [LOVELACE]: 10_000_000n });
  assert.match(u1.txHash, /^[0-9a-f]{64}$/);
  assert.equal(u1.txHash, u2.txHash, "same counter + address ⇒ same hash");
  assert.equal(u1.outputIndex, 0);

  // The counter moves, so a second funding of the same address differs.
  const u3 = a.fund(me, { [LOVELACE]: 10_000_000n });
  assert.notEqual(u1.txHash, u3.txHash);
  // So does a different address.
  assert.notEqual(u1.txHash, b.fund(other, { [LOVELACE]: 1n }).txHash);
});

test("getUtxos, getBalance, slots, params and awaitTx", async () => {
  const { me, other } = await addresses();
  const ledger = new MemoryLedger("Preview", { slot: 500 });

  const funded = ledger.fund(me, { [LOVELACE]: 4_000_000n });
  ledger.fund(me, { [LOVELACE]: 6_000_000n });
  ledger.fund(other, { [LOVELACE]: 1_000_000n });

  const mine = await ledger.getUtxos(me);
  assert.equal(mine.length, 2);
  assert.deepEqual(await ledger.getBalance(me), { [LOVELACE]: 10_000_000n });
  assert.deepEqual(await ledger.getBalance(other), { [LOVELACE]: 1_000_000n });
  assert.deepEqual(await ledger.getBalance("addr_test1nobody"), {});

  // getUtxos hands out copies: mutating them must not change the ledger.
  const first = mine[0];
  assert.ok(first);
  first.assets[LOVELACE] = 999n;
  assert.deepEqual(await ledger.getBalance(me), { [LOVELACE]: 10_000_000n });

  assert.equal(await ledger.getCurrentSlot(), 500);
  ledger.advanceSlots(100);
  assert.equal(await ledger.getCurrentSlot(), 600);
  ledger.setSlot(42);
  assert.equal(await ledger.getCurrentSlot(), 42);
  assert.throws(() => ledger.setSlot(-1), (e) => code(e) === "INVALID_REQUEST");

  assert.deepEqual(await ledger.getProtocolParams(), CONWAY_DEFAULT_PARAMS);
  assert.equal(await ledger.awaitTx(funded.txHash), true);
  assert.equal(await ledger.awaitTx("00".repeat(32)), false);

  assert.equal(ledger.network, "Preview");
  assert.equal(ledger.route, "l1");
});

test("execute consumes every input at `from`, pays the output and returns change", async () => {
  const { me, other } = await addresses();
  const ledger = new MemoryLedger("Preview", { slot: 1_000, keys });
  const inputs = [
    ledger.fund(me, { [LOVELACE]: 4_000_000n }),
    ledger.fund(me, { [LOVELACE]: 6_000_000n }),
  ];
  const untouched = ledger.fund(other, { [LOVELACE]: 7_000_000n });

  const plan = sendPlan(me, other, 2_000_000n);
  const receipt = await ledger.execute(plan, SIGNER);

  // Fee = the core estimate for 2 inputs, 1 output + change, no mint.
  assert.equal(
    receipt.fee,
    estimateFee(estimateSimpleTxBytes(2, 2, false, 0), CONWAY_DEFAULT_PARAMS),
  );
  assert.equal(receipt.route, "l1");
  assert.match(receipt.txHash, /^[0-9a-f]{64}$/);
  assert.equal(receipt.explorerUrl, `https://preview.cardanoscan.io/transaction/${receipt.txHash}`);

  // Inputs consumed.
  const refs = new Set(ledger.allUtxos().map(utxoRef));
  for (const input of inputs) {
    assert.equal(refs.has(utxoRef(input)), false, `${utxoRef(input)} was not spent`);
  }
  // The other address's UTxO was not an input.
  assert.equal(refs.has(utxoRef(untouched)), true);

  // Change back to `from`, output to the recipient.
  assert.equal(lovelaceOf(await ledger.getBalance(me)), 10_000_000n - 2_000_000n - receipt.fee);
  assert.equal(lovelaceOf(await ledger.getBalance(other)), 7_000_000n + 2_000_000n);

  assert.deepEqual(ledger.history, [receipt]);
  assert.equal(ledger.lastPlan, plan);
  assert.equal(await ledger.awaitTx(receipt.txHash), true);
});

test("the tx hash is deterministic across two identically driven ledgers", async () => {
  const { me, other } = await addresses();
  const run = async (): Promise<string> => {
    const ledger = new MemoryLedger("Preview", { slot: 1_000, keys });
    ledger.fund(me, { [LOVELACE]: 10_000_000n });
    return (await ledger.execute(sendPlan(me, other, 2_000_000n), SIGNER)).txHash;
  };
  assert.equal(await run(), await run());

  // Different slot ⇒ different hash (the slot is in the digest).
  const shifted = new MemoryLedger("Preview", { slot: 1_001, keys });
  shifted.fund(me, { [LOVELACE]: 10_000_000n });
  const other1 = await shifted.execute(sendPlan(me, other, 2_000_000n), SIGNER);
  assert.notEqual(other1.txHash, await run());
});

test("execute rejects a plan for another network or another route", async () => {
  const { me, other } = await addresses();
  const ledger = new MemoryLedger("Preview", { keys });
  ledger.fund(me, { [LOVELACE]: 10_000_000n });

  await assert.rejects(
    () => ledger.execute({ ...sendPlan(me, other, 2_000_000n), network: "Mainnet" }, SIGNER),
    (e) => code(e) === "PROVIDER_ERROR",
  );
  await assert.rejects(
    () => ledger.execute({ ...sendPlan(me, other, 2_000_000n), route: "hydra" }, SIGNER),
    (e) => code(e) === "PROVIDER_ERROR",
  );
});

test("execute re-validates output addresses and min-ADA", async () => {
  const { me, other } = await addresses();
  const mainnetOther = (await keys.deriveWallet(THROWAWAY_MNEMONIC, 1, "Mainnet")).address;
  const ledger = new MemoryLedger("Preview", { keys });
  ledger.fund(me, { [LOVELACE]: 10_000_000n });

  await assert.rejects(
    () => ledger.execute(sendPlan(me, mainnetOther, 2_000_000n), SIGNER),
    (e) => code(e) === "WRONG_NETWORK",
  );
  await assert.rejects(
    () => ledger.execute(sendPlan(me, "addr_test1nonsense", 2_000_000n), SIGNER),
    (e) => code(e) === "INVALID_ADDRESS",
  );
  // A plan that slipped past core's planner is still caught here.
  await assert.rejects(
    () => ledger.execute(sendPlan(me, other, 500_000n), SIGNER),
    (e) => code(e) === "BELOW_MIN_ADA",
  );
});

test("execute reports INSUFFICIENT_FUNDS and leaves the ledger untouched", async () => {
  const { me, other } = await addresses();
  const ledger = new MemoryLedger("Preview", { keys });
  const funded = ledger.fund(me, { [LOVELACE]: 2_000_000n });

  await assert.rejects(
    () => ledger.execute(sendPlan(me, other, 2_000_000n), SIGNER),
    (e) => code(e) === "INSUFFICIENT_FUNDS",
  );
  // No UTxO was spent and no history written.
  assert.deepEqual(ledger.allUtxos().map(utxoRef), [utxoRef(funded)]);
  assert.deepEqual(ledger.history, []);

  // An address with nothing at all is the same failure.
  await assert.rejects(
    () => ledger.execute(sendPlan(other, me, 2_000_000n), SIGNER),
    (e) => code(e) === "INSUFFICIENT_FUNDS",
  );
});

test("dust change is folded into the fee rather than left unspendable", async () => {
  const { me, other } = await addresses();
  const ledger = new MemoryLedger("Preview", { keys });
  const fee = estimateFee(estimateSimpleTxBytes(2, 1, false, 0), CONWAY_DEFAULT_PARAMS);
  // Exactly the output + fee + 1 lovelace of change: far below min-ADA.
  ledger.fund(me, { [LOVELACE]: 2_000_000n + fee + 1n });

  const receipt = await ledger.execute(sendPlan(me, other, 2_000_000n), SIGNER);
  assert.equal(receipt.fee, fee + 1n, "the stray lovelace became fee");
  assert.deepEqual(await ledger.getBalance(me), {}, "no dust UTxO was created");
  assert.equal(lovelaceOf(await ledger.getBalance(other)), 2_000_000n);
});

test("a mint applies supply, keeps token change and records metadata", async () => {
  const { me, unit, plan } = await mintFixture();
  const ledger = new MemoryLedger("Preview", { slot: 1_000, keys });
  ledger.fund(me, { [LOVELACE]: 10_000_000n });

  const receipt = await ledger.execute(plan, SIGNER);
  assert.equal(ledger.mintedSupply(unit), 5n);
  assert.equal(ledger.mintedSupply("deadbeef"), 0n);
  const balance = await ledger.getBalance(me);
  assert.equal(balance[unit], 5n);
  assert.equal(lovelaceOf(balance), 10_000_000n - receipt.fee);
  assert.equal(ledger.lastPlan?.kind, "mint");

  // Burning the lot takes the supply back to zero.
  const burn: TxPlan = {
    ...plan,
    outputs: [{ address: me, assets: { [LOVELACE]: 2_000_000n } }],
    mint: { ...plan.mint!, assets: { [unit]: -5n } },
  };
  await ledger.execute(burn, SIGNER);
  assert.equal(ledger.mintedSupply(unit), 0n);
  assert.equal((await ledger.getBalance(me))[unit], undefined);
});

test("a mint whose policy id does not hash from its script is rejected", async () => {
  const { me, plan } = await mintFixture();
  const ledger = new MemoryLedger("Preview", { slot: 1_000, keys });
  ledger.fund(me, { [LOVELACE]: 10_000_000n });

  const tampered: TxPlan = {
    ...plan,
    mint: { ...plan.mint!, policyId: "ff".repeat(28) },
  };
  await assert.rejects(
    () => ledger.execute(tampered, SIGNER),
    (e) => {
      assert.equal(code(e), "PROVIDER_ERROR");
      assert.match((e as Error).message, /policy id does not match/);
      return true;
    },
  );
  assert.deepEqual(ledger.history, []);
});

test("a mint the signer cannot authorise is rejected as a missing signer", async () => {
  const { otherKeyHash } = await addresses();
  // The policy requires account 1's key; the signer below is account 0.
  const { me, plan } = await mintFixture(sigAndBeforePolicy(otherKeyHash, 50_000));
  const ledger = new MemoryLedger("Preview", { slot: 1_000, keys });
  ledger.fund(me, { [LOVELACE]: 10_000_000n });

  await assert.rejects(
    () => ledger.execute(plan, SIGNER),
    (e) => {
      assert.equal(code(e), "PROVIDER_ERROR");
      assert.match((e as Error).message, /missing signer/);
      return true;
    },
  );
  // Account 1 can.
  const receipt = await ledger.execute(plan, {
    mnemonic: THROWAWAY_MNEMONIC,
    accountIndex: 1,
  });
  assert.equal(receipt.route, "l1");
});

test("a locked policy or a passed validity window is rejected", async () => {
  const { me, plan } = await mintFixture();
  const ledger = new MemoryLedger("Preview", { slot: 1_000, keys });
  ledger.fund(me, { [LOVELACE]: 10_000_000n });

  // Slot 50_000 is the policy's `before` bound: it can no longer mint.
  ledger.setSlot(50_000);
  await assert.rejects(
    () => ledger.execute(plan, SIGNER),
    (e) => {
      assert.equal(code(e), "PROVIDER_ERROR");
      assert.match((e as Error).message, /policy locked/);
      return true;
    },
  );

  // Inside the policy window but past the plan's own validTo slot.
  ledger.setSlot(10_001);
  await assert.rejects(
    () => ledger.execute(plan, SIGNER),
    (e) => {
      assert.equal(code(e), "PROVIDER_ERROR");
      assert.match((e as Error).message, /validity window passed/);
      return true;
    },
  );
});
