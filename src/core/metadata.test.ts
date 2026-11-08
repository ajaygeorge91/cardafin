import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  METADATA_LABEL_CIP25,
  METADATA_LABEL_MESSAGE,
  METADATUM_MAX_BYTES,
  canonicalJson,
  chunkUtf8,
  cip25Metadata,
  fitsMetadatum,
  sha256Hex,
  toMetadatum,
} from "./metadata.ts";
import type { Json, Metadatum } from "./metadata.ts";

const POLICY = "c".repeat(56);
const NAME_HEX = "4361726461666e"; // "Cardafn"

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

test("labels", () => {
  assert.equal(METADATA_LABEL_CIP25, 721);
  assert.equal(METADATA_LABEL_MESSAGE, 674);
  assert.equal(METADATUM_MAX_BYTES, 64);
});

test("canonicalJson sorts keys recursively and emits no whitespace", () => {
  assert.equal(
    must(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })),
    '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}',
  );
  assert.equal(must(canonicalJson({})), "{}");
  assert.equal(must(canonicalJson([])), "[]");
});

test("canonicalJson sorts by UTF-16 code unit, so uppercase precedes lowercase", () => {
  assert.equal(must(canonicalJson({ a: 1, B: 2, A: 3 })), '{"A":3,"B":2,"a":1}');
});

test("canonicalJson is key-order independent", () => {
  const one = must(canonicalJson({ z: 1, a: 2, m: 3 }));
  const two = must(canonicalJson({ m: 3, z: 1, a: 2 }));
  assert.equal(one, two);
});

test("canonicalJson renders scalars", () => {
  assert.equal(must(canonicalJson("hi")), '"hi"');
  assert.equal(must(canonicalJson('quote"and\\slash')), '"quote\\"and\\\\slash"');
  assert.equal(must(canonicalJson(42)), "42");
  assert.equal(must(canonicalJson(-0.5)), "-0.5");
  assert.equal(must(canonicalJson(true)), "true");
  assert.equal(must(canonicalJson(false)), "false");
  assert.equal(must(canonicalJson(null)), "null");
});

test("canonicalJson rejects NaN, Infinity and undefined", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const r = canonicalJson(bad);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.code, "INVALID_METADATA");
  }
  const undef = canonicalJson({ a: undefined } as unknown as Json);
  assert.equal(undef.ok, false);
  assert.equal(undef.ok === false && undef.error.code, "INVALID_METADATA");
  assert.match(undef.ok === false ? undef.error.message : "", /\$\.a/);
  assert.equal(canonicalJson([undefined] as unknown as Json).ok, false);
  assert.equal(canonicalJson((() => 1) as unknown as Json).ok, false);
});

test("sha256Hex matches node:crypto for strings and bytes", () => {
  const expected = createHash("sha256").update("cardafin").digest("hex");
  assert.equal(sha256Hex("cardafin"), expected);
  assert.equal(sha256Hex(new TextEncoder().encode("cardafin")), expected);
  assert.equal(sha256Hex("").length, 64);
});

test("canonicalJson + sha256Hex fingerprint is order independent", () => {
  const a = sha256Hex(must(canonicalJson({ x: 1, y: [2, 3] })));
  const b = sha256Hex(must(canonicalJson({ y: [2, 3], x: 1 })));
  assert.equal(a, b);
});

test("chunkUtf8 splits ASCII at the byte limit", () => {
  const s = "a".repeat(150);
  const chunks = chunkUtf8(s);
  assert.deepEqual(chunks.map((c) => c.length), [64, 64, 22]);
  assert.equal(chunks.join(""), s);
});

test("chunkUtf8 returns an empty array for an empty string", () => {
  assert.deepEqual(chunkUtf8(""), []);
});

test("chunkUtf8 never splits a two-byte code point", () => {
  // 40 × "é" = 80 UTF-8 bytes. A naive byte split would land mid-character.
  const s = "é".repeat(40);
  const chunks = chunkUtf8(s, 64);
  for (const chunk of chunks) {
    assert.ok(utf8Length(chunk) <= 64, `chunk is ${utf8Length(chunk)} bytes`);
    assert.equal(chunk.includes("�"), false);
  }
  assert.equal(chunks.join(""), s);
  assert.deepEqual(chunks.map((c) => utf8Length(c)), [64, 16]);
});

test("chunkUtf8 never splits a four-byte emoji (surrogate pair)", () => {
  // "🎉" is 4 UTF-8 bytes; 20 of them are 80 bytes.
  const s = "🎉".repeat(20);
  const chunks = chunkUtf8(s, 64);
  assert.deepEqual(chunks.map((c) => utf8Length(c)), [64, 16]);
  assert.equal(chunks.join(""), s);
  for (const chunk of chunks) {
    assert.equal(utf8Length(chunk) % 4, 0);
    assert.equal([...chunk].every((cp) => cp.codePointAt(0)! > 0xffff), true);
  }
});

test("chunkUtf8 handles a limit that is not a multiple of the code point size", () => {
  const chunks = chunkUtf8("🎉🎉🎉", 5);
  assert.deepEqual(chunks, ["🎉", "🎉", "🎉"]);
  for (const chunk of chunks) {
    assert.ok(utf8Length(chunk) <= 5);
  }
});

test("chunkUtf8 emits an over-long code point alone rather than splitting it", () => {
  assert.deepEqual(chunkUtf8("a🎉b", 2), ["a", "🎉", "b"]);
});

test("chunkUtf8 falls back to 64 bytes for a nonsense limit", () => {
  assert.deepEqual(chunkUtf8("a".repeat(70), 0).map((c) => c.length), [64, 6]);
});

test("fitsMetadatum measures UTF-8 bytes, not characters", () => {
  assert.equal(fitsMetadatum("a".repeat(64)), true);
  assert.equal(fitsMetadatum("a".repeat(65)), false);
  assert.equal(fitsMetadatum("é".repeat(32)), true);
  assert.equal(fitsMetadatum("é".repeat(33)), false);
});

test("toMetadatum keeps short strings as strings", () => {
  assert.equal(must(toMetadatum("hello")), "hello");
  assert.equal(must(toMetadatum("")), "");
  assert.equal(must(toMetadatum("a".repeat(64))), "a".repeat(64));
});

test("toMetadatum chunks strings longer than 64 bytes", () => {
  const long = "a".repeat(65);
  const result = must(toMetadatum(long));
  assert.ok(Array.isArray(result));
  assert.deepEqual(result, ["a".repeat(64), "a"]);
});

test("toMetadatum converts safe integers to bigint", () => {
  assert.equal(must(toMetadatum(0)), 0n);
  assert.equal(must(toMetadatum(42)), 42n);
  assert.equal(must(toMetadatum(-7)), -7n);
  assert.equal(typeof must(toMetadatum(1)), "bigint");
});

test("toMetadatum rejects non-integer and unsafe numbers", () => {
  for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
    const r = toMetadatum(bad);
    assert.equal(r.ok, false, `expected ${String(bad)} rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_METADATA");
  }
});

test("toMetadatum rejects booleans and null: the metadatum type has neither", () => {
  for (const bad of [true, false, null] as Json[]) {
    const r = toMetadatum(bad);
    assert.equal(r.ok, false, `expected ${String(bad)} rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_METADATA");
    assert.match(
      r.ok === false ? r.error.message : "",
      /no Cardano metadatum representation/,
    );
  }
  assert.equal(toMetadatum({ flag: true }).ok, false);
  assert.equal(toMetadatum([null]).ok, false);
});

test("toMetadatum walks arrays and objects, sorting object keys", () => {
  assert.deepEqual(must(toMetadatum([1, "two", [3]])), [1n, "two", [3n]]);
  const obj = must(toMetadatum({ b: 2, a: "x" })) as { [k: string]: Metadatum };
  assert.deepEqual(Object.keys(obj), ["a", "b"]);
  assert.deepEqual(obj, { a: "x", b: 2n });
});

test("toMetadatum rejects object keys longer than 64 bytes", () => {
  const key = "k".repeat(65);
  const r = toMetadatum({ [key]: "v" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_METADATA");
  assert.deepEqual(r.ok === false && r.error.details, { key, bytes: 65, max: 64 });
  // 64 bytes is fine.
  assert.equal(toMetadatum({ ["k".repeat(64)]: "v" }).ok, true);
  // Multi-byte keys are measured in bytes.
  assert.equal(toMetadatum({ ["é".repeat(33)]: "v" }).ok, false);
});

test("toMetadatum skips undefined object values", () => {
  assert.deepEqual(must(toMetadatum({ a: "x", b: undefined } as unknown as Json)), {
    a: "x",
  });
});

test("cip25Metadata uses CIP-25 version 2: hex asset key and version 2n", () => {
  const value = must(cip25Metadata(POLICY, NAME_HEX, { name: "Cardafn #1" })) as Record<
    string,
    Metadatum
  >;
  assert.deepEqual(Object.keys(value).sort(), [POLICY, "version"].sort());
  assert.equal(value.version, 2n);
  const policyEntry = value[POLICY] as Record<string, Metadatum>;
  // v2 keys the asset by hex, not by its UTF-8 name.
  assert.deepEqual(Object.keys(policyEntry), [NAME_HEX]);
  assert.deepEqual(policyEntry[NAME_HEX], { name: "Cardafn #1" });
});

test("cip25Metadata passes every field through toMetadatum", () => {
  const image = `ipfs://${"Q".repeat(80)}`;
  const value = must(
    cip25Metadata(POLICY, NAME_HEX, {
      name: "Cardafn #1",
      image,
      description: "short",
      edition: 7,
      tags: ["a", "b"],
    }),
  ) as Record<string, Metadatum>;
  const asset = (value[POLICY] as Record<string, Metadatum>)[NAME_HEX] as Record<
    string,
    Metadatum
  >;
  assert.equal(asset.description, "short");
  assert.equal(asset.edition, 7n);
  assert.deepEqual(asset.tags, ["a", "b"]);
  // The long IPFS URI is chunked, never truncated.
  assert.ok(Array.isArray(asset.image));
  assert.equal((asset.image as string[]).join(""), image);
  for (const chunk of asset.image as string[]) {
    assert.ok(utf8Length(chunk) <= 64);
  }
});

test("cip25Metadata sorts asset field keys for determinism", () => {
  const value = must(
    cip25Metadata(POLICY, NAME_HEX, { name: "n", zzz: "z", aaa: "a" }),
  ) as Record<string, Metadatum>;
  const asset = (value[POLICY] as Record<string, Metadatum>)[NAME_HEX] as Record<
    string,
    Metadatum
  >;
  assert.deepEqual(Object.keys(asset), ["aaa", "name", "zzz"]);
});

test("cip25Metadata requires a name of at most 64 bytes", () => {
  for (const fields of [{}, { name: "" }, { name: 5 }]) {
    const r = cip25Metadata(POLICY, NAME_HEX, fields as { name: string });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.code, "INVALID_METADATA");
  }
  const long = cip25Metadata(POLICY, NAME_HEX, { name: "n".repeat(65) });
  assert.equal(long.ok, false);
  assert.deepEqual(long.ok === false && long.error.details, { bytes: 65, max: 64 });
});

test("cip25Metadata validates the policy id and asset name hex", () => {
  assert.equal(cip25Metadata("short", NAME_HEX, { name: "n" }).ok, false);
  assert.equal(cip25Metadata(POLICY, "zzz", { name: "n" }).ok, false);
  assert.equal(cip25Metadata(POLICY, NAME_HEX, null as unknown as { name: string }).ok, false);
});

test("cip25Metadata skips undefined optional fields", () => {
  const value = must(
    cip25Metadata(POLICY, NAME_HEX, { name: "n", image: undefined, description: undefined }),
  ) as Record<string, Metadatum>;
  const asset = (value[POLICY] as Record<string, Metadatum>)[NAME_HEX] as Record<
    string,
    Metadatum
  >;
  assert.deepEqual(Object.keys(asset), ["name"]);
});
