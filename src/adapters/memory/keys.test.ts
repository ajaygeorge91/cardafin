import test from "node:test";
import assert from "node:assert/strict";

import { parseAddress, validateAddress } from "../../core/address.ts";
import { isHex } from "../../core/assets.ts";
import { sigAndBeforePolicy } from "../../core/native-script.ts";
import {
  FAKE_WORDLIST,
  MemoryKeys,
  MNEMONIC_WORDS,
  nativeScriptToJson,
  paymentKeyHashOf,
  policyIdOf,
} from "./keys.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;

test("the fake wordlist is at least 64 distinct lowercase words", () => {
  assert.ok(FAKE_WORDLIST.length >= 64, `only ${FAKE_WORDLIST.length} words`);
  assert.equal(new Set(FAKE_WORDLIST).size, FAKE_WORDLIST.length);
  for (const word of FAKE_WORDLIST) {
    assert.match(word, /^[a-z]+$/);
  }
  // Not BIP-39: the real list's first and last words are absent.
  assert.equal(FAKE_WORDLIST.includes("abandon"), false);
  assert.equal(FAKE_WORDLIST.includes("zoo"), false);
});

test("generateMnemonic returns 24 words from the fake list", () => {
  const keys = new MemoryKeys();
  const phrase = keys.generateMnemonic();
  const words = phrase.split(" ");
  assert.equal(words.length, MNEMONIC_WORDS);
  for (const word of words) {
    assert.ok(FAKE_WORDLIST.includes(word), `${word} is not in the fake list`);
  }
  assert.equal(keys.validateMnemonic(phrase), true);
  // Randomness: two draws of 24 words from 64 collide with probability 64^-24.
  assert.notEqual(phrase, keys.generateMnemonic());
});

test("validateMnemonic accepts exactly 24 lowercase words", () => {
  const keys = new MemoryKeys();
  assert.equal(keys.validateMnemonic(THROWAWAY_MNEMONIC), true);
  // Extra whitespace is tolerated; the word count is what matters.
  assert.equal(keys.validateMnemonic(`  ${THROWAWAY_MNEMONIC}\n`), true);
  assert.equal(keys.validateMnemonic(THROWAWAY_MNEMONIC.replace(/\s+/g, "  ")), true);

  assert.equal(keys.validateMnemonic(""), false);
  assert.equal(keys.validateMnemonic("abandon"), false);
  assert.equal(keys.validateMnemonic(`${"abandon ".repeat(22)}art`), false, "23 words");
  assert.equal(keys.validateMnemonic(`${"abandon ".repeat(24)}art`), false, "25 words");
  assert.equal(keys.validateMnemonic(`${"abandon ".repeat(23)}ART`), false, "uppercase");
  assert.equal(keys.validateMnemonic(`${"abandon ".repeat(23)}art1`), false, "digit");
});

test("deriveWallet gives a structurally valid enterprise address per network", async () => {
  const keys = new MemoryKeys();

  const preview = await keys.deriveWallet(THROWAWAY_MNEMONIC, 0, "Preview");
  assert.equal(preview.network, "Preview");
  assert.equal(preview.accountIndex, 0);
  assert.match(preview.paymentKeyHash, /^[0-9a-f]{56}$/);
  assert.ok(preview.address.startsWith("addr_test1"), preview.address);

  const parsed = parseAddress(preview.address);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.kind, "enterprise");
    assert.equal(parsed.value.networkId, 0);
    assert.equal(parsed.value.paymentCredentialHex, preview.paymentKeyHash);
  }
  assert.equal(validateAddress(preview.address, "Preview").ok, true);
  // Same bytes, different network byte: the Mainnet parser must reject it.
  assert.equal(validateAddress(preview.address, "Mainnet").ok, false);

  const mainnet = await keys.deriveWallet(THROWAWAY_MNEMONIC, 0, "Mainnet");
  assert.ok(mainnet.address.startsWith("addr1"), mainnet.address);
  assert.equal(mainnet.paymentKeyHash, preview.paymentKeyHash, "key is network-free");
  assert.notEqual(mainnet.address, preview.address);

  // Preprod and Preview share network id 0, hence the same fake address.
  const preprod = await keys.deriveWallet(THROWAWAY_MNEMONIC, 0, "Preprod");
  assert.equal(preprod.address, preview.address);
});

test("deriveWallet is deterministic and account-separated", async () => {
  const keys = new MemoryKeys();
  const a = await keys.deriveWallet(THROWAWAY_MNEMONIC, 0, "Preview");
  const again = await new MemoryKeys().deriveWallet(THROWAWAY_MNEMONIC, 0, "Preview");
  const b = await keys.deriveWallet(THROWAWAY_MNEMONIC, 1, "Preview");
  assert.deepEqual(a, again);
  assert.notEqual(a.paymentKeyHash, b.paymentKeyHash);
  assert.notEqual(a.address, b.address);
  assert.equal(a.paymentKeyHash, paymentKeyHashOf(THROWAWAY_MNEMONIC, 0));
});

test("deriveWallet rejects a bad mnemonic or account index", async () => {
  const keys = new MemoryKeys();
  await assert.rejects(
    () => keys.deriveWallet("", 0, "Preview"),
    (e: unknown) => (e as { code?: string }).code === "INVALID_REQUEST",
  );
  await assert.rejects(
    () => keys.deriveWallet(THROWAWAY_MNEMONIC, -1, "Preview"),
    (e: unknown) => (e as { code?: string }).code === "INVALID_REQUEST",
  );
  await assert.rejects(
    () => keys.deriveWallet(THROWAWAY_MNEMONIC, 1.5, "Preview"),
    (e: unknown) => (e as { code?: string }).code === "INVALID_REQUEST",
  );
});

test("nativeScriptPolicyId is 56 lowercase hex, pure and script-sensitive", () => {
  const keys = new MemoryKeys();
  const keyHash = "7a".repeat(28);
  const script = sigAndBeforePolicy(keyHash, 50_000);

  const id = keys.nativeScriptPolicyId(script);
  assert.equal(id.length, 56);
  assert.ok(isHex(id));
  assert.equal(id, id.toLowerCase());

  // The three ways to ask must agree — the ledger and the tests use the
  // static/pure forms, services use the port.
  assert.equal(id, policyIdOf(script));
  assert.equal(id, MemoryKeys.policyIdOf(script));
  assert.equal(id, new MemoryKeys().nativeScriptPolicyId(script));

  // A different slot or key is a different policy.
  assert.notEqual(id, policyIdOf(sigAndBeforePolicy(keyHash, 50_001)));
  assert.notEqual(id, policyIdOf(sigAndBeforePolicy("7b".repeat(28), 50_000)));

  // Canonical JSON sorts keys, so sub-script *order* still matters but field
  // order in the object literal does not.
  assert.equal(
    policyIdOf({
      type: "all",
      scripts: [
        { type: "sig", keyHash },
        { type: "before", slot: 50_000 },
      ],
    }),
    id,
  );
});

test("nativeScriptToJson covers every script variant", () => {
  assert.deepEqual(nativeScriptToJson({ type: "sig", keyHash: "0a".repeat(28) }), {
    type: "sig",
    keyHash: "0a".repeat(28),
  });
  assert.deepEqual(nativeScriptToJson({ type: "after", slot: 3 }), {
    type: "after",
    slot: 3,
  });
  assert.deepEqual(
    nativeScriptToJson({
      type: "atLeast",
      required: 1,
      scripts: [{ type: "any", scripts: [{ type: "before", slot: 9 }] }],
    }),
    {
      type: "atLeast",
      required: 1,
      scripts: [{ type: "any", scripts: [{ type: "before", slot: 9 }] }],
    },
  );
});
