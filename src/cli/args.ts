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

export type PolicyNewCommand = {
  kind: "policy-new";
  /** Lock the policy this many seconds from the current slot. */
  lockSeconds?: number;
  /** Absolute lock slot; takes precedence over `lockSeconds`. */
  lockBeforeSlot?: number;
  account: number;
  /** Write the PolicyInfo JSON here instead of to stdout. */
  out?: string;
  json: boolean;
};

export type AssetAmount = { unit: string; quantity: string };

export type MintCommand = {
  kind: "mint";
  /** Path to a PolicyInfo JSON file, as written by `policy new --out`. */
  policy: string;
  name: string;
  quantity: string;
  to?: string;
  cip25Name?: string;
  cip25Image?: string;
  cip25Description?: string;
  account: number;
  hydra: boolean;
  yes: boolean;
  json: boolean;
};

export type SendTokensCommand = {
  kind: "send-tokens";
  to: string;
  assets: AssetAmount[];
  account: number;
  hydra: boolean;
  yes: boolean;
  json: boolean;
};

export type Command =
  | HelpCommand
  | WalletNewCommand
  | WalletAddressCommand
  | WalletBalanceCommand
  | WalletUtxosCommand
  | SendAdaCommand
  | PolicyNewCommand
  | MintCommand
  | SendTokensCommand;

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
  {
    name: "policy new",
    usage: "policy new [--lock-seconds S | --lock-before-slot SLOT] [--out FILE]",
    summary:
      "Create a time-locked minting policy and print its JSON. Keep that file.",
  },
  {
    name: "mint",
    usage: "mint --policy FILE --name NAME --quantity Q [--to ADDR] [--yes]",
    summary: "Mint (or, with a negative quantity, burn) under a saved policy.",
  },
  {
    name: "send-tokens",
    usage: "send-tokens --to ADDR --asset UNIT=QTY [--asset ...] [--yes]",
    summary: "Send native tokens. cardafin adds the recipient's min-ADA.",
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
                   has to be answered with the word Mainnet.

Minting options
  --policy FILE          PolicyInfo JSON from \`policy new\`. Required to mint.
  --name NAME            Asset name, at most 32 UTF-8 bytes.
  --quantity Q           Whole number; negative burns.
  --cip25-name X         CIP-25 display name (label 721).
  --cip25-image U        CIP-25 image URI, usually ipfs://...
  --cip25-description D  CIP-25 description.
  --asset UNIT=QTY       Repeatable, for \`send-tokens\`. UNIT is policyId+hex.
  --lock-seconds S       \`policy new\`: lock the policy S seconds from now.
  --lock-before-slot N   \`policy new\`: lock it at an absolute slot.
  --out FILE             \`policy new\`: write the JSON here instead of stdout.`;

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
    case "policy new":
      return policyNew(rest);
    case "mint":
      return mint(rest);
    case "send-tokens":
      return sendTokens(rest);
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

/** A positive whole number flag, or undefined when absent. */
function optionalCount(
  values: FlagValues,
  name: string,
): Result<number | undefined> {
  const raw = stringFlag(values, name);
  if (raw === undefined) {
    return ok(undefined);
  }
  if (!/^\d+$/.test(raw.trim())) {
    return fail(
      "INVALID_REQUEST",
      `--${name} must be a positive whole number, got "${raw}"`,
    );
  }
  const n = Number(raw.trim());
  if (!Number.isSafeInteger(n) || n <= 0) {
    return fail("INVALID_REQUEST", `--${name} must be a positive whole number`);
  }
  return ok(n);
}

function policyNew(rest: readonly string[]): Result<Command> {
  const values = readFlags(rest, {
    ...ACCOUNT_OPTION,
    "lock-seconds": { type: "string" },
    "lock-before-slot": { type: "string" },
    out: { type: "string" },
  });
  if (!values.ok) {
    return values;
  }
  const lockSeconds = optionalCount(values.value, "lock-seconds");
  if (!lockSeconds.ok) {
    return lockSeconds;
  }
  const lockBeforeSlot = optionalCount(values.value, "lock-before-slot");
  if (!lockBeforeSlot.ok) {
    return lockBeforeSlot;
  }
  if (lockSeconds.value !== undefined && lockBeforeSlot.value !== undefined) {
    return fail(
      "INVALID_REQUEST",
      "--lock-seconds and --lock-before-slot are mutually exclusive: one is relative, the other absolute",
    );
  }
  const account = parseAccount(values.value);
  if (!account.ok) {
    return account;
  }
  const out = stringFlag(values.value, "out");
  if (out !== undefined && out.trim() === "") {
    return fail("INVALID_REQUEST", "--out must be a file path");
  }
  return ok({
    kind: "policy-new",
    account: account.value,
    json: boolFlag(values.value, "json"),
    ...(lockSeconds.value !== undefined ? { lockSeconds: lockSeconds.value } : {}),
    ...(lockBeforeSlot.value !== undefined
      ? { lockBeforeSlot: lockBeforeSlot.value }
      : {}),
    ...(out !== undefined ? { out: out.trim() } : {}),
  });
}

function mint(rest: readonly string[]): Result<Command> {
  const values = readFlags(rest, {
    ...ACCOUNT_OPTION,
    ...WRITE_OPTIONS,
    policy: { type: "string" },
    name: { type: "string" },
    quantity: { type: "string" },
    to: { type: "string" },
    "cip25-name": { type: "string" },
    "cip25-image": { type: "string" },
    "cip25-description": { type: "string" },
  });
  if (!values.ok) {
    return values;
  }
  const policy = requireString(values.value, "policy");
  if (!policy.ok) {
    return policy;
  }
  const name = requireString(values.value, "name");
  if (!name.ok) {
    return name;
  }
  const quantity = requireString(values.value, "quantity");
  if (!quantity.ok) {
    return quantity;
  }
  const account = parseAccount(values.value);
  if (!account.ok) {
    return account;
  }
  const to = stringFlag(values.value, "to")?.trim();
  if (to !== undefined && to === "") {
    return fail("INVALID_REQUEST", "--to must be a non-empty address");
  }
  const cip25Name = stringFlag(values.value, "cip25-name");
  const cip25Image = stringFlag(values.value, "cip25-image");
  const cip25Description = stringFlag(values.value, "cip25-description");
  if (cip25Name === undefined && (cip25Image !== undefined || cip25Description !== undefined)) {
    // CIP-25 requires `name`; an image with no name is a metadata payload
    // that wallets will not display, which is worse than refusing it.
    return fail(
      "INVALID_REQUEST",
      "--cip25-image and --cip25-description need --cip25-name: CIP-25 requires a name",
    );
  }
  return ok({
    kind: "mint",
    policy: policy.value,
    name: name.value,
    quantity: quantity.value,
    account: account.value,
    hydra: boolFlag(values.value, "hydra"),
    yes: boolFlag(values.value, "yes"),
    json: boolFlag(values.value, "json"),
    ...(to !== undefined ? { to } : {}),
    ...(cip25Name !== undefined ? { cip25Name } : {}),
    ...(cip25Image !== undefined ? { cip25Image } : {}),
    ...(cip25Description !== undefined ? { cip25Description } : {}),
  });
}

/** `--asset UNIT=QTY`, repeatable. Split on the first "=" only. */
function parseAssetFlags(values: FlagValues): Result<AssetAmount[]> {
  const raw = values.asset;
  const entries: string[] =
    raw === undefined ? [] : Array.isArray(raw) ? raw.map(String) : [String(raw)];
  if (entries.length === 0) {
    return fail(
      "INVALID_REQUEST",
      "--asset UNIT=QTY is required at least once (UNIT is the 56-hex policy id followed by the asset name in hex)",
    );
  }
  const assets: AssetAmount[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const at = entry.indexOf("=");
    if (at <= 0 || at === entry.length - 1) {
      return fail(
        "INVALID_REQUEST",
        `--asset must be UNIT=QUANTITY, got "${entry}"`,
      );
    }
    const unit = entry.slice(0, at).trim();
    const quantity = entry.slice(at + 1).trim();
    if (unit === "" || quantity === "") {
      return fail("INVALID_REQUEST", `--asset must be UNIT=QUANTITY, got "${entry}"`);
    }
    if (seen.has(unit)) {
      // Two quantities for one unit is ambiguous: summing and overwriting are
      // both defensible, so neither is guessed.
      return fail("INVALID_REQUEST", `--asset ${unit} was given twice`);
    }
    seen.add(unit);
    assets.push({ unit, quantity });
  }
  return ok(assets);
}

function sendTokens(rest: readonly string[]): Result<Command> {
  const values = readFlags(rest, {
    ...ACCOUNT_OPTION,
    ...WRITE_OPTIONS,
    to: { type: "string" },
    asset: { type: "string", multiple: true },
  });
  if (!values.ok) {
    return values;
  }
  const to = requireString(values.value, "to");
  if (!to.ok) {
    return to;
  }
  const assets = parseAssetFlags(values.value);
  if (!assets.ok) {
    return assets;
  }
  const account = parseAccount(values.value);
  if (!account.ok) {
    return account;
  }
  return ok({
    kind: "send-tokens",
    to: to.value,
    assets: assets.value,
    account: account.value,
    hydra: boolFlag(values.value, "hydra"),
    yes: boolFlag(values.value, "yes"),
    json: boolFlag(values.value, "json"),
  });
}
