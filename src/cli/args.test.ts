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

// --- send-ada -------------------------------------------------------------

test("send-ada parses its required flags", () => {
  assert.deepEqual(parse("send-ada", "--to", "addr_test1abc", "--amount", "1.5"), {
    kind: "send-ada",
    to: "addr_test1abc",
    amount: "1.5",
    account: 0,
    hydra: false,
    yes: false,
    json: false,
  });
});

test("send-ada takes account, hydra, yes and json", () => {
  assert.deepEqual(
    parse(
      "send-ada",
      "--to=addr_test1abc",
      "--amount=2",
      "--account=4",
      "--hydra",
      "--yes",
      "--json",
    ),
    {
      kind: "send-ada",
      to: "addr_test1abc",
      amount: "2",
      account: 4,
      hydra: true,
      yes: true,
      json: true,
    },
  );
});

test("send-ada needs both --to and --amount", () => {
  assert.match(reject("send-ada", "--amount", "1"), /--to is required/);
  assert.match(reject("send-ada", "--to", "addr_test1abc"), /--amount is required/);
  assert.match(reject("send-ada"), /--to is required/);
});

test("an empty --to or --amount is rejected rather than passed on as \"\"", () => {
  assert.match(reject("send-ada", "--to=", "--amount=1"), /--to is required/);
  assert.match(reject("send-ada", "--to=addr_test1abc", "--amount="), /--amount is required/);
});

test("the amount is kept as a string for core to parse, not turned into a float", () => {
  const cmd = parse("send-ada", "--to=addr_test1abc", "--amount=0.100000");
  assert.equal(cmd.kind === "send-ada" ? cmd.amount : undefined, "0.100000");
  // Nonsense amounts are core's business to reject, with the right error
  // code; the CLI must not guess at them.
  const odd = parse("send-ada", "--to=addr_test1abc", "--amount=banana");
  assert.equal(odd.kind === "send-ada" ? odd.amount : undefined, "banana");
});

test("send-ada rejects wallet-only options", () => {
  assert.match(reject("send-ada", "--to=a", "--amount=1", "--address=b"), /address/);
});

test("send-ada needs config", () => {
  assert.equal(
    needsConfig({
      kind: "send-ada",
      to: "a",
      amount: "1",
      account: 0,
      hydra: false,
      yes: false,
      json: false,
    }),
    true,
  );
});

// --- policy new -----------------------------------------------------------

test("policy new defaults to no explicit lock and stdout", () => {
  assert.deepEqual(parse("policy", "new"), {
    kind: "policy-new",
    account: 0,
    json: false,
  });
});

test("policy new takes a relative or an absolute lock, never both", () => {
  assert.deepEqual(parse("policy", "new", "--lock-seconds", "3600"), {
    kind: "policy-new",
    account: 0,
    json: false,
    lockSeconds: 3600,
  });
  assert.deepEqual(parse("policy", "new", "--lock-before-slot=90000000"), {
    kind: "policy-new",
    account: 0,
    json: false,
    lockBeforeSlot: 90_000_000,
  });
  assert.match(
    reject("policy", "new", "--lock-seconds=10", "--lock-before-slot=20"),
    /mutually exclusive/,
  );
});

test("a zero or negative lock is rejected: a policy that is already shut is useless", () => {
  assert.match(reject("policy", "new", "--lock-seconds=0"), /positive whole number/);
  assert.match(reject("policy", "new", "--lock-seconds=-5"), /lock-seconds/);
  assert.match(reject("policy", "new", "--lock-before-slot=abc"), /positive whole number/);
});

test("policy new --out takes a path", () => {
  assert.deepEqual(parse("policy", "new", "--out", "policy.json", "--account=2"), {
    kind: "policy-new",
    account: 2,
    json: false,
    out: "policy.json",
  });
  assert.match(reject("policy", "new", "--out="), /--out must be a file path/);
});

test("`policy` on its own is unknown", () => {
  assert.match(reject("policy"), /unknown command "policy"/);
});

// --- mint -----------------------------------------------------------------

test("mint needs a policy file, a name and a quantity", () => {
  assert.deepEqual(parse("mint", "--policy=p.json", "--name=CARDAFIN", "--quantity=1000"), {
    kind: "mint",
    policy: "p.json",
    name: "CARDAFIN",
    quantity: "1000",
    account: 0,
    hydra: false,
    yes: false,
    json: false,
  });
  assert.match(reject("mint", "--name=X", "--quantity=1"), /--policy is required/);
  assert.match(reject("mint", "--policy=p.json", "--quantity=1"), /--name is required/);
  assert.match(reject("mint", "--policy=p.json", "--name=X"), /--quantity is required/);
});

test("a mint quantity stays a string so core can reject a non-integer with INVALID_AMOUNT", () => {
  const cmd = parse("mint", "--policy=p.json", "--name=X", "--quantity=-5");
  assert.equal(cmd.kind === "mint" ? cmd.quantity : undefined, "-5");
});

test("mint takes a recipient and the three CIP-25 fields", () => {
  assert.deepEqual(
    parse(
      "mint",
      "--policy=p.json",
      "--name=CARDAFIN",
      "--quantity=1",
      "--to=addr_test1abc",
      "--cip25-name=Cardafin",
      "--cip25-image=ipfs://QmHash",
      "--cip25-description=A test token",
      "--account=3",
      "--hydra",
      "--yes",
      "--json",
    ),
    {
      kind: "mint",
      policy: "p.json",
      name: "CARDAFIN",
      quantity: "1",
      to: "addr_test1abc",
      cip25Name: "Cardafin",
      cip25Image: "ipfs://QmHash",
      cip25Description: "A test token",
      account: 3,
      hydra: true,
      yes: true,
      json: true,
    },
  );
});

test("a CIP-25 image or description with no name is rejected: CIP-25 requires a name", () => {
  assert.match(
    reject("mint", "--policy=p.json", "--name=X", "--quantity=1", "--cip25-image=ipfs://Q"),
    /CIP-25 requires a name/,
  );
  assert.match(
    reject("mint", "--policy=p.json", "--name=X", "--quantity=1", "--cip25-description=d"),
    /CIP-25 requires a name/,
  );
});

// --- send-tokens ----------------------------------------------------------

const POLICY_ID = "d27197682d71905c087c5c3b61b10e6d746db0b9bef351014d75bb26";
const UNIT_A = `${POLICY_ID}6361726461666` + "96e";
const UNIT_B = `${POLICY_ID}6f74686572`;

test("send-tokens parses one --asset", () => {
  assert.deepEqual(parse("send-tokens", "--to=addr_test1abc", `--asset=${UNIT_A}=400`), {
    kind: "send-tokens",
    to: "addr_test1abc",
    assets: [{ unit: UNIT_A, quantity: "400" }],
    account: 0,
    hydra: false,
    yes: false,
    json: false,
  });
});

test("--asset repeats, keeping order", () => {
  const cmd = parse(
    "send-tokens",
    "--to=addr_test1abc",
    `--asset=${UNIT_A}=1`,
    `--asset=${UNIT_B}=2`,
  );
  assert.deepEqual(cmd.kind === "send-tokens" ? cmd.assets : [], [
    { unit: UNIT_A, quantity: "1" },
    { unit: UNIT_B, quantity: "2" },
  ]);
});

test("send-tokens needs --to and at least one --asset", () => {
  assert.match(reject("send-tokens", `--asset=${UNIT_A}=1`), /--to is required/);
  assert.match(reject("send-tokens", "--to=addr_test1abc"), /--asset UNIT=QTY is required/);
});

test("a malformed --asset is rejected rather than half-parsed", () => {
  for (const bad of [UNIT_A, `${UNIT_A}=`, `=400`, "="]) {
    assert.match(
      reject("send-tokens", "--to=addr_test1abc", `--asset=${bad}`),
      /--asset must be UNIT=QUANTITY/,
      `--asset=${bad} should be rejected`,
    );
  }
});

test("the same unit given twice is an error, not a silent sum or overwrite", () => {
  assert.match(
    reject(
      "send-tokens",
      "--to=addr_test1abc",
      `--asset=${UNIT_A}=1`,
      `--asset=${UNIT_A}=2`,
    ),
    /was given twice/,
  );
});

test("only the first = splits a unit from its quantity", () => {
  // Quantities are validated by core, not here; the split must not eat one.
  const cmd = parse("send-tokens", "--to=a", `--asset=${UNIT_A}=1=2`);
  assert.deepEqual(cmd.kind === "send-tokens" ? cmd.assets : [], [
    { unit: UNIT_A, quantity: "1=2" },
  ]);
});

test("every write command needs config and appears in the help text", () => {
  const text = helpText();
  for (const name of ["send-ada", "policy new", "mint", "send-tokens"]) {
    assert.ok(
      COMMAND_SPECS.some((c) => c.name === name),
      `${name} is missing from COMMAND_SPECS`,
    );
    assert.ok(text.includes(name), `${name} is missing from the help text`);
  }
  assert.match(text, /--asset UNIT=QTY/);
  assert.match(text, /--lock-before-slot/);
});
