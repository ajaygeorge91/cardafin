// CLI parsing, offline. `parseCliArgs` is pure, so every flag combination
// cardafin accepts (and every one it must reject) is testable with no
// process, no env, no key and no network.

import test from "node:test";
import assert from "node:assert/strict";

import { isErr, isOk } from "../core/result.ts";
import type { Command } from "./args.ts";
import { COMMAND_SPECS, helpText, needsConfig, parseCliArgs } from "./args.ts";

function parse(...argv: string[]): Command {
  const result = parseCliArgs(argv);
  assert.ok(isOk(result), `expected ${argv.join(" ")} to parse, got ${isErr(result) ? result.error.message : ""}`);
  return result.value;
}

function reject(...argv: string[]): string {
  const result = parseCliArgs(argv);
  assert.ok(isErr(result), `expected ${argv.join(" ")} to be rejected`);
  assert.equal(result.error.code === "INVALID_REQUEST" || result.error.code === "NOT_IMPLEMENTED", true);
  return result.error.message;
}

// --- help -----------------------------------------------------------------

test("no arguments is help, not an error", () => {
  assert.deepEqual(parse(), { kind: "help" });
});

test("--help and -h are help, wherever they appear", () => {
  assert.deepEqual(parse("--help"), { kind: "help" });
  assert.deepEqual(parse("-h"), { kind: "help" });
  assert.deepEqual(parse("wallet", "address", "--help"), {
    kind: "help",
    topic: "wallet address",
  });
  assert.deepEqual(parse("wallet", "balance", "--account", "2", "--help"), {
    kind: "help",
    topic: "wallet balance",
  });
});

test("help needs no config; everything else does", () => {
  assert.equal(needsConfig({ kind: "help" }), false);
  assert.equal(needsConfig({ kind: "wallet-new", json: false }), false);
  assert.equal(needsConfig({ kind: "wallet-address", account: 0, json: false }), true);
});

test("the help text lists every command and names the env vars", () => {
  const text = helpText();
  for (const spec of COMMAND_SPECS) {
    assert.ok(text.includes(spec.usage), `help text is missing "${spec.usage}"`);
  }
  assert.match(text, /BLOCKFROST_PROJECT_ID/);
  assert.match(text, /CARDAFIN_MNEMONIC/);
  assert.match(text, /wallet new` and `--help` need none/);
});

test("per-command help shows that command's usage", () => {
  const text = helpText("wallet balance");
  assert.match(text, /^Usage: cardafin wallet balance/);
  assert.match(text, /--address/);
});

test("help for an unknown topic falls back to the full text", () => {
  assert.equal(helpText("nope"), helpText());
});

// --- wallet new -----------------------------------------------------------

test("wallet new parses, with and without --json", () => {
  assert.deepEqual(parse("wallet", "new"), { kind: "wallet-new", json: false });
  assert.deepEqual(parse("wallet", "new", "--json"), { kind: "wallet-new", json: true });
});

test("wallet new takes no other options", () => {
  assert.match(reject("wallet", "new", "--account", "1"), /account/);
});

// --- wallet address -------------------------------------------------------

test("wallet address defaults to account 0 and text output", () => {
  assert.deepEqual(parse("wallet", "address"), {
    kind: "wallet-address",
    account: 0,
    json: false,
  });
});

test("--account is parsed as a whole number", () => {
  assert.deepEqual(parse("wallet", "address", "--account", "7"), {
    kind: "wallet-address",
    account: 7,
    json: false,
  });
  assert.deepEqual(parse("wallet", "address", "--account=7", "--json"), {
    kind: "wallet-address",
    account: 7,
    json: true,
  });
});

test("a non-numeric or negative --account is rejected, never coerced", () => {
  for (const bad of ["-1", "1.5", "2x", "", "0x10", "1e3", " "]) {
    assert.match(
      reject("wallet", "address", `--account=${bad}`),
      /--account|non-negative|whole number/,
      `--account=${bad} should be rejected`,
    );
  }
});

test("an --account larger than a safe integer is rejected", () => {
  assert.match(reject("wallet", "address", "--account=99999999999999999999"), /too large/);
});

// --- wallet balance / utxos -----------------------------------------------

test("wallet balance takes an account or an address", () => {
  assert.deepEqual(parse("wallet", "balance"), {
    kind: "wallet-balance",
    account: 0,
    json: false,
  });
  assert.deepEqual(parse("wallet", "balance", "--account", "3"), {
    kind: "wallet-balance",
    account: 3,
    json: false,
  });
  assert.deepEqual(parse("wallet", "balance", "--address", "addr_test1abc", "--json"), {
    kind: "wallet-balance",
    account: 0,
    address: "addr_test1abc",
    json: true,
  });
});

test("wallet utxos parses the same way", () => {
  assert.deepEqual(parse("wallet", "utxos", "--address=addr_test1abc"), {
    kind: "wallet-utxos",
    account: 0,
    address: "addr_test1abc",
    json: false,
  });
});

test("--account and --address together is an error, not a precedence rule", () => {
  assert.match(
    reject("wallet", "balance", "--account", "1", "--address", "addr_test1abc"),
    /mutually exclusive/,
  );
});

test("an empty --address is rejected", () => {
  assert.match(reject("wallet", "balance", "--address="), /--address is required/);
});

test("an address is trimmed but otherwise passed through for core to validate", () => {
  const cmd = parse("wallet", "balance", "--address", "  addr_test1abc  ");
  assert.equal(cmd.kind === "wallet-balance" ? cmd.address : undefined, "addr_test1abc");
});

// --- unknown input --------------------------------------------------------

test("an unknown command names itself and points at --help", () => {
  const message = reject("teleport");
  assert.match(message, /unknown command "teleport"/);
  assert.match(message, /--help/);
});

test("an unknown subcommand is reported as unknown, not silently truncated", () => {
  assert.match(reject("wallet", "destroy"), /unknown command "wallet destroy"/);
});

test("an extra word after a valid command is an error", () => {
  assert.match(reject("wallet", "address", "extra"), /unexpected argument "extra"/);
});

test("an unknown option is an error, not ignored", () => {
  assert.match(reject("wallet", "address", "--acount", "1"), /acount/);
});

test("a flag with no command is an error that asks for a command", () => {
  assert.match(reject("--json"), /expected a command/);
});

test("`wallet` on its own is unknown: there is no bare wallet command", () => {
  assert.match(reject("wallet"), /unknown command "wallet"/);
});
