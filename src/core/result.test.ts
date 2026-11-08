import test from "node:test";
import assert from "node:assert/strict";

import { err, isErr, isOk, mapOk, ok, unwrap } from "./result.ts";
import { CardafinError } from "./errors.ts";

test("ok wraps a value", () => {
  const r = ok(42);
  assert.equal(r.ok, true);
  assert.equal(r.value, 42);
});

test("err wraps an error", () => {
  const boom = new CardafinError("INVALID_REQUEST", "boom");
  const r = err(boom);
  assert.equal(r.ok, false);
  assert.equal(r.error, boom);
});

test("isOk / isErr narrow", () => {
  const good = ok("x");
  const bad = err("nope");
  assert.equal(isOk(good), true);
  assert.equal(isErr(good), false);
  assert.equal(isOk(bad), false);
  assert.equal(isErr(bad), true);
  if (isOk(good)) {
    assert.equal(good.value.length, 1);
  }
});

test("unwrap returns the value or throws the error", () => {
  assert.equal(unwrap(ok(7)), 7);
  const boom = new CardafinError("NOT_IMPLEMENTED", "nope");
  assert.throws(() => unwrap(err(boom)), (e) => e === boom);
});

test("mapOk transforms success and passes errors through", () => {
  assert.deepEqual(mapOk(ok(2), (n) => n * 3), ok(6));
  const failed = err("bad");
  assert.equal(mapOk(failed, (n: number) => n * 3), failed);
});

test("ok/err results are plain objects, safe to deepEqual in tests", () => {
  assert.deepEqual(ok(1n), { ok: true, value: 1n });
  assert.deepEqual(err("e"), { ok: false, error: "e" });
});
