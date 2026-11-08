// End-to-end service tests: the real TxService wired to the real MemoryLedger
// and MemoryKeys, with a capturing logger. No network, no npm, no key.
//
// Money in these tests is imaginary — MemoryLedger is a model of the ledger
// rules, not a chain — but every rule that would reject a transaction on
// Preview is exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, assetNameToHex, lovelaceOf, toUnit } from "../core/assets.ts";
import { isCardafinError } from "../core/errors.ts";
import { METADATA_LABEL_CIP25 } from "../core/metadata.ts";
import type { Network } from "../core/network.ts";
import { blockfrostUrl } from "../core/network.ts";
import type { PolicyInfo } from "../core/plan.ts";
import { DEFAULT_POLICY_LOCK_SECONDS } from "../core/requests.ts";
import { unwrap } from "../core/result.ts";
import type { LogLevel } from "../ports/logger.ts";
import { HydraExecutor } from "../adapters/memory/hydra.ts";
import { MemoryKeys } from "../adapters/memory/keys.ts";
import { MemoryLedger } from "../adapters/memory/ledger.ts";
import type { Config } from "../config.ts";
import { MAINNET_CONFIRM_TOKEN, loadConfig, secretsOf } from "../config.ts";
import { createLogger } from "./logger.ts";
import { TxRouter } from "./router.ts";
import { TxService } from "./tx.ts";
import { WalletService } from "./wallet.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;
const FAKE_PROJECT_ID = "previewFAKEnotarealblockfrostkey01";
const START_SLOT = 1_000;
const TEN_ADA = 10_000_000n;

type Line = { level: LogLevel; msg: string; data: Record<string, unknown> };

function configFor(network: Network): Config {
  return {
    network,
    blockfrostProjectId: FAKE_PROJECT_ID,
    blockfrostUrl: blockfrostUrl(network),
    mnemonic: THROWAWAY_MNEMONIC,
    mainnetConfirmed: network === "Mainnet",
    httpPort: 8787,
    apiKeys: [],
  };
}

function wire(opts: { network?: Network; hydra?: boolean; slot?: number } = {}) {
  const network = opts.network ?? "Preview";
  const config = configFor(network);
  const keys = new MemoryKeys();
  const ledger = new MemoryLedger(network, { slot: opts.slot ?? START_SLOT, keys });
  const lines: Line[] = [];
  const log = createLogger({
    secrets: secretsOf(config),
    sink: (level, msg, data) => lines.push({ level, msg, data }),
  });
  const router = new TxRouter(
    opts.hydra ? { l1: ledger, hydra: new HydraExecutor() } : { l1: ledger },
  );
  return {
    config,
    keys,
    ledger,
    lines,
    router,
    tx: new TxService({ keys, chain: ledger, router, config, log }),
    wallet: new WalletService({ keys, chain: ledger, config }),
  };
}

/** Everything the sink saw, as one string, with bigints made printable. */
function flatten(lines: Line[]): string {
  return JSON.stringify(lines, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function assertNoSecrets(lines: Line[]): void {
  const all = flatten(lines);
  assert.equal(all.includes(THROWAWAY_MNEMONIC), false, "a log line held the mnemonic");
  assert.equal(all.includes("abandon"), false, "a log line held a mnemonic word");
  assert.equal(all.includes(FAKE_PROJECT_ID), false, "a log line held the project id");
}

function expectCode(code: string, re?: RegExp) {
  return (e: unknown): boolean => {
    assert.ok(isCardafinError(e), `expected a CardafinError, got ${String(e)}`);
    assert.equal(e.code, code, e.message);
    if (re) {
      assert.match(e.message, re);
    }
    return true;
  };
}

// --- 1. the happy path ----------------------------------------------------

test("1. sendAda moves ADA, charges a plausible fee and logs without the seed", async () => {
  const { tx, ledger, wallet, lines } = wire();
  const me = await wallet.address(0);
  const other = await wallet.address(1);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  const receipt = await tx.sendAda({ to: other.address, amount: "2" });

  assert.equal(receipt.route, "l1");
  assert.match(receipt.txHash, /^[0-9a-f]{64}$/);
  assert.ok(receipt.explorerUrl?.includes(receipt.txHash), receipt.explorerUrl);
  assert.equal(receipt.explorerUrl, `https://preview.cardanoscan.io/transaction/${receipt.txHash}`);

  assert.ok(
    receipt.fee >= 150_000n && receipt.fee <= 400_000n,
    `fee ${receipt.fee} is outside 150k–400k lovelace`,
  );
  assert.equal(lovelaceOf(await ledger.getBalance(other.address)), 2_000_000n);
  assert.equal(
    lovelaceOf(await ledger.getBalance(me.address)),
    TEN_ADA - 2_000_000n - receipt.fee,
  );
  assert.equal(await ledger.awaitTx(receipt.txHash), true);

  // The plan line, then the receipt line.
  const planLine = lines.find((l) => l.msg.startsWith("send-ada via l1 on Preview"));
  assert.ok(planLine, `no describePlan line in ${JSON.stringify(lines.map((l) => l.msg))}`);
  assert.equal(planLine.level, "info");
  assert.equal(planLine.data.kind, "send-ada");
  assert.equal(planLine.data.route, "l1");
  assert.equal(planLine.data.network, "Preview");
  assert.equal(planLine.data.estimatedFee, receipt.fee);
  assert.match(planLine.msg, /2 ADA → addr_test1/);

  const submitted = lines.find((l) => l.msg === "submitted");
  assert.ok(submitted);
  assert.equal(submitted.data.txHash, receipt.txHash);
  assert.equal(submitted.data.fee, receipt.fee);

  assertNoSecrets(lines);
});

// --- 2-4. the rejections core catches ------------------------------------

test("2. sendAda below min-ADA is refused before anything is submitted", async () => {
  const { tx, ledger, wallet, lines } = wire();
  const me = await wallet.address(0);
  const other = await wallet.address(1);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  await assert.rejects(
    () => tx.sendAda({ to: other.address, amount: "0.5" }),
    expectCode("BELOW_MIN_ADA", /below the estimated minimum/),
  );
  assert.deepEqual(ledger.history, [], "nothing was submitted");
  assert.equal(lines.some((l) => l.msg === "submitted"), false);
  assertNoSecrets(lines);
});

test("3. sendAda with insufficient funds is refused", async () => {
  const { tx, ledger, wallet } = wire();
  const me = await wallet.address(0);
  const other = await wallet.address(1);
  ledger.fund(me.address, { [LOVELACE]: 2_000_000n });

  await assert.rejects(
    () => tx.sendAda({ to: other.address, amount: "2" }),
    expectCode("INSUFFICIENT_FUNDS", /cannot cover this plan/),
  );
  // And with nothing at all.
  const empty = wire();
  await assert.rejects(
    () => empty.tx.sendAda({ to: other.address, amount: "2" }),
    expectCode("INSUFFICIENT_FUNDS"),
  );
  assert.deepEqual(ledger.history, []);
});

test("4. sendAda to a Mainnet address from a Preview service is WRONG_NETWORK", async () => {
  const { tx, ledger, wallet } = wire({ network: "Preview" });
  const me = await wallet.address(0);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  const mainnetAddress = (await new MemoryKeys().deriveWallet(THROWAWAY_MNEMONIC, 1, "Mainnet"))
    .address;

  await assert.rejects(
    () => tx.sendAda({ to: mainnetAddress, amount: "2" }),
    expectCode("WRONG_NETWORK", /this service is on Preview/),
  );
  assert.deepEqual(ledger.history, []);
});

// --- 5. the route flag flows end to end ----------------------------------

test("5. hydra: true routes away from l1 and fails as NOT_IMPLEMENTED either way", async () => {
  // No hydra executor configured: the router refuses the route.
  const bare = wire();
  const me = await bare.wallet.address(0);
  const other = await bare.wallet.address(1);
  bare.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  await assert.rejects(
    () => bare.tx.sendAda({ to: other.address, amount: "2", hydra: true }),
    expectCode("NOT_IMPLEMENTED", /no hydra executor is configured/),
  );
  // The plan was still built and logged — with route "hydra".
  const planned = bare.lines.find((l) => l.data.route === "hydra");
  assert.ok(planned, "the hydra plan was never logged");
  assert.match(planned.msg, /^send-ada via hydra on Preview/);
  assert.deepEqual(bare.ledger.history, [], "l1 was not used");

  // A hydra executor configured: the executor itself refuses, which proves the
  // flag travelled request → plan → router → executor.
  const withHydra = wire({ hydra: true });
  withHydra.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  await assert.rejects(
    () => withHydra.tx.sendAda({ to: other.address, amount: "2", hydra: true }),
    expectCode(
      "NOT_IMPLEMENTED",
      /^Hydra routing is designed but not built; see docs\/ARCHITECTURE\.md$/,
    ),
  );
  assert.deepEqual(withHydra.ledger.history, []);

  // Without the flag, the same request goes to l1 and succeeds.
  assert.equal((await withHydra.tx.sendAda({ to: other.address, amount: "2" })).route, "l1");
  assertNoSecrets(withHydra.lines);
});

// --- 6-8. policies and minting -------------------------------------------

test("6. createPolicy builds a sig+before script locked 365 days out", async () => {
  const { tx, wallet, keys, lines } = wire();
  const me = await wallet.address(0);

  const policy = await tx.createPolicy({});
  assert.match(policy.policyId, /^[0-9a-f]{56}$/);
  assert.equal(policy.keyHash, me.paymentKeyHash);
  // 1 slot == 1 second, so the default 365-day lock is that many slots on.
  assert.equal(DEFAULT_POLICY_LOCK_SECONDS, 365 * 24 * 60 * 60);
  assert.equal(policy.lockBeforeSlot, START_SLOT + DEFAULT_POLICY_LOCK_SECONDS);
  assert.deepEqual(policy.script, {
    type: "all",
    scripts: [
      { type: "sig", keyHash: me.paymentKeyHash },
      { type: "before", slot: START_SLOT + DEFAULT_POLICY_LOCK_SECONDS },
    ],
  });
  assert.equal(policy.policyId, keys.nativeScriptPolicyId(policy.script));
  assert.equal(policy.policyId, MemoryKeys.policyIdOf(policy.script));

  // An explicit slot wins; a custom duration is honoured; no tx is submitted.
  assert.equal((await tx.createPolicy({ lockBeforeSlot: 42_000 })).lockBeforeSlot, 42_000);
  assert.equal((await tx.createPolicy({ lockInSeconds: 60 })).lockBeforeSlot, START_SLOT + 60);
  await assert.rejects(
    () => tx.createPolicy({ lockBeforeSlot: 1, lockInSeconds: 1 }),
    expectCode("INVALID_REQUEST", /not both/),
  );
  assertNoSecrets(lines);
});

test("7. mint puts 1000 CARDAFIN in the wallet with CIP-25 metadata", async () => {
  const { tx, ledger, wallet, lines } = wire();
  const me = await wallet.address(0);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  const policy = await tx.createPolicy({});
  const unit = unwrap(toUnit(policy.policyId, unwrap(assetNameToHex("CARDAFIN"))));

  const receipt = await tx.mint(
    { policyId: policy.policyId, assetName: "CARDAFIN", quantity: "1000", cip25: { name: "Cardafin" } },
    policy,
  );
  assert.equal(receipt.route, "l1");
  assert.ok(receipt.explorerUrl?.includes(receipt.txHash));

  const balance = await ledger.getBalance(me.address);
  assert.equal(balance[unit], 1_000n);
  assert.equal(ledger.mintedSupply(unit), 1_000n);
  // The tokens had to carry min-ADA with them, and the fee came out of change.
  assert.equal(lovelaceOf(balance), TEN_ADA - receipt.fee);

  const plan = ledger.lastPlan;
  assert.ok(plan);
  assert.equal(plan.kind, "mint");
  assert.equal(plan.mint?.policyId, policy.policyId);
  assert.deepEqual(plan.mint?.assets, { [unit]: 1_000n });
  assert.equal(plan.metadata?.length, 1);
  assert.equal(plan.metadata?.[0]?.label, METADATA_LABEL_CIP25);
  assert.equal(METADATA_LABEL_CIP25, 721);
  assert.ok(plan.validToSlot !== undefined && plan.validToSlot > START_SLOT);

  const planLine = lines.find((l) => l.data.kind === "mint");
  assert.ok(planLine);
  assert.match(planLine.msg, /^mint via l1 on Preview/);
  assert.match(planLine.msg, new RegExp(`metadata labels ${METADATA_LABEL_CIP25}`));
  assertNoSecrets(lines);

  // A mint under a policy whose id does not match the request is refused.
  await assert.rejects(
    () =>
      tx.mint(
        { policyId: "ff".repeat(28), assetName: "CARDAFIN", quantity: "1" },
        policy,
      ),
    expectCode("INVALID_REQUEST", /policy id mismatch/),
  );
});

test("8. minting after the policy's lock slot is refused as locked", async () => {
  const { tx, ledger, wallet } = wire();
  const me = await wallet.address(0);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  const policy = await tx.createPolicy({ lockInSeconds: 3_600 });

  ledger.setSlot((policy.lockBeforeSlot ?? 0) + 1);
  await assert.rejects(
    () => tx.mint({ policyId: policy.policyId, assetName: "CARDAFIN", quantity: "1000" }, policy),
    expectCode("INVALID_REQUEST", /policy is locked/),
  );
  assert.deepEqual(ledger.history, []);

  // Exactly at the lock slot is already too late: `before` is exclusive.
  ledger.setSlot(policy.lockBeforeSlot ?? 0);
  await assert.rejects(
    () => tx.mint({ policyId: policy.policyId, assetName: "CARDAFIN", quantity: "1000" }, policy),
    expectCode("INVALID_REQUEST", /locked/),
  );
});

// --- 9-10. token transfers -----------------------------------------------

async function mintedHarness() {
  const harness = wire();
  const me = await harness.wallet.address(0);
  const other = await harness.wallet.address(1);
  harness.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
  const policy: PolicyInfo = await harness.tx.createPolicy({});
  const unit = unwrap(toUnit(policy.policyId, unwrap(assetNameToHex("CARDAFIN"))));
  await harness.tx.mint(
    { policyId: policy.policyId, assetName: "CARDAFIN", quantity: "1000" },
    policy,
  );
  return { ...harness, me, other, policy, unit };
}

test("9. sendTokens splits the holding and funds the recipient's min-ADA", async () => {
  const { tx, ledger, me, other, unit, lines } = await mintedHarness();

  const receipt = await tx.sendTokens({ to: other.address, assets: { [unit]: "400" } });
  assert.equal(receipt.route, "l1");

  const received = await ledger.getBalance(other.address);
  assert.equal(received[unit], 400n);
  assert.ok(
    lovelaceOf(received) >= 1_000_000n,
    `recipient got only ${lovelaceOf(received)} lovelace with the tokens`,
  );

  const kept = await ledger.getBalance(me.address);
  assert.equal(kept[unit], 600n);
  // The sender paid the recipient's min-ADA and the fee out of its own ADA.
  assert.ok(lovelaceOf(kept) < TEN_ADA);

  const planLine = lines.find((l) => l.data.kind === "send-tokens");
  assert.ok(planLine);
  assert.match(planLine.msg, /^send-tokens via l1 on Preview/);
  assert.match(planLine.msg, new RegExp(`400 ${unit}`));
  assertNoSecrets(lines);
});

test("10. sendTokens of a unit the wallet does not hold is INSUFFICIENT_FUNDS", async () => {
  const { tx, ledger, wallet } = wire();
  const me = await wallet.address(0);
  const other = await wallet.address(1);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  const ghost = unwrap(toUnit("ab".repeat(28), unwrap(assetNameToHex("GHOST"))));
  await assert.rejects(
    () => tx.sendTokens({ to: other.address, assets: { [ghost]: "1" } }),
    expectCode("INSUFFICIENT_FUNDS"),
  );

  // Holding some but not enough is the same answer.
  const held = await mintedHarness();
  await assert.rejects(
    () => held.tx.sendTokens({ to: held.other.address, assets: { [held.unit]: "1001" } }),
    expectCode("INSUFFICIENT_FUNDS"),
  );
  assert.deepEqual(ledger.history, []);
});

// --- 11. mainnet -----------------------------------------------------------

test("11. Mainnet needs the confirm token, and then behaves like any network", async () => {
  const baseEnv = {
    CARDAFIN_NETWORK: "Mainnet",
    BLOCKFROST_PROJECT_ID: FAKE_PROJECT_ID,
    CARDAFIN_MNEMONIC: THROWAWAY_MNEMONIC,
  };

  const unconfirmed = loadConfig(baseEnv);
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) {
    assert.equal(unconfirmed.error.code, "MAINNET_NOT_CONFIRMED");
    assert.match(unconfirmed.error.message, /I_UNDERSTAND_REAL_FUNDS/);
  }

  const confirmed = loadConfig({
    ...baseEnv,
    CARDAFIN_MAINNET_CONFIRM: MAINNET_CONFIRM_TOKEN,
  });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) {
    return;
  }
  const config = confirmed.value;
  assert.equal(config.network, "Mainnet");
  assert.equal(config.mainnetConfirmed, true);

  // This is the in-memory adapter: the ledger below is a model, the addresses
  // are fake-derived and the "funds" are imaginary. Nothing touches Mainnet.
  const keys = new MemoryKeys();
  const ledger = new MemoryLedger("Mainnet", { slot: START_SLOT, keys });
  const lines: Line[] = [];
  const log = createLogger({
    secrets: secretsOf(config),
    sink: (level, msg, data) => lines.push({ level, msg, data }),
  });
  const tx = new TxService({
    keys,
    chain: ledger,
    router: new TxRouter({ l1: ledger }),
    config,
    log,
  });

  const me = await keys.deriveWallet(config.mnemonic, 0, "Mainnet");
  const other = await keys.deriveWallet(config.mnemonic, 1, "Mainnet");
  assert.ok(me.address.startsWith("addr1"), me.address);
  ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

  const receipt = await tx.sendAda({ to: other.address, amount: "2" });
  assert.equal(receipt.route, "l1");
  assert.equal(receipt.explorerUrl, `https://cardanoscan.io/transaction/${receipt.txHash}`);
  assert.equal(lovelaceOf(await ledger.getBalance(other.address)), 2_000_000n);

  const planLine = lines.find((l) => l.data.kind === "send-ada");
  assert.ok(planLine);
  assert.equal(planLine.data.network, "Mainnet");
  assert.match(planLine.msg, /^send-ada via l1 on Mainnet/);
  assertNoSecrets(lines);

  // The second gate: a Config that lost its confirmation stops the pipeline.
  const unguarded = new TxService({
    keys,
    chain: ledger,
    router: new TxRouter({ l1: ledger }),
    config: { ...config, mainnetConfirmed: false },
    log,
  });
  await assert.rejects(
    () => unguarded.sendAda({ to: other.address, amount: "2" }),
    expectCode("MAINNET_NOT_CONFIRMED"),
  );
});
