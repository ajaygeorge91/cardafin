// The lucid adapter's one testable half. No lucid, no blockfrost, no network:
// a recording fake stands in for `TxBuilder` and the assertions are about
// which builder calls a plan produces, in what order, with what arguments.
//
// These plans come from the real core planners (and, for the mint, the real
// MemoryLedger/MemoryKeys), so the shapes under test are the shapes the
// service layer actually hands the executor.

import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, assetNameToHex, toUnit } from "../../core/assets.ts";
import { isCardafinError } from "../../core/errors.ts";
import { CONWAY_DEFAULT_PARAMS } from "../../core/fees.ts";
import {
  METADATA_LABEL_CIP25,
  METADATA_LABEL_MESSAGE,
} from "../../core/metadata.ts";
import type { Metadatum } from "../../core/metadata.ts";
import { sigAndBeforePolicy } from "../../core/native-script.ts";
import type { NativeScript } from "../../core/native-script.ts";
import type { PlanContext, PolicyInfo, TxPlan } from "../../core/plan.ts";
import { planMint, planSendAda, planSendTokens } from "../../core/plan.ts";
import {
  validateMint,
  validateSendAda,
  validateSendTokens,
} from "../../core/requests.ts";
import { unwrap } from "../../core/result.ts";
import { MemoryKeys } from "../memory/keys.ts";
import type { MinimalTxBuilder } from "./translate.ts";
import { applyPlan, metadatumToLucid } from "./translate.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;
const CURRENT_SLOT = 1_000;
const LOCK_SLOT = 5_000;

type Call = { method: string; args: readonly unknown[] };

/** A `MinimalTxBuilder` that records calls and returns itself, as lucid's does. */
function recorder(): { builder: MinimalTxBuilder; calls: Call[] } {
  const calls: Call[] = [];
  const push = (method: string, args: readonly unknown[]): MinimalTxBuilder => {
    calls.push({ method, args });
    return builder;
  };
  const builder: MinimalTxBuilder = {
    pay: {
      ToAddress(address, assets) {
        return push("pay.ToAddress", [address, assets]);
      },
    },
    mintAssets(assets) {
      return push("mintAssets", [assets]);
    },
    attach: {
      MintingPolicy(script) {
        return push("attach.MintingPolicy", [script]);
      },
    },
    validTo(unixTimeMs) {
      return push("validTo", [unixTimeMs]);
    },
    attachMetadata(label, metadata) {
      return push("attachMetadata", [label, metadata]);
    },
  };
  return { builder, calls };
}

/** Deterministic stand-ins for lucid's slot clock and script serialiser. */
function deps() {
  const scripts: NativeScript[] = [];
  const slots: number[] = [];
  return {
    scripts,
    slots,
    slotToUnixTime(slot: number): number {
      slots.push(slot);
      // Any invertible mapping does; the executor passes lucid's real one.
      return 1_666_000_000_000 + slot * 1_000;
    },
    scriptFromNative(script: NativeScript): unknown {
      scripts.push(script);
      return { type: "Native", script: "fake-cbor" };
    },
  };
}

const keys = new MemoryKeys();

async function addresses() {
  const me = await keys.deriveWallet(THROWAWAY_MNEMONIC, 0, "Preview");
  const other = await keys.deriveWallet(THROWAWAY_MNEMONIC, 1, "Preview");
  return { me, other };
}

function ctx(from: string): PlanContext {
  return {
    network: "Preview",
    from,
    available: { [LOVELACE]: 100_000_000n },
    currentSlot: CURRENT_SLOT,
    params: CONWAY_DEFAULT_PARAMS,
  };
}

function methods(calls: readonly Call[]): string[] {
  return calls.map((c) => c.method);
}

// --- send-ada -------------------------------------------------------------

test("a send-ada plan becomes exactly one pay.ToAddress", async () => {
  const { me, other } = await addresses();
  const plan = unwrap(
    planSendAda(
      unwrap(validateSendAda({ to: other.address, amount: "2.5" }, "Preview")),
      ctx(me.address),
    ),
  );

  const { builder, calls } = recorder();
  const d = deps();
  const result = applyPlan(builder, plan, d);

  assert.equal(result, builder, "applyPlan should return the (self-returning) builder");
  assert.deepEqual(methods(calls), ["pay.ToAddress"]);
  assert.deepEqual(calls[0]?.args, [other.address, { [LOVELACE]: 2_500_000n }]);
  assert.deepEqual(d.slots, [], "an ADA send has no validity bound");
  assert.deepEqual(d.scripts, [], "an ADA send attaches no script");
});

test("a send-ada memo becomes attachMetadata under the CIP-20 label, after the output", async () => {
  const { me, other } = await addresses();
  const plan = unwrap(
    planSendAda(
      unwrap(
        validateSendAda(
          { to: other.address, amount: "2", metadata: "invoice 42" },
          "Preview",
        ),
      ),
      ctx(me.address),
    ),
  );

  const { builder, calls } = recorder();
  applyPlan(builder, plan, deps());

  assert.deepEqual(methods(calls), ["pay.ToAddress", "attachMetadata"]);
  assert.equal(calls[1]?.args[0], METADATA_LABEL_MESSAGE);
  assert.deepEqual(calls[1]?.args[1], { msg: ["invoice 42"] });
});

test("the assets handed to the builder are a copy, not the plan's own object", async () => {
  const { me, other } = await addresses();
  const plan = unwrap(
    planSendAda(
      unwrap(validateSendAda({ to: other.address, amount: "2" }, "Preview")),
      ctx(me.address),
    ),
  );

  const { builder, calls } = recorder();
  applyPlan(builder, plan, deps());

  const passed = calls[0]?.args[1] as Record<string, bigint>;
  assert.deepEqual(passed, plan.outputs[0]?.assets);
  assert.notEqual(passed, plan.outputs[0]?.assets);
});

// --- send-tokens ----------------------------------------------------------

test("a send-tokens plan pays the token plus its min-ADA in one output", async () => {
  const { me, other } = await addresses();
  const policyId = keys.nativeScriptPolicyId(sigAndBeforePolicy(me.paymentKeyHash, LOCK_SLOT));
  const unit = unwrap(toUnit(policyId, unwrap(assetNameToHex("cardafin"))));
  const plan = unwrap(
    planSendTokens(
      unwrap(
        validateSendTokens({ to: other.address, assets: { [unit]: "7" } }, "Preview"),
      ),
      ctx(me.address),
    ),
  );

  const { builder, calls } = recorder();
  applyPlan(builder, plan, deps());

  assert.deepEqual(methods(calls), ["pay.ToAddress"]);
  const assets = calls[0]?.args[1] as Record<string, bigint>;
  assert.equal(assets[unit], 7n);
  assert.ok((assets[LOVELACE] ?? 0n) > 0n, "a token output must carry min-ADA");
});

// --- mint -----------------------------------------------------------------

async function mintPlan(withCip25: boolean): Promise<{
  plan: TxPlan;
  policy: PolicyInfo;
  unit: string;
  to: string;
}> {
  const { me, other } = await addresses();
  const script = sigAndBeforePolicy(me.paymentKeyHash, LOCK_SLOT);
  const policy: PolicyInfo = {
    policyId: keys.nativeScriptPolicyId(script),
    script,
    keyHash: me.paymentKeyHash,
    lockBeforeSlot: LOCK_SLOT,
  };
  const assetNameHex = unwrap(assetNameToHex("cardafin"));
  const req = unwrap(
    validateMint(
      {
        policyId: policy.policyId,
        assetName: "cardafin",
        quantity: "1000",
        to: other.address,
        ...(withCip25 ? { cip25: { name: "cardafin token" } } : {}),
      },
      "Preview",
    ),
  );
  return {
    plan: unwrap(planMint(req, policy, ctx(me.address))),
    policy,
    unit: unwrap(toUnit(policy.policyId, assetNameHex)),
    to: other.address,
  };
}

test("a mint plan becomes output, mintAssets, attached policy, validTo — in that order", async () => {
  const { plan, policy, unit, to } = await mintPlan(false);

  const { builder, calls } = recorder();
  const d = deps();
  applyPlan(builder, plan, d);

  assert.deepEqual(methods(calls), [
    "pay.ToAddress",
    "mintAssets",
    "attach.MintingPolicy",
    "validTo",
  ]);

  assert.equal(calls[0]?.args[0], to);
  assert.equal((calls[0]?.args[1] as Record<string, bigint>)[unit], 1000n);
  assert.deepEqual(calls[1]?.args[0], { [unit]: 1000n });
  assert.deepEqual(calls[2]?.args[0], { type: "Native", script: "fake-cbor" });

  // The slot the plan chose, mapped through the injected clock — never a
  // wall-clock guess made inside the adapter.
  assert.deepEqual(d.scripts, [policy.script]);
  assert.deepEqual(d.slots, [plan.validToSlot]);
  assert.equal(calls[3]?.args[0], d.slotToUnixTime(plan.validToSlot ?? 0));
});

test("CIP-25 metadata is attached last, under label 721, with version as a number", async () => {
  const { plan } = await mintPlan(true);

  const { builder, calls } = recorder();
  applyPlan(builder, plan, deps());

  assert.deepEqual(methods(calls), [
    "pay.ToAddress",
    "mintAssets",
    "attach.MintingPolicy",
    "validTo",
    "attachMetadata",
  ]);
  assert.equal(calls[4]?.args[0], METADATA_LABEL_CIP25);
  const payload = calls[4]?.args[1] as Record<string, unknown>;
  // core emits `version: 2n`; lucid cannot take a bigint.
  assert.equal(payload.version, 2);
  assert.equal(typeof payload.version, "number");
});

test("a burn plan passes the negative quantity through untouched", async () => {
  const { me } = await addresses();
  const script = sigAndBeforePolicy(me.paymentKeyHash, LOCK_SLOT);
  const policyId = keys.nativeScriptPolicyId(script);
  const unit = unwrap(toUnit(policyId, unwrap(assetNameToHex("cardafin"))));
  // Hand-written: core's planners build mints, and a burn plan is the same
  // shape with a negative quantity and no output for the burnt asset.
  const plan: TxPlan = {
    kind: "mint",
    network: "Preview",
    route: "l1",
    from: me.address,
    outputs: [{ address: me.address, assets: { [LOVELACE]: 2_000_000n } }],
    mint: { script, policyId, assets: { [unit]: -5n } },
    validToSlot: 2_000,
  };

  const { builder, calls } = recorder();
  applyPlan(builder, plan, deps());

  assert.deepEqual(methods(calls), [
    "pay.ToAddress",
    "mintAssets",
    "attach.MintingPolicy",
    "validTo",
  ]);
  assert.deepEqual(calls[1]?.args[0], { [unit]: -5n });
});

test("a plan with several outputs and several metadata entries keeps its order", () => {
  const plan: TxPlan = {
    kind: "send-ada",
    network: "Preview",
    route: "l1",
    from: "addr_test1from",
    outputs: [
      { address: "addr_test1a", assets: { [LOVELACE]: 1_000_000n } },
      { address: "addr_test1b", assets: { [LOVELACE]: 2_000_000n } },
    ],
    metadata: [
      { label: 674, value: { msg: ["one"] } },
      { label: 1337, value: 42n },
    ],
  };

  const { builder, calls } = recorder();
  applyPlan(builder, plan, deps());

  assert.deepEqual(methods(calls), [
    "pay.ToAddress",
    "pay.ToAddress",
    "attachMetadata",
    "attachMetadata",
  ]);
  assert.equal(calls[0]?.args[0], "addr_test1a");
  assert.equal(calls[1]?.args[0], "addr_test1b");
  assert.equal(calls[2]?.args[0], 674);
  assert.equal(calls[3]?.args[0], 1337);
  assert.equal(calls[3]?.args[1], 42);
});

// --- metadatumToLucid -----------------------------------------------------

test("metadatumToLucid converts bigints to numbers and leaves strings alone", () => {
  assert.equal(metadatumToLucid("hello"), "hello");
  assert.equal(metadatumToLucid(0n), 0);
  assert.equal(metadatumToLucid(-1n), -1);
  assert.equal(metadatumToLucid(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  assert.equal(metadatumToLucid(BigInt(Number.MIN_SAFE_INTEGER)), Number.MIN_SAFE_INTEGER);
});

test("metadatumToLucid recurses through arrays and maps", () => {
  const input: Metadatum = {
    name: "cardafin",
    chunks: ["a", "b"],
    nested: { count: 3n, list: [1n, { deep: "x" }] },
  };
  assert.deepEqual(metadatumToLucid(input), {
    name: "cardafin",
    chunks: ["a", "b"],
    nested: { count: 3, list: [1, { deep: "x" }] },
  });
});

test("metadatumToLucid produces no bigint anywhere in its output", () => {
  const out = metadatumToLucid({ a: [1n, 2n], b: { c: 3n } });
  assert.equal(JSON.stringify(out), '{"a":[1,2],"b":{"c":3}}');
});

test("a bigint past the safe integer range is INVALID_METADATA, not a silent rounding", () => {
  const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
  assert.throws(
    () => metadatumToLucid(tooBig),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "INVALID_METADATA");
      assert.match(e.message, /safe integer range/);
      return true;
    },
  );
  assert.throws(
    () => metadatumToLucid(BigInt(Number.MIN_SAFE_INTEGER) - 1n),
    (e: unknown) => isCardafinError(e) && e.code === "INVALID_METADATA",
  );
});

test("an unsafe bigint buried in a nested metadatum is still rejected, with its path", () => {
  assert.throws(
    () => metadatumToLucid({ outer: [{ inner: 2n ** 70n }] }),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "INVALID_METADATA");
      assert.match(e.message, /\$\.outer\[0\]\.inner/);
      return true;
    },
  );
});

test("applyPlan refuses a plan whose metadata cannot be represented, before any builder call", () => {
  const plan: TxPlan = {
    kind: "send-ada",
    network: "Preview",
    route: "l1",
    from: "addr_test1from",
    outputs: [],
    metadata: [{ label: 674, value: 2n ** 80n }],
  };
  const { builder, calls } = recorder();
  assert.throws(
    () => applyPlan(builder, plan, deps()),
    (e: unknown) => isCardafinError(e) && e.code === "INVALID_METADATA",
  );
  assert.deepEqual(methods(calls), [], "nothing should have been attached");
});
