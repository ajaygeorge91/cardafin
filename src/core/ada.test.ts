import test from "node:test";
import assert from "node:assert/strict";

import {
  ADA_DECIMALS,
  LOVELACE_PER_ADA,
  adaToLovelace,
  formatAda,
  lovelaceToAda,
  parseLovelace,
} from "./ada.ts";

function value(r: ReturnType<typeof adaToLovelace>): bigint {
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.ok ? r.value : 0n;
}

test("constants", () => {
  assert.equal(LOVELACE_PER_ADA, 1_000_000n);
  assert.equal(ADA_DECIMALS, 6);
});

test("adaToLovelace converts decimals exactly", () => {
  assert.equal(value(adaToLovelace("1.5")), 1_500_000n);
  assert.equal(value(adaToLovelace("1")), 1_000_000n);
  assert.equal(value(adaToLovelace("0")), 0n);
  assert.equal(value(adaToLovelace("0.000001")), 1n);
  assert.equal(value(adaToLovelace("0.1")), 100_000n);
  assert.equal(value(adaToLovelace("1.000000")), 1_000_000n);
  assert.equal(value(adaToLovelace("  2.25  ")), 2_250_000n);
});

test("adaToLovelace handles amounts far beyond Number.MAX_SAFE_INTEGER", () => {
  // 45 billion ADA (the total supply) in lovelace exceeds 2^53.
  assert.equal(value(adaToLovelace("45000000000.123456")), 45_000_000_000_123_456n);
});

test("adaToLovelace rejects more than six decimals", () => {
  const r = adaToLovelace("1.0000001");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_AMOUNT");
  assert.deepEqual(r.ok === false && r.error.details, { decimals: 7, max: 6 });
});

test("adaToLovelace rejects negatives, empties and non-numbers", () => {
  for (const bad of ["-1", "-0.5", "", "   ", "abc", "1.2.3", "1e6", "+1", ".5", "1."]) {
    const r = adaToLovelace(bad);
    assert.equal(r.ok, false, `expected "${bad}" to be rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_AMOUNT");
  }
});

test("lovelaceToAda trims trailing zeros, never uses floats", () => {
  assert.equal(lovelaceToAda(1_500_000n), "1.5");
  assert.equal(lovelaceToAda(1_000_000n), "1");
  assert.equal(lovelaceToAda(1n), "0.000001");
  assert.equal(lovelaceToAda(0n), "0");
  assert.equal(lovelaceToAda(1_234_567n), "1.234567");
  assert.equal(lovelaceToAda(10n), "0.00001");
  assert.equal(lovelaceToAda(100_000n), "0.1");
  assert.equal(lovelaceToAda(45_000_000_000_123_456n), "45000000000.123456");
  assert.equal(lovelaceToAda(-1_500_000n), "-1.5");
});

test("adaToLovelace and lovelaceToAda round-trip", () => {
  for (const ada of ["0", "1", "1.5", "0.000001", "123456.789012", "45000000000"]) {
    assert.equal(lovelaceToAda(value(adaToLovelace(ada))), normalise(ada));
  }
});

function normalise(ada: string): string {
  return ada.includes(".") ? ada.replace(/0+$/, "").replace(/\.$/, "") : ada;
}

test("formatAda appends the ticker", () => {
  assert.equal(formatAda(1_500_000n), "1.5 ADA");
  assert.equal(formatAda(0n), "0 ADA");
});

test("parseLovelace accepts bigint, safe integers and integer strings", () => {
  assert.equal(value(parseLovelace(1_500_000n)), 1_500_000n);
  assert.equal(value(parseLovelace(1500000)), 1_500_000n);
  assert.equal(value(parseLovelace("1500000")), 1_500_000n);
  assert.equal(value(parseLovelace("0")), 0n);
  assert.equal(value(parseLovelace(" 42 ")), 42n);
  // A string is lovelace here, not ADA.
  assert.equal(value(parseLovelace("1")), 1n);
});

test("parseLovelace rejects floats, NaN, negatives and junk", () => {
  for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, -1, -1n, "1.5", "", "x", "0x10"]) {
    const r = parseLovelace(bad as string | number | bigint);
    assert.equal(r.ok, false, `expected ${String(bad)} to be rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_AMOUNT");
  }
});

test("parseLovelace rejects unsafe integer numbers but accepts the string form", () => {
  const unsafe = Number.MAX_SAFE_INTEGER + 2;
  assert.equal(parseLovelace(unsafe).ok, false);
  assert.equal(value(parseLovelace("9007199254740993")), 9_007_199_254_740_993n);
});
