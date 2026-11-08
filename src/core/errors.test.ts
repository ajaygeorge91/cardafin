import test from "node:test";
import assert from "node:assert/strict";

import { CardafinError, ERROR_CODES, fail, isCardafinError } from "./errors.ts";

test("CardafinError carries a code and a message", () => {
  const e = new CardafinError("INVALID_ADDRESS", "bad address");
  assert.equal(e.code, "INVALID_ADDRESS");
  assert.equal(e.message, "bad address");
  assert.equal(e.name, "CardafinError");
  assert.ok(e instanceof Error);
  assert.equal(e.details, undefined);
});

test("details are optional and omitted from JSON when absent", () => {
  const bare = new CardafinError("NOT_IMPLEMENTED", "later");
  assert.deepEqual(bare.toJSON(), { code: "NOT_IMPLEMENTED", message: "later" });

  const rich = new CardafinError("BELOW_MIN_ADA", "short", { minimum: 1_000_000n });
  assert.deepEqual(rich.toJSON(), {
    code: "BELOW_MIN_ADA",
    message: "short",
    details: { minimum: 1_000_000n },
  });
});

test("toJSON never leaks a stack trace", () => {
  const e = new CardafinError("PROVIDER_ERROR", "upstream down");
  assert.equal(Object.hasOwn(e.toJSON(), "stack"), false);
});

test("isCardafinError distinguishes our errors from plain ones", () => {
  assert.equal(isCardafinError(new CardafinError("INVALID_UNIT", "x")), true);
  assert.equal(isCardafinError(new Error("x")), false);
  assert.equal(isCardafinError("x"), false);
});

test("fail builds an Err of CardafinError", () => {
  const r = fail("WRONG_NETWORK", "mismatch", { network: "Preview" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "WRONG_NETWORK");
  assert.equal(r.error.message, "mismatch");
  assert.deepEqual(r.error.details, { network: "Preview" });
});

test("ERROR_CODES lists every code exactly once", () => {
  assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
  assert.ok(ERROR_CODES.includes("MAINNET_NOT_CONFIRMED"));
  assert.equal(ERROR_CODES.length, 13);
});
