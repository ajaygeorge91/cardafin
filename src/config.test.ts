import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { isCardafinError } from "./core/errors.ts";
import type { Config } from "./config.ts";
import {
  DEFAULT_HTTP_PORT,
  MAINNET_CONFIRM_TOKEN,
  MAX_PORT,
  MNEMONIC_WORD_COUNTS,
  PLACEHOLDER_PROJECT_ID,
  assertMainnetAllowed,
  loadConfig,
  secretsOf,
} from "./config.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;
const FAKE_PROJECT_ID = "previewFAKEnotarealblockfrostkey01";

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    BLOCKFROST_PROJECT_ID: FAKE_PROJECT_ID,
    CARDAFIN_MNEMONIC: THROWAWAY_MNEMONIC,
    ...extra,
  };
}

function expectOk(e: Record<string, string | undefined>): Config {
  const result = loadConfig(e);
  if (!result.ok) {
    assert.fail(`loadConfig failed: ${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function expectErr(e: Record<string, string | undefined>, code: string, re?: RegExp): void {
  const result = loadConfig(e);
  assert.equal(result.ok, false, "expected loadConfig to fail");
  if (result.ok) {
    return;
  }
  assert.ok(isCardafinError(result.error));
  assert.equal(result.error.code, code, result.error.message);
  if (re) {
    assert.match(result.error.message, re);
  }
}

test("config.ts never reads process.env", async () => {
  // The whole point of taking the environment as an argument. A reference to
  // `process.env` anywhere in this module would make the rules untestable.
  const source = await readFile("src/config.ts", "utf8");
  assert.equal(/process\s*\.\s*env/.test(source), false);
  assert.equal(source.includes("node:process"), false);
});

test("defaults: Preview, port 8787, no api keys, derived Blockfrost URL", () => {
  const config = expectOk(env());
  assert.equal(config.network, "Preview");
  assert.equal(config.blockfrostUrl, "https://cardano-preview.blockfrost.io/api/v0");
  assert.equal(config.httpPort, DEFAULT_HTTP_PORT);
  assert.deepEqual(config.apiKeys, []);
  assert.equal(config.mainnetConfirmed, false);
  assert.equal(config.mnemonic, THROWAWAY_MNEMONIC);
  assert.equal(config.blockfrostProjectId, FAKE_PROJECT_ID);
});

test("CARDAFIN_NETWORK is parsed by core and the URL follows it", () => {
  assert.equal(expectOk(env({ CARDAFIN_NETWORK: "Preprod" })).network, "Preprod");
  assert.equal(
    expectOk(env({ CARDAFIN_NETWORK: "Preprod" })).blockfrostUrl,
    "https://cardano-preprod.blockfrost.io/api/v0",
  );
  // Blank is the same as absent.
  assert.equal(expectOk(env({ CARDAFIN_NETWORK: "   " })).network, "Preview");
  expectErr(env({ CARDAFIN_NETWORK: "Testnet" }), "INVALID_REQUEST");
  expectErr(env({ CARDAFIN_NETWORK: "preview" }), "INVALID_REQUEST");
});

test("BLOCKFROST_PROJECT_ID is required, and the placeholder is refused by name", () => {
  expectErr(env({ BLOCKFROST_PROJECT_ID: undefined }), "INVALID_REQUEST", /BLOCKFROST_PROJECT_ID/);
  expectErr(env({ BLOCKFROST_PROJECT_ID: "" }), "INVALID_REQUEST", /BLOCKFROST_PROJECT_ID/);
  expectErr(env({ BLOCKFROST_PROJECT_ID: "   " }), "INVALID_REQUEST", /BLOCKFROST_PROJECT_ID/);
  expectErr(
    env({ BLOCKFROST_PROJECT_ID: PLACEHOLDER_PROJECT_ID }),
    "INVALID_REQUEST",
    /still the placeholder .* from \.env\.example/,
  );
  // Quotes that survived the env file are stripped.
  assert.equal(
    expectOk(env({ BLOCKFROST_PROJECT_ID: `"${FAKE_PROJECT_ID}"` })).blockfrostProjectId,
    FAKE_PROJECT_ID,
  );
});

test("CARDAFIN_MNEMONIC: required, trimmed, unquoted, 12/15/18/21/24 words", () => {
  expectErr(env({ CARDAFIN_MNEMONIC: undefined }), "INVALID_REQUEST", /CARDAFIN_MNEMONIC/);
  expectErr(env({ CARDAFIN_MNEMONIC: "  " }), "INVALID_REQUEST", /CARDAFIN_MNEMONIC/);

  assert.deepEqual([...MNEMONIC_WORD_COUNTS], [12, 15, 18, 21, 24]);
  for (const count of MNEMONIC_WORD_COUNTS) {
    const phrase = Array.from({ length: count }, () => "abandon").join(" ");
    assert.equal(expectOk(env({ CARDAFIN_MNEMONIC: phrase })).mnemonic, phrase);
  }
  for (const count of [1, 11, 13, 23, 25]) {
    const phrase = Array.from({ length: count }, () => "abandon").join(" ");
    expectErr(env({ CARDAFIN_MNEMONIC: phrase }), "INVALID_REQUEST", /must be 12, 15/);
  }

  // Quotes stripped, surrounding whitespace trimmed, inner spacing untouched.
  assert.equal(
    expectOk(env({ CARDAFIN_MNEMONIC: `  "${THROWAWAY_MNEMONIC}"  ` })).mnemonic,
    THROWAWAY_MNEMONIC,
  );
  assert.equal(
    expectOk(env({ CARDAFIN_MNEMONIC: `'${THROWAWAY_MNEMONIC}'` })).mnemonic,
    THROWAWAY_MNEMONIC,
  );
  // Word *validity* is the KeyPort's job, not config's: 24 nonsense words load.
  const nonsense = Array.from({ length: 24 }, (_v, i) => `zzz${i}`).join(" ");
  assert.equal(expectOk(env({ CARDAFIN_MNEMONIC: nonsense })).mnemonic, nonsense);
});

test("Mainnet needs the confirm token spelled exactly", () => {
  assert.equal(MAINNET_CONFIRM_TOKEN, "I_UNDERSTAND_REAL_FUNDS");
  expectErr(
    env({ CARDAFIN_NETWORK: "Mainnet" }),
    "MAINNET_NOT_CONFIRMED",
    /CARDAFIN_MAINNET_CONFIRM=I_UNDERSTAND_REAL_FUNDS/,
  );
  expectErr(
    env({ CARDAFIN_NETWORK: "Mainnet", CARDAFIN_MAINNET_CONFIRM: "yes" }),
    "MAINNET_NOT_CONFIRMED",
  );
  expectErr(
    env({ CARDAFIN_NETWORK: "Mainnet", CARDAFIN_MAINNET_CONFIRM: "i_understand_real_funds" }),
    "MAINNET_NOT_CONFIRMED",
  );

  const confirmed = expectOk(
    env({ CARDAFIN_NETWORK: "Mainnet", CARDAFIN_MAINNET_CONFIRM: MAINNET_CONFIRM_TOKEN }),
  );
  assert.equal(confirmed.network, "Mainnet");
  assert.equal(confirmed.mainnetConfirmed, true);

  // The token is recorded on a testnet config too, harmlessly.
  assert.equal(
    expectOk(env({ CARDAFIN_MAINNET_CONFIRM: MAINNET_CONFIRM_TOKEN })).mainnetConfirmed,
    true,
  );
});

test("CARDAFIN_HTTP_PORT must be a whole number in 1..65535", () => {
  assert.equal(expectOk(env({ CARDAFIN_HTTP_PORT: "3000" })).httpPort, 3000);
  assert.equal(expectOk(env({ CARDAFIN_HTTP_PORT: " 1 " })).httpPort, 1);
  assert.equal(expectOk(env({ CARDAFIN_HTTP_PORT: String(MAX_PORT) })).httpPort, MAX_PORT);
  assert.equal(expectOk(env({ CARDAFIN_HTTP_PORT: "" })).httpPort, DEFAULT_HTTP_PORT);

  for (const bad of ["0", "-1", "65536", "80.5", "80abc", "abc", "1e4", "0x50"]) {
    expectErr(env({ CARDAFIN_HTTP_PORT: bad }), "INVALID_REQUEST", /CARDAFIN_HTTP_PORT/);
  }
});

test("CARDAFIN_API_KEYS splits on commas, trims and drops empties", () => {
  assert.deepEqual(expectOk(env({ CARDAFIN_API_KEYS: "a,b,c" })).apiKeys, ["a", "b", "c"]);
  assert.deepEqual(expectOk(env({ CARDAFIN_API_KEYS: " a , , b ," })).apiKeys, ["a", "b"]);
  assert.deepEqual(expectOk(env({ CARDAFIN_API_KEYS: ",,," })).apiKeys, []);
  assert.deepEqual(expectOk(env({ CARDAFIN_API_KEYS: "" })).apiKeys, []);
});

test("secretsOf is exactly what the logger must scrub", () => {
  const config = expectOk(env());
  assert.deepEqual(secretsOf(config), [THROWAWAY_MNEMONIC, FAKE_PROJECT_ID]);
  // API keys are bearer tokens for inbound requests, not outbound secrets, so
  // they are deliberately absent; nothing logs them.
  assert.equal(secretsOf({ ...config, mnemonic: "", blockfrostProjectId: "" }).length, 0);
});

test("assertMainnetAllowed is the second gate, for configs built in code", () => {
  const preview = expectOk(env());
  assert.doesNotThrow(() => assertMainnetAllowed(preview));

  const confirmed = expectOk(
    env({ CARDAFIN_NETWORK: "Mainnet", CARDAFIN_MAINNET_CONFIRM: MAINNET_CONFIRM_TOKEN }),
  );
  assert.doesNotThrow(() => assertMainnetAllowed(confirmed));

  // loadConfig can never produce this, but a hand-built Config can.
  assert.throws(
    () => assertMainnetAllowed({ ...confirmed, mainnetConfirmed: false }),
    (e: unknown) => {
      assert.ok(isCardafinError(e));
      assert.equal(e.code, "MAINNET_NOT_CONFIRMED");
      return true;
    },
  );
});
