import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_POLICY_LOCK_SECONDS,
  messageMetadatum,
  validateCreatePolicy,
  validateMint,
  validateSendAda,
  validateSendTokens,
} from "./requests.ts";
import { LOVELACE, assetNameToHex, toUnit } from "./assets.ts";
import { encodeRewardAddress } from "./address.ts";
import type { Metadatum } from "./metadata.ts";

// Real, public addresses. No keys, no funds of ours.
const MAINNET =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const TESTNET =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";

const POLICY = "d".repeat(56);

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

function code(r: { ok: true } | { ok: false; error: { code: string } }): string {
  assert.equal(r.ok, false);
  return r.ok ? "" : r.error.code;
}

const UNIT = must(toUnit(POLICY, must(assetNameToHex("TOKEN"))));

test("DEFAULT_POLICY_LOCK_SECONDS is 365 days", () => {
  assert.equal(DEFAULT_POLICY_LOCK_SECONDS, 31_536_000);
});

/* ------------------------------- send-ada -------------------------------- */

test("validateSendAda accepts an ADA decimal string", () => {
  const r = must(validateSendAda({ to: TESTNET, amount: "1.5" }, "Preview"));
  assert.equal(r.lovelace, 1_500_000n);
  assert.equal(r.to.bech32, TESTNET);
  assert.equal(r.to.networkId, 0);
  assert.equal(r.hydra, false);
  assert.equal(r.metadata, undefined);
});

test("validateSendAda accepts an explicit lovelace object", () => {
  const r = must(validateSendAda({ to: TESTNET, amount: { lovelace: "1500000" } }, "Preview"));
  assert.equal(r.lovelace, 1_500_000n);
  assert.equal(must(validateSendAda({ to: TESTNET, amount: { lovelace: 7n } }, "Preview")).lovelace, 7n);
});

test("validateSendAda defaults hydra to false and accepts a boolean", () => {
  assert.equal(must(validateSendAda({ to: TESTNET, amount: "1" }, "Preview")).hydra, false);
  assert.equal(
    must(validateSendAda({ to: TESTNET, amount: "1", hydra: true }, "Preview")).hydra,
    true,
  );
  assert.equal(code(validateSendAda({ to: TESTNET, amount: "1", hydra: "yes" }, "Preview")), "INVALID_REQUEST");
  assert.equal(code(validateSendAda({ to: TESTNET, amount: "1", hydra: 1 }, "Preview")), "INVALID_REQUEST");
});

test("validateSendAda turns a string memo into the CIP-20 { msg: chunks } shape", () => {
  const r = must(
    validateSendAda({ to: TESTNET, amount: "1", metadata: "thanks!" }, "Preview"),
  );
  assert.deepEqual(r.metadata, { msg: ["thanks!"] });

  const long = "x".repeat(150);
  const chunked = must(
    validateSendAda({ to: TESTNET, amount: "1", metadata: long }, "Preview"),
  );
  const msg = (chunked.metadata as { msg: string[] }).msg;
  assert.deepEqual(msg.map((c) => c.length), [64, 64, 22]);
  assert.equal(msg.join(""), long);
});

test("validateSendAda passes a non-string metadatum through unchanged", () => {
  const r = must(
    validateSendAda({ to: TESTNET, amount: "1", metadata: { order: 7, note: "ok" } }, "Preview"),
  );
  assert.deepEqual(r.metadata, { note: "ok", order: 7n });
});

test("validateSendAda rejects metadata that has no metadatum representation", () => {
  assert.equal(
    code(validateSendAda({ to: TESTNET, amount: "1", metadata: { flag: true } }, "Preview")),
    "INVALID_METADATA",
  );
  assert.equal(
    code(validateSendAda({ to: TESTNET, amount: "1", metadata: { n: 1.5 } }, "Preview")),
    "INVALID_METADATA",
  );
});

test("validateSendAda rejects the wrong network, reward addresses and junk", () => {
  assert.equal(code(validateSendAda({ to: MAINNET, amount: "1" }, "Preview")), "WRONG_NETWORK");
  assert.equal(code(validateSendAda({ to: TESTNET, amount: "1" }, "Mainnet")), "WRONG_NETWORK");
  const stake = must(encodeRewardAddress(0, "ab".repeat(28)));
  assert.equal(code(validateSendAda({ to: stake, amount: "1" }, "Preview")), "INVALID_ADDRESS");
  assert.equal(code(validateSendAda({ to: "nope", amount: "1" }, "Preview")), "INVALID_ADDRESS");
  assert.equal(code(validateSendAda({ to: "", amount: "1" }, "Preview")), "INVALID_REQUEST");
  assert.equal(code(validateSendAda({ amount: "1" }, "Preview")), "INVALID_REQUEST");
});

test("validateSendAda rejects bad amounts", () => {
  assert.equal(code(validateSendAda({ to: TESTNET }, "Preview")), "INVALID_REQUEST");
  assert.equal(code(validateSendAda({ to: TESTNET, amount: 1.5 }, "Preview")), "INVALID_REQUEST");
  assert.equal(code(validateSendAda({ to: TESTNET, amount: "1.0000001" }, "Preview")), "INVALID_AMOUNT");
  assert.equal(code(validateSendAda({ to: TESTNET, amount: "-1" }, "Preview")), "INVALID_AMOUNT");
  assert.equal(code(validateSendAda({ to: TESTNET, amount: {} }, "Preview")), "INVALID_REQUEST");
  assert.equal(
    code(validateSendAda({ to: TESTNET, amount: { lovelace: "1.5" } }, "Preview")),
    "INVALID_AMOUNT",
  );
  assert.equal(
    code(validateSendAda({ to: TESTNET, amount: { lovelace: "1", ada: "2" } }, "Preview")),
    "INVALID_REQUEST",
  );
});

test("validateSendAda names an unknown top-level field", () => {
  const r = validateSendAda({ to: TESTNET, amount: "1", recipient: "x" }, "Preview");
  assert.equal(code(r), "INVALID_REQUEST");
  assert.match(r.ok === false ? r.error.message : "", /unknown field "recipient"/);
  assert.deepEqual(
    r.ok === false ? (r.error.details as { field: string }).field : "",
    "recipient",
  );
});

test("validateSendAda rejects non-objects", () => {
  for (const bad of [null, undefined, [], "x", 5]) {
    assert.equal(code(validateSendAda(bad, "Preview")), "INVALID_REQUEST");
  }
});

/* ----------------------------- create-policy ----------------------------- */

test("validateCreatePolicy defaults to 365 days when nothing is given", () => {
  assert.deepEqual(must(validateCreatePolicy({})), {
    lockInSeconds: DEFAULT_POLICY_LOCK_SECONDS,
  });
  assert.deepEqual(must(validateCreatePolicy(undefined)), {
    lockInSeconds: DEFAULT_POLICY_LOCK_SECONDS,
  });
});

test("validateCreatePolicy accepts either knob, never both", () => {
  assert.deepEqual(must(validateCreatePolicy({ lockInSeconds: 3600 })), {
    lockInSeconds: 3600,
  });
  assert.deepEqual(must(validateCreatePolicy({ lockBeforeSlot: 1234 })), {
    lockBeforeSlot: 1234,
    lockInSeconds: DEFAULT_POLICY_LOCK_SECONDS,
  });
  const both = validateCreatePolicy({ lockBeforeSlot: 1, lockInSeconds: 2 });
  assert.equal(code(both), "INVALID_REQUEST");
  assert.match(both.ok === false ? both.error.message : "", /not both/);
});

test("validateCreatePolicy rejects bad numbers and unknown fields", () => {
  for (const slot of [-1, 1.5, "100", null]) {
    assert.equal(code(validateCreatePolicy({ lockBeforeSlot: slot })), "INVALID_REQUEST");
  }
  for (const seconds of [0, -1, 1.5, "3600"]) {
    assert.equal(code(validateCreatePolicy({ lockInSeconds: seconds })), "INVALID_REQUEST");
  }
  assert.equal(code(validateCreatePolicy({ lockForever: true })), "INVALID_REQUEST");
  assert.equal(code(validateCreatePolicy([])), "INVALID_REQUEST");
});

/* --------------------------------- mint ---------------------------------- */

test("validateMint normalises the asset name to hex and the quantity to bigint", () => {
  const r = must(
    validateMint({ policyId: POLICY, assetName: "TOKEN", quantity: "100" }, "Preview"),
  );
  assert.equal(r.policyId, POLICY);
  assert.equal(r.assetName, "TOKEN");
  assert.equal(r.assetNameHex, "544f4b454e");
  assert.equal(r.quantity, 100n);
  assert.equal(r.hydra, false);
  assert.equal(r.to, undefined);
  assert.equal(r.cip25, undefined);
});

test("validateMint accepts assetNameHex instead of assetName", () => {
  const r = must(
    validateMint({ policyId: POLICY, assetNameHex: "544f4b454e", quantity: 5 }, "Preview"),
  );
  assert.equal(r.assetNameHex, "544f4b454e");
  assert.equal(
    code(
      validateMint(
        { policyId: POLICY, assetName: "TOKEN", assetNameHex: "544f4b454e", quantity: 5 },
        "Preview",
      ),
    ),
    "INVALID_REQUEST",
  );
});

test("validateMint validates the destination address against the network", () => {
  const r = must(
    validateMint({ policyId: POLICY, assetName: "T", quantity: "1", to: TESTNET }, "Preview"),
  );
  assert.equal(r.to?.bech32, TESTNET);
  assert.equal(
    code(validateMint({ policyId: POLICY, assetName: "T", quantity: "1", to: MAINNET }, "Preview")),
    "WRONG_NETWORK",
  );
});

test("validateMint keeps cip25 fields as Json for later chunking", () => {
  const r = must(
    validateMint(
      {
        policyId: POLICY,
        assetName: "T",
        quantity: "1",
        cip25: { name: "Token #1", image: "ipfs://abc", edition: 3 },
      },
      "Preview",
    ),
  );
  assert.deepEqual(r.cip25, { name: "Token #1", image: "ipfs://abc", edition: 3 });
});

test("validateMint rejects a cip25 block without a name or with bad values", () => {
  assert.equal(
    code(validateMint({ policyId: POLICY, assetName: "T", quantity: "1", cip25: {} }, "Preview")),
    "INVALID_REQUEST",
  );
  assert.equal(
    code(
      validateMint(
        { policyId: POLICY, assetName: "T", quantity: "1", cip25: { name: "n", ok: true } },
        "Preview",
      ),
    ),
    "INVALID_METADATA",
  );
  assert.equal(
    code(validateMint({ policyId: POLICY, assetName: "T", quantity: "1", cip25: "n" }, "Preview")),
    "INVALID_REQUEST",
  );
});

test("validateMint rejects a bad policy id, asset name and quantity", () => {
  assert.equal(code(validateMint({ policyId: "short", assetName: "T", quantity: "1" }, "Preview")), "INVALID_POLICY_ID");
  assert.equal(code(validateMint({ assetName: "T", quantity: "1" }, "Preview")), "INVALID_REQUEST");
  assert.equal(
    code(validateMint({ policyId: POLICY, assetName: "x".repeat(33), quantity: "1" }, "Preview")),
    "INVALID_ASSET_NAME",
  );
  assert.equal(code(validateMint({ policyId: POLICY, quantity: "1" }, "Preview")), "INVALID_REQUEST");
  for (const quantity of ["0", "-1", "1.5", 0, -5]) {
    assert.equal(
      code(validateMint({ policyId: POLICY, assetName: "T", quantity }, "Preview")),
      "INVALID_AMOUNT",
      `expected ${String(quantity)} rejected`,
    );
  }
  assert.equal(code(validateMint({ policyId: POLICY, assetName: "T", quantity: null }, "Preview")), "INVALID_REQUEST");
});

test("validateMint names an unknown top-level field", () => {
  const r = validateMint({ policyId: POLICY, assetName: "T", quantity: "1", burn: true }, "Preview");
  assert.equal(code(r), "INVALID_REQUEST");
  assert.match(r.ok === false ? r.error.message : "", /unknown field "burn"/);
});

/* ------------------------------ send-tokens ------------------------------ */

test("validateSendTokens normalises quantities to bigint", () => {
  const r = must(validateSendTokens({ to: TESTNET, assets: { [UNIT]: "5" } }, "Preview"));
  assert.deepEqual(r.assets, { [UNIT]: 5n });
  assert.equal(r.to.bech32, TESTNET);
  assert.equal(r.hydra, false);
});

test("validateSendTokens refuses lovelace: that is send-ada's job", () => {
  const r = validateSendTokens(
    { to: TESTNET, assets: { [LOVELACE]: "1000000", [UNIT]: "1" } },
    "Preview",
  );
  assert.equal(code(r), "INVALID_REQUEST");
  assert.match(r.ok === false ? r.error.message : "", /use send-ada/);
});

test("validateSendTokens requires at least one asset", () => {
  assert.equal(code(validateSendTokens({ to: TESTNET, assets: {} }, "Preview")), "INVALID_REQUEST");
  assert.equal(code(validateSendTokens({ to: TESTNET }, "Preview")), "INVALID_REQUEST");
  assert.equal(code(validateSendTokens({ to: TESTNET, assets: [] }, "Preview")), "INVALID_REQUEST");
});

test("validateSendTokens rejects bad units and quantities", () => {
  assert.equal(code(validateSendTokens({ to: TESTNET, assets: { nope: "1" } }, "Preview")), "INVALID_UNIT");
  assert.equal(code(validateSendTokens({ to: TESTNET, assets: { [UNIT]: "0" } }, "Preview")), "INVALID_AMOUNT");
  assert.equal(code(validateSendTokens({ to: TESTNET, assets: { [UNIT]: "-1" } }, "Preview")), "INVALID_AMOUNT");
});

test("validateSendTokens checks hydra and unknown fields", () => {
  assert.equal(
    must(validateSendTokens({ to: TESTNET, assets: { [UNIT]: 1n }, hydra: true }, "Preview")).hydra,
    true,
  );
  assert.equal(
    code(validateSendTokens({ to: TESTNET, assets: { [UNIT]: 1n }, hydra: "x" }, "Preview")),
    "INVALID_REQUEST",
  );
  const r = validateSendTokens({ to: TESTNET, assets: { [UNIT]: 1n }, memo: "x" }, "Preview");
  assert.equal(code(r), "INVALID_REQUEST");
  assert.match(r.ok === false ? r.error.message : "", /unknown field "memo"/);
});

/* ---------------------------- messageMetadatum --------------------------- */

test("messageMetadatum chunks a string and converts anything else", () => {
  assert.deepEqual(must(messageMetadatum("hi")), { msg: ["hi"] });
  assert.deepEqual(must(messageMetadatum("")), { msg: [] });
  assert.deepEqual(must(messageMetadatum(["a", 1])), ["a", 1n] as Metadatum);
  assert.equal(code(messageMetadatum(true)), "INVALID_METADATA");
});
