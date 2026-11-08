import test from "node:test";
import assert from "node:assert/strict";

import {
  MINT_VALIDITY_WINDOW_SLOTS,
  checkFunds,
  describePlan,
  estimatePlanMetadataBytes,
  planMint,
  planSendAda,
  planSendTokens,
} from "./plan.ts";
import type { PlanContext, PolicyInfo, TxPlan } from "./plan.ts";
import { CONWAY_DEFAULT_PARAMS, estimateFee, estimateMinAda, estimateSimpleTxBytes } from "./fees.ts";
import { LOVELACE, assetNameToHex, toUnit } from "./assets.ts";
import type { Assets } from "./assets.ts";
import { parseAddress } from "./address.ts";
import type { AddressInfo } from "./address.ts";
import { sigAndBeforePolicy } from "./native-script.ts";
import { METADATA_LABEL_CIP25, METADATA_LABEL_MESSAGE } from "./metadata.ts";
import type { ValidMint, ValidSendAda, ValidSendTokens } from "./requests.ts";

// Real, public preview address. No keys, no funds of ours.
const TESTNET =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
const FROM = "addr_test1wallet0000000000000000000000000000000000000000000000000";
const POLICY_ID = "e".repeat(56);
const KEY_HASH = "3c".repeat(28);

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

function code(r: { ok: true } | { ok: false; error: { code: string } }): string {
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error.code;
}

const TO: AddressInfo = must(parseAddress(TESTNET));
const UNIT = must(toUnit(POLICY_ID, must(assetNameToHex("TOKEN"))));

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    network: "Preview",
    from: FROM,
    available: { [LOVELACE]: 100_000_000n },
    currentSlot: 1_000,
    params: CONWAY_DEFAULT_PARAMS,
    ...overrides,
  };
}

const policy: PolicyInfo = {
  policyId: POLICY_ID,
  script: sigAndBeforePolicy(KEY_HASH, 100_000),
  keyHash: KEY_HASH,
  lockBeforeSlot: 100_000,
};

function sendAda(overrides: Partial<ValidSendAda> = {}): ValidSendAda {
  return { to: TO, lovelace: 1_500_000n, hydra: false, ...overrides };
}

function sendTokens(overrides: Partial<ValidSendTokens> = {}): ValidSendTokens {
  return { to: TO, assets: { [UNIT]: 5n }, hydra: false, ...overrides };
}

function mint(overrides: Partial<ValidMint> = {}): ValidMint {
  return {
    policyId: POLICY_ID,
    assetNameHex: must(assetNameToHex("TOKEN")),
    assetName: "TOKEN",
    quantity: 100n,
    hydra: false,
    ...overrides,
  };
}

/* ------------------------------- send-ada -------------------------------- */

test("planSendAda builds one output to the recipient", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  assert.equal(plan.kind, "send-ada");
  assert.equal(plan.network, "Preview");
  assert.equal(plan.route, "l1");
  assert.equal(plan.from, FROM);
  assert.deepEqual(plan.outputs, [{ address: TESTNET, assets: { [LOVELACE]: 1_500_000n } }]);
  assert.equal(plan.mint, undefined);
  assert.equal(plan.validToSlot, undefined);
  assert.equal(plan.metadata, undefined);
});

test("planSendAda routes to hydra when asked", () => {
  assert.equal(must(planSendAda(sendAda({ hydra: true }), ctx())).route, "hydra");
});

test("planSendAda attaches a memo under the CIP-20 label 674", () => {
  const plan = must(planSendAda(sendAda({ metadata: { msg: ["thanks"] } }), ctx()));
  assert.deepEqual(plan.metadata, [
    { label: METADATA_LABEL_MESSAGE, value: { msg: ["thanks"] } },
  ]);
});

test("planSendAda rejects an output below the estimated min-ADA", () => {
  const r = planSendAda(sendAda({ lovelace: 500_000n }), ctx());
  assert.equal(code(r), "BELOW_MIN_ADA");
  const details = r.ok === false ? (r.error.details as { minimum: bigint; provided: bigint }) : null;
  assert.equal(details?.minimum, estimateMinAda({ [LOVELACE]: 500_000n }));
  assert.equal(details?.provided, 500_000n);
  assert.equal(code(planSendAda(sendAda({ lovelace: 0n }), ctx())), "BELOW_MIN_ADA");
});

test("planSendAda accepts exactly the minimum", () => {
  const minimum = estimateMinAda({ [LOVELACE]: 0n });
  assert.equal(must(planSendAda(sendAda({ lovelace: minimum }), ctx())).outputs.length, 1);
});

test("planSendAda never puts the recipient's full address in an error", () => {
  const r = planSendAda(sendAda({ lovelace: 1n }), ctx());
  const details = r.ok === false ? (r.error.details as { address: string }) : { address: "" };
  assert.notEqual(details.address, TESTNET);
  assert.match(details.address, /…/);
});

/* ------------------------------ send-tokens ------------------------------ */

test("planSendTokens makes the sender pay the min-ADA", () => {
  const plan = must(planSendTokens(sendTokens(), ctx()));
  assert.equal(plan.kind, "send-tokens");
  const expectedMin = estimateMinAda({ [UNIT]: 5n });
  assert.deepEqual(plan.outputs, [
    { address: TESTNET, assets: { [UNIT]: 5n, [LOVELACE]: expectedMin } },
  ]);
  assert.ok(expectedMin > 1_100_000n && expectedMin < 1_600_000n);
});

test("planSendTokens ignores any lovelace the caller smuggled in", () => {
  const plan = must(
    planSendTokens(sendTokens({ assets: { [UNIT]: 5n, [LOVELACE]: 99n } as Assets }), ctx()),
  );
  assert.equal(plan.outputs[0]?.assets[LOVELACE], estimateMinAda({ [UNIT]: 5n }));
});

test("planSendTokens requires at least one native asset", () => {
  assert.equal(code(planSendTokens(sendTokens({ assets: {} }), ctx())), "INVALID_REQUEST");
  assert.equal(
    code(planSendTokens(sendTokens({ assets: { [LOVELACE]: 1n } }), ctx())),
    "INVALID_REQUEST",
  );
});

test("planSendTokens routes to hydra when asked", () => {
  assert.equal(must(planSendTokens(sendTokens({ hydra: true }), ctx())).route, "hydra");
});

/* --------------------------------- mint ---------------------------------- */

test("planMint mints to the wallet by default, with min-ADA alongside", () => {
  const plan = must(planMint(mint(), policy, ctx()));
  assert.equal(plan.kind, "mint");
  assert.equal(plan.outputs.length, 1);
  assert.equal(plan.outputs[0]?.address, FROM);
  assert.deepEqual(plan.mint, {
    script: policy.script,
    policyId: POLICY_ID,
    assets: { [UNIT]: 100n },
  });
  assert.equal(plan.outputs[0]?.assets[UNIT], 100n);
  assert.equal(plan.outputs[0]?.assets[LOVELACE], estimateMinAda({ [UNIT]: 100n }));
});

test("planMint honours an explicit destination", () => {
  const plan = must(planMint(mint({ to: TO }), policy, ctx()));
  assert.equal(plan.outputs[0]?.address, TESTNET);
});

test("planMint caps validToSlot at two hours from now", () => {
  const plan = must(planMint(mint(), policy, ctx({ currentSlot: 1_000 })));
  assert.equal(plan.validToSlot, 1_000 + MINT_VALIDITY_WINDOW_SLOTS);
  assert.equal(MINT_VALIDITY_WINDOW_SLOTS, 7_200);
  assert.ok((plan.validToSlot ?? 0) > 1_000);
  assert.ok((plan.validToSlot ?? 0) < 100_000);
});

test("planMint clamps validToSlot to just before the policy locks", () => {
  const plan = must(planMint(mint(), policy, ctx({ currentSlot: 99_000 })));
  assert.equal(plan.validToSlot, 99_999);
});

test("planMint refuses a locked policy", () => {
  for (const slot of [100_000, 100_001, 500_000]) {
    const r = planMint(mint(), policy, ctx({ currentSlot: slot }));
    assert.equal(code(r), "INVALID_REQUEST");
    assert.match(r.ok === false ? r.error.message : "", /policy is locked/);
  }
});

test("planMint refuses a policy with no validity window left", () => {
  const r = planMint(mint(), policy, ctx({ currentSlot: 99_999 }));
  assert.equal(code(r), "INVALID_REQUEST");
  assert.match(r.ok === false ? r.error.message : "", /no validity window/);
});

test("planMint omits validToSlot for a policy that never expires", () => {
  const forever: PolicyInfo = {
    policyId: POLICY_ID,
    script: { type: "sig", keyHash: KEY_HASH },
    keyHash: KEY_HASH,
  };
  const plan = must(planMint(mint(), forever, ctx()));
  assert.equal(plan.validToSlot, undefined);
});

test("planMint falls back to the script's own before slot", () => {
  const inconsistent: PolicyInfo = {
    policyId: POLICY_ID,
    script: sigAndBeforePolicy(KEY_HASH, 2_000),
    keyHash: KEY_HASH,
  };
  assert.equal(must(planMint(mint(), inconsistent, ctx())).validToSlot, 1_999);
  assert.equal(code(planMint(mint(), inconsistent, ctx({ currentSlot: 2_000 }))), "INVALID_REQUEST");
});

test("planMint rejects a policy id that does not match the request", () => {
  const r = planMint(mint({ policyId: "f".repeat(56) }), policy, ctx());
  assert.equal(code(r), "INVALID_REQUEST");
  assert.match(r.ok === false ? r.error.message : "", /policy id mismatch/);
});

test("planMint attaches CIP-25 under label 721", () => {
  const plan = must(planMint(mint({ cip25: { name: "Token #1" } }), policy, ctx()));
  assert.equal(plan.metadata?.length, 1);
  assert.equal(plan.metadata?.[0]?.label, METADATA_LABEL_CIP25);
  const value = plan.metadata?.[0]?.value as Record<string, unknown>;
  assert.equal(value.version, 2n);
  assert.ok(Object.hasOwn(value, POLICY_ID));
});

test("planMint propagates a CIP-25 validation failure", () => {
  assert.equal(
    code(planMint(mint({ cip25: { name: "n".repeat(65) } }), policy, ctx())),
    "INVALID_METADATA",
  );
});

test("planMint routes to hydra when asked", () => {
  assert.equal(must(planMint(mint({ hydra: true }), policy, ctx())).route, "hydra");
});

/* ------------------------------- checkFunds ------------------------------ */

test("checkFunds passes when the wallet covers outputs plus the fee", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  const r = must(checkFunds(plan, { [LOVELACE]: 100_000_000n }));
  const expectedFee = estimateFee(estimateSimpleTxBytes(2, 1, false, 0));
  assert.equal(r.estimatedFee, expectedFee);
  assert.deepEqual(r.minAdaPerOutput, [estimateMinAda({ [LOVELACE]: 1_500_000n })]);
});

test("checkFunds includes a change output and the fee in its size estimate", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  const exactly = 1_500_000n + estimateFee(estimateSimpleTxBytes(2, 1, false, 0));
  assert.equal(checkFunds(plan, { [LOVELACE]: exactly }).ok, true);
  assert.equal(code(checkFunds(plan, { [LOVELACE]: exactly - 1n })), "INSUFFICIENT_FUNDS");
});

test("checkFunds reports required and available in the details", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  const r = checkFunds(plan, { [LOVELACE]: 1_000_000n });
  assert.equal(code(r), "INSUFFICIENT_FUNDS");
  const details = r.ok === false ? (r.error.details as { required: Assets; available: Assets }) : null;
  assert.equal(details?.available[LOVELACE], 1_000_000n);
  assert.ok((details?.required[LOVELACE] ?? 0n) > 1_500_000n);
});

test("checkFunds does not ask the wallet for the tokens it is about to mint", () => {
  const plan = must(planMint(mint(), policy, ctx()));
  const r = checkFunds(plan, { [LOVELACE]: 10_000_000n });
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  // The same plan with the mint stripped out does require the tokens.
  const noMint: TxPlan = { ...plan };
  delete noMint.mint;
  assert.equal(code(checkFunds(noMint, { [LOVELACE]: 10_000_000n })), "INSUFFICIENT_FUNDS");
});

test("checkFunds does require non-minted tokens in an output", () => {
  const plan = must(planSendTokens(sendTokens(), ctx()));
  assert.equal(code(checkFunds(plan, { [LOVELACE]: 10_000_000n })), "INSUFFICIENT_FUNDS");
  assert.equal(checkFunds(plan, { [LOVELACE]: 10_000_000n, [UNIT]: 5n }).ok, true);
  assert.equal(code(checkFunds(plan, { [LOVELACE]: 10_000_000n, [UNIT]: 4n })), "INSUFFICIENT_FUNDS");
});

test("checkFunds requires burned tokens to be in the wallet", () => {
  const plan = must(planMint(mint(), policy, ctx()));
  const burn: TxPlan = {
    ...plan,
    outputs: [{ address: FROM, assets: { [LOVELACE]: 2_000_000n } }],
    mint: { script: policy.script, policyId: POLICY_ID, assets: { [UNIT]: -10n } },
  };
  assert.equal(code(checkFunds(burn, { [LOVELACE]: 10_000_000n })), "INSUFFICIENT_FUNDS");
  assert.equal(checkFunds(burn, { [LOVELACE]: 10_000_000n, [UNIT]: 10n }).ok, true);
});

test("checkFunds charges more for a minting transaction with metadata", () => {
  const plain = must(planMint(mint(), policy, ctx()));
  const withMeta = must(planMint(mint({ cip25: { name: "Token #1" } }), policy, ctx()));
  const plainFee = must(checkFunds(plain, { [LOVELACE]: 100_000_000n })).estimatedFee;
  const metaFee = must(checkFunds(withMeta, { [LOVELACE]: 100_000_000n })).estimatedFee;
  assert.ok(metaFee > plainFee);
});

test("checkFunds honours custom protocol params", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  const cheap = must(
    checkFunds(plan, { [LOVELACE]: 100_000_000n }, { ...CONWAY_DEFAULT_PARAMS, minFeeA: 0, minFeeB: 0 }),
  );
  assert.equal(cheap.estimatedFee, 0n);
});

test("estimatePlanMetadataBytes is zero without metadata and grows with it", () => {
  const plain = must(planSendAda(sendAda(), ctx()));
  assert.equal(estimatePlanMetadataBytes(plain), 0);
  const withMeta = must(planSendAda(sendAda({ metadata: { msg: ["hello"] } }), ctx()));
  assert.ok(estimatePlanMetadataBytes(withMeta) > 0);
  const withBig = must(
    planSendAda(sendAda({ metadata: { msg: ["x".repeat(60), "y".repeat(60)], n: 5n } }), ctx()),
  );
  assert.ok(estimatePlanMetadataBytes(withBig) > estimatePlanMetadataBytes(withMeta));
});

/* ------------------------------ describePlan ----------------------------- */

test("describePlan is a one-line summary with a truncated address", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  assert.equal(
    describePlan(plan),
    "send-ada via l1 on Preview: 1.5 ADA → addr_test1qz…68faae",
  );
});

test("describePlan never contains the full address", () => {
  const plan = must(planSendAda(sendAda(), ctx()));
  const line = describePlan(plan);
  assert.equal(line.includes(TESTNET), false);
  assert.ok(line.includes("addr_test1qz…68faae"));
});

test("describePlan lists tokens, the policy, slots and metadata labels", () => {
  const plan = must(planMint(mint({ cip25: { name: "Token #1" } }), policy, ctx()));
  const line = describePlan(plan);
  assert.ok(line.startsWith("mint via l1 on Preview: "));
  assert.ok(line.includes(`100 ${UNIT}`));
  assert.ok(line.includes(`under policy ${POLICY_ID}`));
  assert.ok(line.includes("validTo slot 8200"));
  assert.ok(line.includes("metadata labels 721"));
});

test("describePlan shows the hydra route", () => {
  const plan = must(planSendTokens(sendTokens({ hydra: true }), ctx()));
  assert.ok(describePlan(plan).startsWith("send-tokens via hydra on Preview: "));
});

test("describePlan contains no mnemonic, key hash, script or CBOR", () => {
  const plan = must(planMint(mint({ cip25: { name: "Token #1" } }), policy, ctx()));
  const line = describePlan(plan);
  assert.equal(line.includes(KEY_HASH), false);
  assert.equal(line.toLowerCase().includes("keyhash"), false);
  assert.equal(line.includes("sig"), false);
  assert.equal(line.includes("abandon"), false);
});

test("describePlan handles an output with nothing in it", () => {
  const plan: TxPlan = {
    kind: "send-ada",
    network: "Mainnet",
    route: "l1",
    from: FROM,
    outputs: [{ address: FROM, assets: {} }],
  };
  assert.match(describePlan(plan), /nothing →/);
});
