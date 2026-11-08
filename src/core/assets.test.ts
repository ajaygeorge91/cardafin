import test from "node:test";
import assert from "node:assert/strict";

import {
  LOVELACE,
  MAX_ASSET_NAME_BYTES,
  POLICY_ID_HEX_LENGTH,
  addAssets,
  assetNameToHex,
  assetQuantity,
  bytesToHex,
  fromUnit,
  hexToAssetName,
  hexToBytes,
  isEmptyAssets,
  isHex,
  lovelaceOf,
  nativeAssetsOf,
  parseAssets,
  policyIdsOf,
  subtractAssets,
  sumUtxoAssets,
  toUnit,
  validateAssetNameHex,
  validatePolicyId,
  validateUnit,
} from "./assets.ts";
import type { Assets } from "./assets.ts";
import type { Utxo } from "./types.ts";

const POLICY_A = "a".repeat(56);
const POLICY_B = "b0".repeat(28);
// "TOKEN" in hex.
const NAME_TOKEN = "544f4b454e";
const UNIT_A = POLICY_A + NAME_TOKEN;

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

test("constants", () => {
  assert.equal(LOVELACE, "lovelace");
  assert.equal(MAX_ASSET_NAME_BYTES, 32);
  assert.equal(POLICY_ID_HEX_LENGTH, 56);
});

test("isHex accepts hex of either case, including the empty asset name", () => {
  assert.equal(isHex(""), true);
  assert.equal(isHex("00ff"), true);
  assert.equal(isHex("00FF"), true);
  assert.equal(isHex("00g0"), false);
  assert.equal(isHex("0x10"), false);
});

test("hexToBytes / bytesToHex round-trip", () => {
  assert.deepEqual([...hexToBytes("00ff10")], [0, 255, 16]);
  assert.equal(bytesToHex(Uint8Array.from([0, 255, 16])), "00ff10");
  assert.equal(bytesToHex(new Uint8Array(0)), "");
});

test("validatePolicyId requires exactly 56 lowercase hex", () => {
  assert.equal(must(validatePolicyId(POLICY_A)), POLICY_A);
  for (const bad of ["a".repeat(55), "a".repeat(57), "A".repeat(56), "g".repeat(56), ""]) {
    const r = validatePolicyId(bad);
    assert.equal(r.ok, false, `expected "${bad.slice(0, 8)}…" rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_POLICY_ID");
  }
});

test("validateAssetNameHex allows 0-64 even-length lowercase hex", () => {
  assert.equal(must(validateAssetNameHex("")), "");
  assert.equal(must(validateAssetNameHex(NAME_TOKEN)), NAME_TOKEN);
  assert.equal(must(validateAssetNameHex("f".repeat(64))), "f".repeat(64));
  for (const bad of ["f".repeat(66), "abc", "ABCD", "zz"]) {
    const r = validateAssetNameHex(bad);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.code, "INVALID_ASSET_NAME");
  }
});

test("assetNameToHex encodes UTF-8 and caps at 32 bytes", () => {
  assert.equal(must(assetNameToHex("TOKEN")), NAME_TOKEN);
  assert.equal(must(assetNameToHex("")), "");
  // "é" is two UTF-8 bytes, so 16 of them are 32 bytes: still legal.
  assert.equal(must(assetNameToHex("é".repeat(16))).length, 64);
  const tooLong = assetNameToHex("é".repeat(17));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.ok === false && tooLong.error.code, "INVALID_ASSET_NAME");
  assert.deepEqual(tooLong.ok === false && tooLong.error.details, { bytes: 34, max: 32 });
});

test("hexToAssetName decodes for display and is lossy on non-UTF-8", () => {
  assert.equal(hexToAssetName(NAME_TOKEN), "TOKEN");
  assert.equal(hexToAssetName(""), "");
  assert.equal(hexToAssetName("ff"), "�");
  assert.equal(hexToAssetName("abc"), "");
});

test("toUnit concatenates policy id and asset name hex", () => {
  assert.equal(must(toUnit(POLICY_A, NAME_TOKEN)), UNIT_A);
  assert.equal(must(toUnit(POLICY_A, "")), POLICY_A);
  assert.equal(toUnit("short", NAME_TOKEN).ok, false);
  assert.equal(toUnit(POLICY_A, "xyz").ok, false);
});

test("fromUnit splits a unit back apart", () => {
  assert.deepEqual(must(fromUnit(UNIT_A)), {
    policyId: POLICY_A,
    assetNameHex: NAME_TOKEN,
    assetName: "TOKEN",
  });
  assert.deepEqual(must(fromUnit(POLICY_A)), {
    policyId: POLICY_A,
    assetNameHex: "",
    assetName: "",
  });
});

test("fromUnit rejects lovelace: it is not a native asset", () => {
  const r = fromUnit(LOVELACE);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_UNIT");
  assert.match(r.ok === false ? r.error.message : "", /not a native asset/);
});

test("fromUnit rejects malformed units with INVALID_UNIT", () => {
  for (const bad of ["", "abc", "A".repeat(56), POLICY_A + "z".repeat(4), POLICY_A + "f".repeat(66)]) {
    const r = fromUnit(bad);
    assert.equal(r.ok, false, `expected "${bad.slice(0, 8)}…" rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_UNIT");
  }
});

test("validateUnit accepts lovelace and well-formed native units", () => {
  assert.equal(must(validateUnit(LOVELACE)), LOVELACE);
  assert.equal(must(validateUnit(UNIT_A)), UNIT_A);
  assert.equal(validateUnit("nope").ok, false);
});

test("addAssets sums and drops exact zeros", () => {
  assert.deepEqual(addAssets({ [LOVELACE]: 1n }, { [LOVELACE]: 2n }), { [LOVELACE]: 3n });
  assert.deepEqual(addAssets({ [LOVELACE]: 1n }, { [UNIT_A]: 5n }), {
    [LOVELACE]: 1n,
    [UNIT_A]: 5n,
  });
  assert.deepEqual(addAssets({ [UNIT_A]: 5n }, { [UNIT_A]: -5n }), {});
  assert.deepEqual(addAssets({ [UNIT_A]: 0n }, {}), {});
  // Inputs are not mutated.
  const a: Assets = { [LOVELACE]: 1n };
  addAssets(a, { [LOVELACE]: 1n });
  assert.deepEqual(a, { [LOVELACE]: 1n });
});

test("subtractAssets drops zero entries", () => {
  assert.deepEqual(
    must(subtractAssets({ [LOVELACE]: 10n, [UNIT_A]: 5n }, { [LOVELACE]: 4n, [UNIT_A]: 5n })),
    { [LOVELACE]: 6n },
  );
  assert.deepEqual(must(subtractAssets({ [LOVELACE]: 10n }, {})), { [LOVELACE]: 10n });
});

test("subtractAssets reports INSUFFICIENT_FUNDS listing the short units", () => {
  const r = subtractAssets({ [LOVELACE]: 1n }, { [LOVELACE]: 2n, [UNIT_A]: 3n });
  assert.equal(r.ok, false);
  if (r.ok) {
    return;
  }
  assert.equal(r.error.code, "INSUFFICIENT_FUNDS");
  assert.match(r.error.message, new RegExp(LOVELACE));
  assert.match(r.error.message, new RegExp(UNIT_A));
  assert.deepEqual(r.error.details, {
    short: [
      { unit: LOVELACE, required: 2n, available: 1n },
      { unit: UNIT_A, required: 3n, available: 0n },
    ],
  });
});

test("sumUtxoAssets totals a UTxO set", () => {
  const utxos: Utxo[] = [
    { txHash: "a".repeat(64), outputIndex: 0, address: "addr", assets: { [LOVELACE]: 2_000_000n } },
    {
      txHash: "a".repeat(64),
      outputIndex: 1,
      address: "addr",
      assets: { [LOVELACE]: 3_000_000n, [UNIT_A]: 7n },
    },
  ];
  assert.deepEqual(sumUtxoAssets(utxos), { [LOVELACE]: 5_000_000n, [UNIT_A]: 7n });
  assert.deepEqual(sumUtxoAssets([]), {});
});

test("selector helpers", () => {
  const assets: Assets = { [LOVELACE]: 9n, [UNIT_A]: 1n, [POLICY_B]: 2n };
  assert.equal(lovelaceOf(assets), 9n);
  assert.equal(lovelaceOf({}), 0n);
  assert.equal(assetQuantity(assets, UNIT_A), 1n);
  assert.equal(assetQuantity(assets, "missing"), 0n);
  assert.deepEqual(nativeAssetsOf(assets), { [UNIT_A]: 1n, [POLICY_B]: 2n });
  assert.deepEqual(policyIdsOf(assets), [POLICY_A, POLICY_B].sort());
  assert.equal(isEmptyAssets({}), true);
  assert.equal(isEmptyAssets(assets), false);
});

test("parseAssets validates units and positive quantities", () => {
  assert.deepEqual(must(parseAssets({ [LOVELACE]: "1500000", [UNIT_A]: 3 })), {
    [LOVELACE]: 1_500_000n,
    [UNIT_A]: 3n,
  });
  assert.deepEqual(must(parseAssets({ [UNIT_A]: 5n })), { [UNIT_A]: 5n });
  assert.deepEqual(must(parseAssets({})), {});
});

test("parseAssets rejects zero, negative and non-integer quantities", () => {
  for (const qty of ["0", 0, -1, "-5", "1.5", 1.5]) {
    const r = parseAssets({ [UNIT_A]: qty as string | number });
    assert.equal(r.ok, false, `expected ${String(qty)} rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_AMOUNT");
  }
});

test("parseAssets rejects bad units", () => {
  const r = parseAssets({ "not-a-unit": "1" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_UNIT");
});

test("parseAssets rejects non-objects", () => {
  for (const bad of [null, [], "x"]) {
    const r = parseAssets(bad as unknown as Record<string, string>);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.code, "INVALID_REQUEST");
  }
});
