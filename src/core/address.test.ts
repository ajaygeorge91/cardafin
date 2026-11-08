import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeBech32,
  encodeBaseAddress,
  encodeBech32,
  encodeEnterpriseAddress,
  encodeRewardAddress,
  parseAddress,
  truncateAddress,
  validateAddress,
} from "./address.ts";
import { bytesToHex, hexToBytes } from "./assets.ts";

function must<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  // node:assert/strict's `equal` asserts the discriminant, which narrows `r`.
  assert.equal(r.ok, true, r.ok ? "" : r.error.message);
  return r.value;
}

// Real, public addresses (no funds of ours, no keys): a mainnet base address
// and the matching preview/testnet base address. Verified to decode with a
// valid bech32 checksum, 57-byte payload, header type 0.
const MAINNET_BASE =
  "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const TESTNET_BASE =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";

const PAYMENT_HASH = "0123456789abcdef".repeat(3) + "01234567";
const STAKE_HASH = "fedcba9876543210".repeat(3) + "fedcba98";

test("fixture credential hashes are 28 bytes", () => {
  assert.equal(PAYMENT_HASH.length, 56);
  assert.equal(STAKE_HASH.length, 56);
});

test("BIP-173 reference vectors: valid checksums decode", () => {
  // Empty-payload vectors straight out of BIP-173. (The segwit `bc1…`
  // vectors are deliberately not used: segwit prepends a 5-bit witness
  // version, so their data part is not byte-aligned, while every Cardano
  // address is. This decoder requires a whole number of bytes.)
  const a = must(decodeBech32("A12UEL5L"));
  assert.equal(a.hrp, "a");
  assert.equal(a.data.length, 0);

  const long = must(
    decodeBech32(
      "an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs",
    ),
  );
  assert.equal(long.data.length, 0);
  assert.equal(long.hrp.length, 83);

  const punct = must(decodeBech32("?1ezyfcl"));
  assert.equal(punct.hrp, "?");
});

test("BIP-173 reference vectors: invalid strings are rejected", () => {
  for (const bad of [
    "A1G7SGD8", // invalid checksum
    "x1b4n0q5v", // invalid checksum
    "li1dgmt3", // data part too short for a checksum
    "1qzzfhee", // empty hrp
    "10a06t8", // empty hrp
    "pzry9x0s0muk", // no separator
  ]) {
    assert.equal(decodeBech32(bad).ok, false, `expected "${bad}" rejected`);
  }
});

test("a byte-aligned payload decodes to the exact bytes", () => {
  const encoded = must(encodeBech32("bc", hexToBytes("751e76e8199196d454941c45d1b3a323f1433bd6")));
  const decoded = must(decodeBech32(encoded));
  assert.equal(bytesToHex(decoded.data), "751e76e8199196d454941c45d1b3a323f1433bd6");
});

test("bech32 round-trips arbitrary payloads of any length", () => {
  for (const length of [1, 28, 29, 57, 100]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 7 + 3) & 0xff);
    const encoded = must(encodeBech32("addr_test", bytes));
    const decoded = must(decodeBech32(encoded));
    assert.equal(decoded.hrp, "addr_test");
    assert.deepEqual([...decoded.data], [...bytes]);
  }
});

test("bech32 decoding does NOT enforce the 90-character BIP-173 limit", () => {
  // A Cardano base address is 103 characters and must still decode.
  assert.ok(MAINNET_BASE.length > 90);
  assert.equal(must(decodeBech32(MAINNET_BASE)).data.length, 57);
});

test("bech32 decoding still enforces the checksum", () => {
  const broken = `${MAINNET_BASE.slice(0, -1)}${MAINNET_BASE.endsWith("x") ? "y" : "x"}`;
  const r = decodeBech32(broken);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_ADDRESS");
  assert.match(r.ok === false ? r.error.message : "", /checksum/);
});

test("bech32 decoding rejects mixed case, bad characters and missing hrp", () => {
  const upper = must(encodeBech32("addr_test", Uint8Array.from([1, 2, 3])));
  assert.equal(must(decodeBech32(upper.toUpperCase())).hrp, "addr_test");
  assert.equal(decodeBech32(`${upper.slice(0, 5).toUpperCase()}${upper.slice(5)}`).ok, false);
  assert.equal(decodeBech32("addr_test1bbbbbb").ok, false); // bad checksum
  assert.equal(decodeBech32("1qqqqqq").ok, false); // empty hrp
  assert.equal(decodeBech32("nosep").ok, false);
  assert.equal(decodeBech32("").ok, false);
});

test("encodeBech32 rejects an empty or uppercase hrp", () => {
  assert.equal(encodeBech32("", Uint8Array.from([1])).ok, false);
  assert.equal(encodeBech32("ADDR", Uint8Array.from([1])).ok, false);
});

test("the real mainnet base address parses as type 0, network id 1", () => {
  const info = must(parseAddress(MAINNET_BASE));
  assert.equal(info.kind, "base");
  assert.equal(info.headerType, 0);
  assert.equal(info.networkId, 1);
  assert.equal(info.bech32, MAINNET_BASE);
  assert.equal(info.paymentCredentialHex?.length, 56);
  assert.equal(info.stakeCredentialHex?.length, 56);
});

test("the real preview base address parses as type 0, network id 0", () => {
  const info = must(parseAddress(TESTNET_BASE));
  assert.equal(info.kind, "base");
  assert.equal(info.headerType, 0);
  assert.equal(info.networkId, 0);
  assert.equal(info.paymentCredentialHex?.length, 56);
});

test("the two real addresses share a payment credential (same key, two networks)", () => {
  const mainnet = must(parseAddress(MAINNET_BASE));
  const testnet = must(parseAddress(TESTNET_BASE));
  assert.equal(mainnet.paymentCredentialHex, testnet.paymentCredentialHex);
  assert.equal(mainnet.stakeCredentialHex, testnet.stakeCredentialHex);
});

test("generated base addresses round-trip through parseAddress", () => {
  for (const netId of [0, 1] as const) {
    const addr = must(encodeBaseAddress(netId, PAYMENT_HASH, STAKE_HASH));
    const info = must(parseAddress(addr));
    assert.equal(info.kind, "base");
    assert.equal(info.headerType, 0);
    assert.equal(info.networkId, netId);
    assert.equal(info.paymentCredentialHex, PAYMENT_HASH);
    assert.equal(info.stakeCredentialHex, STAKE_HASH);
    assert.equal(addr.startsWith(netId === 1 ? "addr1" : "addr_test1"), true);
  }
});

test("generated enterprise addresses parse as type 6 with 29-byte payloads", () => {
  for (const netId of [0, 1] as const) {
    const addr = must(encodeEnterpriseAddress(netId, PAYMENT_HASH));
    const info = must(parseAddress(addr));
    assert.equal(info.kind, "enterprise");
    assert.equal(info.headerType, 6);
    assert.equal(info.networkId, netId);
    assert.equal(info.paymentCredentialHex, PAYMENT_HASH);
    assert.equal(info.stakeCredentialHex, undefined);
    assert.equal(must(decodeBech32(addr)).data.length, 29);
  }
});

test("generated reward addresses parse as type 14 under stake/stake_test", () => {
  const mainnet = must(encodeRewardAddress(1, STAKE_HASH));
  assert.equal(mainnet.startsWith("stake1"), true);
  const info = must(parseAddress(mainnet));
  assert.equal(info.kind, "reward");
  assert.equal(info.headerType, 14);
  assert.equal(info.paymentCredentialHex, undefined);
  assert.equal(info.stakeCredentialHex, STAKE_HASH);

  const testnet = must(encodeRewardAddress(0, STAKE_HASH));
  assert.equal(testnet.startsWith("stake_test1"), true);
  assert.equal(must(parseAddress(testnet)).networkId, 0);
});

test("encode helpers reject credentials that are not 28 bytes", () => {
  assert.equal(encodeEnterpriseAddress(0, "ab").ok, false);
  assert.equal(encodeBaseAddress(0, PAYMENT_HASH, "ab").ok, false);
  assert.equal(encodeRewardAddress(0, "zz".repeat(28)).ok, false);
});

function craft(header: number, hrp: string, payloadBytes: number): string {
  const bytes = new Uint8Array(payloadBytes);
  bytes[0] = header;
  for (let i = 1; i < payloadBytes; i++) {
    bytes[i] = i & 0xff;
  }
  return must(encodeBech32(hrp, bytes));
}

test("script-base is reported for header types 1, 2 and 3", () => {
  for (const type of [1, 2, 3]) {
    const info = must(parseAddress(craft((type << 4) | 0, "addr_test", 57)));
    assert.equal(info.kind, "script-base");
    assert.equal(info.headerType, type);
  }
});

test("pointer addresses (types 4 and 5) accept variable payloads over 29 bytes", () => {
  for (const type of [4, 5]) {
    const info = must(parseAddress(craft((type << 4) | 1, "addr", 32)));
    assert.equal(info.kind, "pointer");
    assert.equal(info.paymentCredentialHex?.length, 56);
  }
  // 29 bytes is header + credential with no pointer: too short.
  assert.equal(parseAddress(craft(0x41, "addr", 29)).ok, false);
});

test("script enterprise (type 7) and script reward (type 15) parse", () => {
  assert.equal(must(parseAddress(craft(0x70, "addr_test", 29))).kind, "enterprise");
  assert.equal(must(parseAddress(craft(0xf0, "stake_test", 29))).kind, "reward");
});

test("wrong payload length for the header type is INVALID_ADDRESS", () => {
  assert.equal(parseAddress(craft(0x00, "addr_test", 29)).ok, false); // base must be 57
  assert.equal(parseAddress(craft(0x60, "addr_test", 57)).ok, false); // enterprise must be 29
  assert.equal(parseAddress(craft(0xe0, "stake_test", 57)).ok, false); // reward must be 29
});

test("hrp must agree with the header's network id and address kind", () => {
  // type 0, network id 1, but announced as addr_test
  const r = parseAddress(craft(0x01, "addr_test", 57));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_ADDRESS");
  assert.match(r.ok === false ? r.error.message : "", /does not match header/);
  // reward header under an addr prefix
  assert.equal(parseAddress(craft(0xe0, "addr_test", 29)).ok, false);
  // payment header under a stake prefix
  assert.equal(parseAddress(craft(0x60, "stake_test", 29)).ok, false);
});

test("unknown header types and network ids are rejected", () => {
  assert.equal(parseAddress(craft(0x90, "addr_test", 29)).ok, false); // type 9
  assert.equal(parseAddress(craft(0xd0, "addr_test", 29)).ok, false); // type 13
  assert.equal(parseAddress(craft(0x02, "addr_test", 57)).ok, false); // network id 2
});

test("Byron addresses are rejected with the documented message", () => {
  for (const byron of [
    "Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi",
    "DdzFFzCqrhsf6hiTY8K8dnMazeqSJTRviNqvHHgLJLgDnqtTuE7Z6n8N1Hc9aKfPSwjNYvlDgYpJr6PfYrVxaxvjGdbYG1nTbbYAJmYm",
  ]) {
    const r = parseAddress(byron);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error.code, "INVALID_ADDRESS");
    assert.equal(r.ok === false && r.error.message, "Byron addresses are not supported in v1");
  }
});

test("a bech32 address with the Byron header type 8 is also rejected", () => {
  const r = parseAddress(craft(0x80, "addr_test", 29));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.message, "Byron addresses are not supported in v1");
});

test("non-bech32 junk is INVALID_ADDRESS", () => {
  for (const bad of ["", "   ", "hello world", "addr1", "not an address"]) {
    const r = parseAddress(bad);
    assert.equal(r.ok, false, `expected "${bad}" rejected`);
    assert.equal(r.ok === false && r.error.code, "INVALID_ADDRESS");
  }
});

test("validateAddress accepts a payment address on the matching network", () => {
  assert.equal(must(validateAddress(MAINNET_BASE, "Mainnet")).networkId, 1);
  assert.equal(must(validateAddress(TESTNET_BASE, "Preview")).networkId, 0);
  assert.equal(must(validateAddress(TESTNET_BASE, "Preprod")).networkId, 0);
});

test("validateAddress rejects an address from another network with WRONG_NETWORK", () => {
  const r = validateAddress(MAINNET_BASE, "Preview");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "WRONG_NETWORK");
  assert.deepEqual(r.ok === false && r.error.details, {
    addressNetworkId: 1,
    expectedNetworkId: 0,
    network: "Preview",
  });
  assert.equal(validateAddress(TESTNET_BASE, "Mainnet").ok, false);
});

test("validateAddress rejects a reward address as a payment target", () => {
  const stake = must(encodeRewardAddress(0, STAKE_HASH));
  const r = validateAddress(stake, "Preview");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.code, "INVALID_ADDRESS");
  assert.match(r.ok === false ? r.error.message : "", /not a payment address/);
});

test("truncateAddress keeps 12 leading and 6 trailing characters", () => {
  assert.equal(truncateAddress(TESTNET_BASE), "addr_test1qz…68faae");
  assert.equal(truncateAddress("short"), "short");
  assert.equal(truncateAddress("a".repeat(18)), "a".repeat(18));
  assert.equal(truncateAddress("a".repeat(19)).length, 19);
});

test("hexToBytes of a decoded address reproduces the original payload", () => {
  const decoded = must(decodeBech32(MAINNET_BASE));
  assert.deepEqual([...hexToBytes(bytesToHex(decoded.data))], [...decoded.data]);
});
