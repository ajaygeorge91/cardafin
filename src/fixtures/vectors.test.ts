// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// These vectors are transcribed from specifications by hand, so the one
// thing that can quietly go wrong is a typo — and a typo in a test vector
// is worse than no vector, because it makes a correct implementation look
// broken and sends you hunting in the wrong file.
//
// This checks the transcription is well-formed. It cannot check the values
// are right (that needs the implementations the vectors exist to test); what
// it can do is catch a dropped character.

import test from "node:test";
import assert from "node:assert/strict";

import { BLAKE2B_VECTORS, CIP14_VECTORS } from "./vectors.ts";

const HEX = /^[0-9a-f]*$/;

test("every BLAKE2b vector's hex length matches its declared digest size", () => {
  assert.ok(BLAKE2B_VECTORS.length >= 4);
  for (const vector of BLAKE2B_VECTORS) {
    assert.match(vector.hex, HEX, `${vector.input}/${vector.digestBytes}: not lowercase hex`);
    assert.equal(
      vector.hex.length,
      vector.digestBytes * 2,
      `${vector.input}/${vector.digestBytes}: expected ${vector.digestBytes * 2} hex chars`,
    );
  }
});

test("the RFC 7693 reference digest of \"abc\" is present and intact", () => {
  const reference = BLAKE2B_VECTORS.find((v) => v.input === "abc" && v.digestBytes === 64);
  assert.ok(reference, "the 512-bit reference vector anchors the other digest sizes");
  assert.ok(reference.hex.startsWith("ba80a53f981c4d0d"));
  assert.ok(reference.hex.endsWith("d4009923"));
});

test("every CIP-14 vector is a 56-hex policy id, even-length asset name and asset1 fingerprint", () => {
  assert.equal(CIP14_VECTORS.length, 8, "CIP-14 publishes eight vectors");
  for (const vector of CIP14_VECTORS) {
    assert.equal(vector.policyId.length, 56, `${vector.fingerprint}: policy id must be 28 bytes`);
    assert.match(vector.policyId, HEX);
    assert.match(vector.assetNameHex, HEX);
    assert.equal(vector.assetNameHex.length % 2, 0, `${vector.fingerprint}: odd-length asset name`);
    assert.ok(vector.fingerprint.startsWith("asset1"), `${vector.fingerprint}: wrong prefix`);
    // bech32: "asset1" + 32 data characters + 6 checksum characters.
    assert.equal(vector.fingerprint.length, 44, `${vector.fingerprint}: wrong length`);
  }
});

test("the CIP-14 vectors cover the cases that break naive implementations", () => {
  const names = CIP14_VECTORS.map((v) => v.assetNameHex);
  assert.ok(names.includes(""), "an empty asset name is legal and must be covered");
  assert.ok(
    names.some((n) => n === "0".repeat(64)),
    "an all-zero 32-byte asset name catches truncation bugs",
  );
  const policies = new Set(CIP14_VECTORS.map((v) => v.policyId));
  assert.ok(policies.size >= 3, "vectors must span several policies, not one");
});
