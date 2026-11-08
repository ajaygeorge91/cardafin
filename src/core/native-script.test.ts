import test from "node:test";
import assert from "node:assert/strict";

import {
  earliestBeforeSlot,
  keyHashesOf,
  policyIsOpenAt,
  sigAndBeforePolicy,
  validateNativeScript,
} from "./native-script.ts";
import type { NativeScript } from "./native-script.ts";

const KEY_A = "1a".repeat(28);
const KEY_B = "2b".repeat(28);

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

test("sigAndBeforePolicy builds { all: [sig, before] }", () => {
  assert.deepEqual(sigAndBeforePolicy(KEY_A, 1000), {
    type: "all",
    scripts: [
      { type: "sig", keyHash: KEY_A },
      { type: "before", slot: 1000 },
    ],
  });
});

test("a sig clause is always open: core has no witnesses", () => {
  const script: NativeScript = { type: "sig", keyHash: KEY_A };
  assert.equal(policyIsOpenAt(script, 0), true);
  assert.equal(policyIsOpenAt(script, Number.MAX_SAFE_INTEGER), true);
});

test("before is open while currentSlot < slot", () => {
  const script: NativeScript = { type: "before", slot: 100 };
  assert.equal(policyIsOpenAt(script, 0), true);
  assert.equal(policyIsOpenAt(script, 99), true);
  assert.equal(policyIsOpenAt(script, 100), false);
  assert.equal(policyIsOpenAt(script, 101), false);
});

test("after is open once currentSlot >= slot", () => {
  const script: NativeScript = { type: "after", slot: 100 };
  assert.equal(policyIsOpenAt(script, 99), false);
  assert.equal(policyIsOpenAt(script, 100), true);
  assert.equal(policyIsOpenAt(script, 101), true);
});

test("all requires every clause", () => {
  const script = sigAndBeforePolicy(KEY_A, 100);
  assert.equal(policyIsOpenAt(script, 99), true);
  assert.equal(policyIsOpenAt(script, 100), false);

  const window: NativeScript = {
    type: "all",
    scripts: [
      { type: "after", slot: 50 },
      { type: "before", slot: 100 },
    ],
  };
  assert.equal(policyIsOpenAt(window, 49), false);
  assert.equal(policyIsOpenAt(window, 50), true);
  assert.equal(policyIsOpenAt(window, 99), true);
  assert.equal(policyIsOpenAt(window, 100), false);
});

test("any requires one clause", () => {
  const script: NativeScript = {
    type: "any",
    scripts: [
      { type: "before", slot: 10 },
      { type: "after", slot: 100 },
    ],
  };
  assert.equal(policyIsOpenAt(script, 5), true);
  assert.equal(policyIsOpenAt(script, 50), false);
  assert.equal(policyIsOpenAt(script, 100), true);
});

test("atLeast counts open clauses", () => {
  const script: NativeScript = {
    type: "atLeast",
    required: 2,
    scripts: [
      { type: "before", slot: 10 },
      { type: "before", slot: 20 },
      { type: "before", slot: 30 },
    ],
  };
  assert.equal(policyIsOpenAt(script, 5), true); // 3 open
  assert.equal(policyIsOpenAt(script, 15), true); // 2 open
  assert.equal(policyIsOpenAt(script, 25), false); // 1 open
  // sig clauses always count towards the quorum.
  const mixed: NativeScript = {
    type: "atLeast",
    required: 2,
    scripts: [
      { type: "sig", keyHash: KEY_A },
      { type: "sig", keyHash: KEY_B },
      { type: "before", slot: 10 },
    ],
  };
  assert.equal(policyIsOpenAt(mixed, 1000), true);
});

test("nesting composes", () => {
  const script: NativeScript = {
    type: "all",
    scripts: [
      { type: "sig", keyHash: KEY_A },
      { type: "any", scripts: [{ type: "before", slot: 10 }, { type: "after", slot: 90 }] },
    ],
  };
  assert.equal(policyIsOpenAt(script, 5), true);
  assert.equal(policyIsOpenAt(script, 50), false);
  assert.equal(policyIsOpenAt(script, 95), true);
});

test("earliestBeforeSlot finds the tightest lock", () => {
  assert.equal(earliestBeforeSlot(sigAndBeforePolicy(KEY_A, 500)), 500);
  assert.equal(earliestBeforeSlot({ type: "sig", keyHash: KEY_A }), undefined);
  assert.equal(earliestBeforeSlot({ type: "after", slot: 5 }), undefined);
  assert.equal(
    earliestBeforeSlot({
      type: "all",
      scripts: [
        { type: "before", slot: 900 },
        { type: "any", scripts: [{ type: "before", slot: 300 }, { type: "sig", keyHash: KEY_A }] },
      ],
    }),
    300,
  );
});

test("keyHashesOf collects distinct hashes, sorted", () => {
  assert.deepEqual(keyHashesOf(sigAndBeforePolicy(KEY_A, 1)), [KEY_A]);
  assert.deepEqual(
    keyHashesOf({
      type: "atLeast",
      required: 1,
      scripts: [
        { type: "sig", keyHash: KEY_B },
        { type: "sig", keyHash: KEY_A },
        { type: "sig", keyHash: KEY_B },
      ],
    }),
    [KEY_A, KEY_B],
  );
  assert.deepEqual(keyHashesOf({ type: "before", slot: 1 }), []);
});

test("validateNativeScript accepts every clause type", () => {
  assert.deepEqual(must(validateNativeScript({ type: "sig", keyHash: KEY_A })), {
    type: "sig",
    keyHash: KEY_A,
  });
  assert.deepEqual(must(validateNativeScript({ type: "before", slot: 0 })), {
    type: "before",
    slot: 0,
  });
  assert.deepEqual(must(validateNativeScript({ type: "after", slot: 7 })), {
    type: "after",
    slot: 7,
  });
  const policy = sigAndBeforePolicy(KEY_A, 42);
  assert.deepEqual(must(validateNativeScript(policy)), policy);
  assert.deepEqual(
    must(
      validateNativeScript({
        type: "atLeast",
        required: 1,
        scripts: [{ type: "sig", keyHash: KEY_A }],
      }),
    ),
    { type: "atLeast", required: 1, scripts: [{ type: "sig", keyHash: KEY_A }] },
  );
});

test("validateNativeScript drops unknown extra fields", () => {
  assert.deepEqual(
    must(validateNativeScript({ type: "sig", keyHash: KEY_A, extra: "ignored" })),
    { type: "sig", keyHash: KEY_A },
  );
});

test("validateNativeScript rejects a bad keyHash", () => {
  for (const keyHash of [KEY_A.slice(1), `${KEY_A}0`, KEY_A.toUpperCase(), "zz", 5, undefined]) {
    const r = validateNativeScript({ type: "sig", keyHash });
    assert.equal(r.ok, false, `expected ${String(keyHash)} rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_REQUEST");
  }
});

test("validateNativeScript rejects bad slots", () => {
  for (const slot of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2, "100", null, undefined]) {
    assert.equal(validateNativeScript({ type: "before", slot }).ok, false);
    assert.equal(validateNativeScript({ type: "after", slot }).ok, false);
  }
});

test("validateNativeScript rejects bad shapes", () => {
  for (const bad of [null, undefined, 5, "sig", [], { keyHash: KEY_A }, { type: 1 }, { type: "nope" }]) {
    const r = validateNativeScript(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_REQUEST");
  }
});

test("validateNativeScript rejects empty or non-array sub-scripts", () => {
  assert.equal(validateNativeScript({ type: "all", scripts: [] }).ok, false);
  assert.equal(validateNativeScript({ type: "any", scripts: [] }).ok, false);
  assert.equal(validateNativeScript({ type: "all", scripts: {} }).ok, false);
  assert.equal(validateNativeScript({ type: "all" }).ok, false);
});

test("validateNativeScript checks atLeast.required against the sub-script count", () => {
  const scripts = [{ type: "sig", keyHash: KEY_A }];
  assert.equal(validateNativeScript({ type: "atLeast", required: 2, scripts }).ok, false);
  assert.equal(validateNativeScript({ type: "atLeast", required: 0, scripts }).ok, false);
  assert.equal(validateNativeScript({ type: "atLeast", required: 1.5, scripts }).ok, false);
  assert.equal(validateNativeScript({ type: "atLeast", scripts }).ok, false);
});

test("validateNativeScript reports the path of a nested failure", () => {
  const r = validateNativeScript({
    type: "all",
    scripts: [{ type: "sig", keyHash: KEY_A }, { type: "before", slot: -1 }],
  });
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.error.message : "", /script\.scripts\[1\]\.slot/);
});
