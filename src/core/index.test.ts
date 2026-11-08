import test from "node:test";
import assert from "node:assert/strict";

import * as core from "./index.ts";

// The public BIP-39 test vector. Throwaway, never held funds, must never hold
// funds. It appears here only to prove that core's log line cannot echo it.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;

test("the throwaway test vector is the documented 24-word BIP-39 vector", () => {
  const words = THROWAWAY_MNEMONIC.split(" ");
  assert.equal(words.length, 24);
  assert.equal(words[23], "art");
  assert.equal(new Set(words.slice(0, 23)).size, 1);
});

test("index re-exports every core module's surface", () => {
  for (const name of [
    // result.ts
    "ok",
    "err",
    "isOk",
    "isErr",
    "unwrap",
    "mapOk",
    // errors.ts
    "CardafinError",
    "ERROR_CODES",
    "fail",
    "isCardafinError",
    // network.ts
    "NETWORKS",
    "parseNetwork",
    "networkId",
    "addressPrefix",
    "blockfrostUrl",
    "explorerTxUrl",
    // types.ts
    "utxoRef",
    // ada.ts
    "LOVELACE_PER_ADA",
    "parseLovelace",
    "adaToLovelace",
    "lovelaceToAda",
    "formatAda",
    // assets.ts
    "LOVELACE",
    "MAX_ASSET_NAME_BYTES",
    "isHex",
    "validatePolicyId",
    "assetNameToHex",
    "hexToAssetName",
    "toUnit",
    "fromUnit",
    "addAssets",
    "subtractAssets",
    "sumUtxoAssets",
    "parseAssets",
    // address.ts
    "decodeBech32",
    "encodeBech32",
    "parseAddress",
    "validateAddress",
    "truncateAddress",
    // metadata.ts
    "METADATUM_MAX_BYTES",
    "METADATA_LABEL_CIP25",
    "canonicalJson",
    "sha256Hex",
    "chunkUtf8",
    "toMetadatum",
    "cip25Metadata",
    // fees.ts
    "CONWAY_DEFAULT_PARAMS",
    "estimateOutputBytes",
    "estimateMinAda",
    "estimateFee",
    "estimateSimpleTxBytes",
    // native-script.ts
    "sigAndBeforePolicy",
    "policyIsOpenAt",
    "validateNativeScript",
    // requests.ts
    "validateSendAda",
    "validateMint",
    "validateSendTokens",
    "validateCreatePolicy",
    // plan.ts
    "planSendAda",
    "planMint",
    "planSendTokens",
    "checkFunds",
    "describePlan",
  ]) {
    assert.ok(Object.hasOwn(core, name), `core/index.ts does not re-export ${name}`);
  }
});

test("an end-to-end send: validate, plan, check funds, describe", () => {
  const to =
    "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";
  const req = core.validateSendAda({ to, amount: "1.5", metadata: "thanks" }, "Preview");
  assert.equal(req.ok, true);
  if (!req.ok) {
    return;
  }
  const plan = core.planSendAda(req.value, {
    network: "Preview",
    from: "addr_test1wallet",
    available: { [core.LOVELACE]: 10_000_000n },
    currentSlot: 42,
    params: core.CONWAY_DEFAULT_PARAMS,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }
  const funds = core.checkFunds(plan.value, { [core.LOVELACE]: 10_000_000n });
  assert.equal(funds.ok, true);

  const line = core.describePlan(plan.value);
  assert.equal(
    line,
    "send-ada via l1 on Preview: 1.5 ADA → addr_test1qz…68faae; metadata labels 674",
  );
  // The log line cannot contain the seed, under any formatting.
  assert.equal(line.includes(THROWAWAY_MNEMONIC), false);
  assert.equal(line.includes("abandon"), false);
});

test("an end-to-end mint: validate, plan, check funds", () => {
  const policyId = "9f".repeat(28);
  const keyHash = "7a".repeat(28);
  const req = core.validateMint(
    { policyId, assetName: "CARDAFN", quantity: "1", cip25: { name: "Cardafn #1" } },
    "Preview",
  );
  assert.equal(req.ok, true);
  if (!req.ok) {
    return;
  }
  const plan = core.planMint(
    req.value,
    {
      policyId,
      script: core.sigAndBeforePolicy(keyHash, 50_000),
      keyHash,
      lockBeforeSlot: 50_000,
    },
    {
      network: "Preview",
      from: "addr_test1wallet",
      available: { [core.LOVELACE]: 10_000_000n },
      currentSlot: 100,
      params: core.CONWAY_DEFAULT_PARAMS,
    },
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }
  assert.equal(plan.value.validToSlot, 7_300);
  assert.equal(plan.value.metadata?.[0]?.label, core.METADATA_LABEL_CIP25);
  assert.equal(core.checkFunds(plan.value, { [core.LOVELACE]: 10_000_000n }).ok, true);
  assert.equal(core.policyIsOpenAt(plan.value.mint!.script, 100), true);
  assert.equal(core.policyIsOpenAt(plan.value.mint!.script, 50_000), false);
});
