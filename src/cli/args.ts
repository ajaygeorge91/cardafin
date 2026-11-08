// Command-line parsing, as a pure function.
//
// `parseCliArgs(argv)` takes the raw argument list and returns either a fully
// typed `Command` or a `CardafinError` — no I/O, no `process`, no config, no
// network. That is the whole point: argument parsing is where a CLI is most
// likely to be quietly wrong (a mistyped `--amount` that parses as zero, an
// `--account` that silently becomes NaN), and it is also the part that is
// trivial to test if it is kept pure. `src/cli.ts` does the effects.
//
// Flags come from `node:util`'s `parseArgs` in strict mode, so an unknown or
// misspelled option is an error rather than a silent no-op.

import { parseArgs } from "node:util";

import { fail } from "../core/errors.ts";
import type { Result } from "../core/result.ts";
import { ok } from "../core/result.ts";

export type HelpCommand = { kind: "help"; topic?: string };
export type WalletNewCommand = { kind: "wallet-new"; json: boolean };
export type WalletAddressCommand = {
  kind: "wallet-address";
  account: number;
  json: boolean;
};
export type WalletBalanceCommand = {
  kind: "wallet-balance";
  account: number;
  address?: string;
  json: boolean;
};
export type WalletUtxosCommand = {
  kind: "wallet-utxos";
  account: number;
  address?: string;
  json: boolean;
};

export type SendAdaCommand = {
  kind: "send-ada";
  to: string;
  /** ADA as a decimal string, e.g. "1.5". Core parses it, not the CLI. */
  amount: string;
  account: number;
  hydra: boolean;
  /** Skip the confirmation prompt. Never skips the Mainnet gate in config. */
  yes: boolean;
  json: boolean;
};

export type Command =
  | HelpCommand
  | WalletNewCommand
  | WalletAddressCommand
  | WalletBalanceCommand
  | WalletUtxosCommand
  | SendAdaCommand;

export type CommandSpec = {
  /** The literal words that select this command, space-separated. */
  name: string;
  usage: string;
  summary: string;
};

export const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    name: "wallet new",
    usage: "wallet new [--json]",
    summary:
      "Generate a fresh 24-word mnemonic and print it once. Nothing is stored.",
  },
  {
    name: "wallet address",
    usage: "wallet address [--account N] [--json]",
    summary: "Derive the payment address for an account of CARDAFIN_MNEMONIC.",
  },
  {
    name: "wallet balance",
    usage: "wallet balance [--account N | --address ADDR] [--json]",
    summary: "Read the ADA and native-token balance of an address.",
  },
  {
    name: "wallet utxos",
    usage: "wallet utxos [--account N | --address ADDR] [--json]",
    summary: "List the unspent outputs at an address.",
  },
  {
    name: "send-ada",
    usage: "send-ada --to ADDR --amount ADA [--account N] [--hydra] [--yes]",
    summary: "Send ADA. Shows the plan and the estimated fee, then confirms.",
  },
];

/**
 * Options every command accepts, documented once. `--account` and
 * `--address` are mutually exclusive wherever both appear: one names a wallet
 * cardafin can derive, the other an arbitrary address it can only read.
 */
const COMMON_OPTIONS = `Common options
  --account N      Account index of the master mnemonic (default 0).
  --address ADDR   Read an arbitrary address instead of a derived one.
  --json           Machine-readable output on stdout.
  -h, --help       This text.

Write-command options
  --hydra          Route through a Hydra head (designed, not built: refuses).
  --yes            Skip the confirmation prompt. On Mainnet the prompt still
                   has to be answered with the word Mainnet.`;

const ENV_SUMMARY = `Environment (see .env.example; loaded from .env by \`npm run cli\`)
  CARDAFIN_NETWORK           Preview | Preprod | Mainnet (default Preview).
  BLOCKFROST_PROJECT_ID      Blockfrost project id for that network.
  CARDAFIN_MNEMONIC          24-word master mnemonic.
  CARDAFIN_MAINNET_CONFIRM   Must be I_UNDERSTAND_REAL_FUNDS on Mainnet.

\`wallet new\` and \`--help\` need none of these.`;

export function helpText(topic?: string): string {
  const spec = topic ? COMMAND_SPECS.find((c) => c.name === topic) : undefined;
  if (spec) {
    return [`Usage: cardafin ${spec.usage}`, "", `  ${spec.summary}`, "", COMMON_OPTIONS].join(
      "\n",
    );
  }
  const widest = COMMAND_SPECS.reduce((w, c) => Math.max(w, c.usage.length), 0);
  const commands = COMMAND_SPECS.map(
    (c) => `  cardafin ${c.usage.padEnd(widest)}  ${c.summary}`,
  ).join("\n");
  return [
    "cardafin — a Cardano wallet manager.",
    "",
    "Usage: cardafin <command> [options]",
    "",
    "Commands",
    commands,
    "",
    COMMON_OPTIONS,
    "",
    ENV_SUMMARY,
  ].join("\n");
}

/**
 * Does this command need a `Config`? `wallet new` and `--help` must work with
 * no Blockfrost key and no mnemonic — refusing to print a help page because
 * an env var is missing is the kind of thing that makes a tool useless at
 * exactly the moment someone is trying to set it up.
 */
export function needsConfig(command: Command): boolean {
  return command.kind !== "help" && command.kind !== "wallet-new";
}

type OptionSpec = {
  type: "string" | "boolean";
  multiple?: boolean;
  short?: string;
};

type FlagValues = Record<string, string | boolean | string[] | boolean[] | undefined>;

const BASE_OPTIONS: Record<string, OptionSpec> = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

const ACCOUNT_OPTION: Record<string, OptionSpec> = { account: { type: "string" } };
const WRITE_OPTIONS: Record<string, OptionSpec> = {
  hydra: { type: "boolean" },
  yes: { type: "boolean" },
};
const ADDRESS_OPTION: Record<string, OptionSpec> = { address: { type: "string" } };

function readFlags(
  rest: readonly string[],
  options: Record<string, OptionSpec>,
): Result<FlagValues> {
  try {
    const { values } = parseArgs({
      args: [...rest],
      options: { ...BASE_OPTIONS, ...options },
      allowPositionals: false,
      strict: true,
    });
    return ok(values as FlagValues);
  } catch (e) {
    return fail("INVALID_REQUEST", e instanceof Error ? e.message : String(e));
  }
}

function boolFlag(values: FlagValues, name: string): boolean {
  return values[name] === true;
}

function stringFlag(values: FlagValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

function requireString(values: FlagValues, name: string): Result<string> {
  const value = stringFlag(values, name);
  if (value === undefined || value.trim() === "") {
    return fail("INVALID_REQUEST", `--${name} is required and must not be empty`);
  }
  return ok(value.trim());
}

function parseAccount(values: FlagValues): Result<number> {
  const raw = stringFlag(values, "account");
  if (raw === undefined) {
    return ok(0);
  }
  // Plain digits only: `parseInt("2x")` is 2 and `Number("")` is 0, and
  // deriving the wrong account is a silent way to look at the wrong wallet.
  if (!/^\d+$/.test(raw.trim())) {
    return fail(
      "INVALID_REQUEST",
      `--account must be a non-negative whole number, got "${raw}"`,
    );
  }
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n)) {
    return fail("INVALID_REQUEST", `--account ${raw} is too large`);
  }
  return ok(n);
}

/** `--account` and `--address` answer the same question two ways. */
function rejectAccountAndAddress(values: FlagValues): Result<true> {
  if (stringFlag(values, "account") !== undefined && stringFlag(values, "address") !== undefined) {
    return fail(
      "INVALID_REQUEST",
      "--account and --address are mutually exclusive: --account derives a wallet, --address reads any address",
    );
  }
  return ok(true);
}

/**
 * Split leading command words from flags. Command words always come first and
 * never start with "-", so the first dashed token ends the command name —
 * which also means an option *value* can never be mistaken for one.
 */
function splitCommand(argv: readonly string[]): { name: string; rest: string[] } {
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined || token.startsWith("-")) {
      break;
    }
    i++;
  }
  return { name: argv.slice(0, i).join(" "), rest: [...argv.slice(i)] };
}

/** The longest command name that `argv` starts with, or undefined. */
function matchCommand(name: string): CommandSpec | undefined {
  let best: CommandSpec | undefined;
  for (const spec of COMMAND_SPECS) {
    if (
      (name === spec.name || name.startsWith(`${spec.name} `)) &&
      (best === undefined || spec.name.length > best.name.length)
    ) {
      best = spec;
    }
  }
  return best;
}

export function parseCliArgs(argv: readonly string[]): Result<Command> {
  const { name, rest } = splitCommand(argv);
  const wantsHelp = rest.includes("--help") || rest.includes("-h");

  if (name === "") {
    // No command at all: `cardafin`, `cardafin --help`, or only flags.
    if (wantsHelp || rest.length === 0) {
      return ok({ kind: "help" });
    }
    return fail(
      "INVALID_REQUEST",
      `expected a command before ${rest[0]}; run \`cardafin --help\``,
    );
  }

  const spec = matchCommand(name);
  if (!spec) {
    return fail(
      "INVALID_REQUEST",
      `unknown command "${name}"; run \`cardafin --help\` for the list`,
    );
  }
  if (name !== spec.name) {
    return fail(
      "INVALID_REQUEST",
      `unexpected argument "${name.slice(spec.name.length).trim()}" after \`${spec.name}\`; run \`cardafin ${spec.name} --help\``,
    );
  }
  if (wantsHelp) {
    return ok({ kind: "help", topic: spec.name });
  }

  switch (spec.name) {
    case "wallet new":
      return walletNew(rest);
    case "wallet address":
      return walletAddress(rest);
    case "wallet balance":
      return walletTarget("wallet-balance", rest);
    case "wallet utxos":
      return walletTarget("wallet-utxos", rest);
    case "send-ada":
      return sendAda(rest);
    default:
      // Unreachable while COMMAND_SPECS and this switch agree; a new spec
      // without a branch should fail loudly rather than parse as something.
      return fail("NOT_IMPLEMENTED", `command "${spec.name}" has no parser`);
  }
}

function walletNew(rest: readonly string[]): Result<Command> {
  const values = readFlags(rest, {});
  if (!values.ok) {
    return values;
  }
  return ok({ kind: "wallet-new", json: boolFlag(values.value, "json") });
}

function walletAddress(rest: readonly string[]): Result<Command> {
  const values = readFlags(rest, ACCOUNT_OPTION);
  if (!values.ok) {
    return values;
  }
  const account = parseAccount(values.value);
  if (!account.ok) {
    return account;
  }
  return ok({
    kind: "wallet-address",
    account: account.value,
    json: boolFlag(values.value, "json"),
  });
}

function walletTarget(
  kind: "wallet-balance" | "wallet-utxos",
  rest: readonly string[],
): Result<Command> {
  const values = readFlags(rest, { ...ACCOUNT_OPTION, ...ADDRESS_OPTION });
  if (!values.ok) {
    return values;
  }
  const exclusive = rejectAccountAndAddress(values.value);
  if (!exclusive.ok) {
    return exclusive;
  }
  const account = parseAccount(values.value);
  if (!account.ok) {
    return account;
  }
  const json = boolFlag(values.value, "json");
  const address = stringFlag(values.value, "address");
  if (address !== undefined) {
    const required = requireString(values.value, "address");
    if (!required.ok) {
      return required;
    }
    return ok({ kind, account: account.value, address: required.value, json });
  }
  return ok({ kind, account: account.value, json });
}

function sendAda(rest: readonly string[]): Result<Command> {
  const values = readFlags(rest, {
    ...ACCOUNT_OPTION,
    ...WRITE_OPTIONS,
    to: { type: "string" },
    amount: { type: "string" },
  });
  if (!values.ok) {
    return values;
  }
  const to = requireString(values.value, "to");
  if (!to.ok) {
    return to;
  }
  const amount = requireString(values.value, "amount");
  if (!amount.ok) {
    return amount;
  }
  const account = parseAccount(values.value);
  if (!account.ok) {
    return account;
  }
  return ok({
    kind: "send-ada",
    to: to.value,
    // Left as a string for `core/requests.ts` to parse: ADA has six decimals
    // and no float should ever touch an amount.
    amount: amount.value,
    account: account.value,
    hydra: boolFlag(values.value, "hydra"),
    yes: boolFlag(values.value, "yes"),
    json: boolFlag(values.value, "json"),
  });
}
