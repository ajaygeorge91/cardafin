// The cardafin CLI: a thin shell over the services, and the way the lucid
// adapter gets smoke-tested on Preview by hand.
//
// Division of labour: `src/cli/args.ts` turns argv into a typed `Command`
// with no I/O at all (and is tested offline); this file does the effects —
// read the environment, wire the app, run one command, print, exit.
//
// Two rules it keeps:
//   * stdout is for data. Every log record goes to stderr via the redacting
//     logger, so `cardafin wallet balance --json | jq` works.
//   * a fresh mnemonic is written to stdout **directly**, never through the
//     logger. The logger's whole job is to make sure a seed phrase cannot be
//     printed; `wallet new` is the one place where printing it is the point,
//     so it bypasses the logger rather than fighting it.
//
// See docs/ARCHITECTURE.md §8 (steps 5–7).

import process from "node:process";
import { createInterface } from "node:readline";

import type { App } from "./app.ts";
import { createApp } from "./app.ts";
import { LucidKeys } from "./adapters/lucid/keys.ts";
import type { Command } from "./cli/args.ts";
import { helpText, needsConfig, parseCliArgs } from "./cli/args.ts";
import { formatAda, lovelaceToAda } from "./core/ada.ts";
import type { Assets } from "./core/assets.ts";
import { LOVELACE, lovelaceOf } from "./core/assets.ts";
import { CardafinError, isCardafinError } from "./core/errors.ts";
import { describePlan } from "./core/plan.ts";
import type { Network } from "./core/network.ts";
import { isMainnet } from "./core/network.ts";
import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";
import type { TxPreview } from "./services/tx.ts";
import type { TxReceipt } from "./ports/executor.ts";
import { tokensOf } from "./services/wallet.ts";

/** Exit 1: the command failed. Exit 2: cardafin is misconfigured. */
const EXIT_FAILED = 1;
const EXIT_MISCONFIGURED = 2;

const MNEMONIC_BANNER =
  "Write this down. cardafin does not store it. Anyone with these words controls the funds.";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function errOut(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** JSON with bigints as decimal strings, because JSON has no bigint. */
function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/** `key   value` lines, aligned. */
function renderFields(fields: Array<[string, string]>): string {
  const width = fields.reduce((w, [k]) => Math.max(w, k.length), 0);
  return fields.map(([k, v]) => `${k.padEnd(width)}  ${v}`).join("\n");
}

function renderTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((h, i) =>
    rows.reduce((w, row) => Math.max(w, (row[i] ?? "").length), h.length),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}

function renderAssets(assets: Assets): string {
  const tokens = tokensOf(assets);
  const ada = `${lovelaceToAda(lovelaceOf(assets))} ADA`;
  if (tokens.length === 0) {
    return ada;
  }
  return [ada, ...tokens.map((t) => `${t.quantity} ${t.assetName || t.unit}`)].join(" + ");
}

// --- confirmation ---------------------------------------------------------

/**
 * Prompts and plan summaries go to **stderr**, not stdout. They are
 * interstitial UI; stdout carries the receipt, so `send-ada --json | jq`
 * still works and a piped run is not corrupted by a question.
 */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise<string>((resolve) => {
      rl.question(question, resolve);
    });
  } finally {
    rl.close();
  }
}

/**
 * The human gate in front of every write. `--yes` skips it on a testnet,
 * which is what makes the CLI scriptable. It does *not* skip it on Mainnet:
 * there the operator has to type the word, because a `--yes` that someone
 * copied out of a Preview runbook must not move real money.
 */
async function confirm(network: Network, yes: boolean): Promise<boolean> {
  if (isMainnet(network)) {
    const answer = await ask(
      'This moves REAL FUNDS on Mainnet. Type "Mainnet" to proceed, anything else to abort: ',
    );
    return answer.trim() === "Mainnet";
  }
  if (yes) {
    return true;
  }
  const answer = await ask("Proceed? [y/N] ");
  return /^(y|yes)$/i.test(answer.trim());
}

function printPreview(preview: TxPreview, config: Config): void {
  errOut(describePlan(preview.plan));
  errOut(
    renderFields([
      ["network", config.network],
      ["route", preview.plan.route],
      ["from", preview.plan.from],
      ["estimated fee", formatAda(preview.estimatedFee)],
    ]),
  );
}

function printReceipt(receipt: TxReceipt, command: { json: boolean }): void {
  if (command.json) {
    out(json(receipt));
    return;
  }
  out(
    renderFields([
      ["tx hash", receipt.txHash],
      ["fee", formatAda(receipt.fee)],
      ["route", receipt.route],
      ...(receipt.explorerUrl ? [["explorer", receipt.explorerUrl] as [string, string]] : []),
    ]),
  );
}

/** Thrown when the operator declines at the prompt. Exit 1, no transaction. */
function aborted(): CardafinError {
  return new CardafinError("INVALID_REQUEST", "aborted: not confirmed");
}

// --- commands -------------------------------------------------------------

/**
 * The only command that both generates a secret and prints it. It needs no
 * Config — no Blockfrost key, no existing mnemonic — because the first thing
 * anyone runs is this, before `.env` exists.
 */
function walletNew(command: { json: boolean }): void {
  const mnemonic = new LucidKeys().generateMnemonic();
  if (command.json) {
    out(json({ mnemonic }));
    return;
  }
  out(MNEMONIC_BANNER);
  out("");
  out(mnemonic);
  out("");
  out("Put it in .env as CARDAFIN_MNEMONIC, then run `cardafin wallet address`.");
}

async function walletAddress(
  app: App,
  config: Config,
  command: { account: number; json: boolean },
): Promise<void> {
  const wallet = await app.wallet.address(command.account);
  if (command.json) {
    out(json(wallet));
    return;
  }
  out(
    renderFields([
      ["network", config.network],
      ["account", String(wallet.accountIndex)],
      ["address", wallet.address],
      ["key hash", wallet.paymentKeyHash],
    ]),
  );
}

/** `--address` wins when given; otherwise derive from the master mnemonic. */
async function resolveAddress(
  app: App,
  command: { account: number; address?: string },
): Promise<string> {
  if (command.address !== undefined) {
    return command.address;
  }
  return (await app.wallet.address(command.account)).address;
}

async function walletBalance(
  app: App,
  config: Config,
  command: { account: number; address?: string; json: boolean },
): Promise<void> {
  const address = await resolveAddress(app, command);
  const report = await app.wallet.balance(address);
  if (command.json) {
    out(json({ address, network: config.network, ...report }));
    return;
  }
  out(
    renderFields([
      ["network", config.network],
      ["address", address],
      ["ADA", report.ada],
    ]),
  );
  if (report.tokens.length > 0) {
    out("");
    out(
      renderTable(
        ["QUANTITY", "ASSET", "UNIT"],
        report.tokens.map((t) => [t.quantity, t.assetName, t.unit]),
      ),
    );
  }
}

async function walletUtxos(
  app: App,
  config: Config,
  command: { account: number; address?: string; json: boolean },
): Promise<void> {
  const address = await resolveAddress(app, command);
  const utxos = await app.wallet.utxos(address);
  if (command.json) {
    out(json({ address, network: config.network, utxos }));
    return;
  }
  if (utxos.length === 0) {
    out(`no unspent outputs at ${address} on ${config.network}`);
    return;
  }
  out(
    renderTable(
      ["UTXO", "VALUE"],
      utxos.map((u) => [`${u.txHash}#${u.outputIndex}`, renderAssets(u.assets)]),
    ),
  );
  out("");
  out(`${utxos.length} unspent output${utxos.length === 1 ? "" : "s"}`);
}

async function sendAda(
  app: App,
  config: Config,
  command: {
    to: string;
    amount: string;
    account: number;
    hydra: boolean;
    yes: boolean;
    json: boolean;
  },
): Promise<void> {
  const request = { to: command.to, amount: command.amount, hydra: command.hydra };

  // Preview first: validate, read the chain, plan, price, check funds — all
  // without signing anything. Then confirm. Then the service plans again
  // against the tip as it is at submit time (see `TxService.preview`).
  const preview = await app.tx.preview("send-ada", request, command.account);
  printPreview(preview, config);
  if (!(await confirm(config.network, command.yes))) {
    throw aborted();
  }

  printReceipt(await app.tx.sendAda(request, command.account), command);
}

// --- dispatch -------------------------------------------------------------

/** The two commands that must work with no `.env` at all. */
function runWithoutConfig(command: Command): void {
  if (command.kind === "help") {
    out(helpText(command.topic));
    return;
  }
  walletNew(command);
}

async function runWithConfig(command: Command, config: Config): Promise<void> {
  const app = createApp(config);
  switch (command.kind) {
    case "wallet-address":
      return walletAddress(app, config, command);
    case "wallet-balance":
      return walletBalance(app, config, command);
    case "wallet-utxos":
      return walletUtxos(app, config, command);
    case "send-ada":
      return sendAda(app, config, command);
    default:
      // `needsConfig` already routed help and `wallet new` elsewhere.
      return runWithoutConfig(command);
  }
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    errOut(`error: ${parsed.error.code} ${parsed.error.message}`);
    process.exitCode = EXIT_FAILED;
    return;
  }
  const command = parsed.value;

  if (!needsConfig(command)) {
    runWithoutConfig(command);
    return;
  }

  // A misconfigured environment is exit 2, reported before any adapter is
  // constructed — no Blockfrost client, no key derivation, no network.
  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    errOut(`error: ${loaded.error.code} ${loaded.error.message}`);
    process.exitCode = EXIT_MISCONFIGURED;
    return;
  }
  await runWithConfig(command, loaded.value);
}

try {
  await main();
} catch (e) {
  if (isCardafinError(e)) {
    errOut(`error: ${e.code} ${e.message}`);
  } else {
    errOut(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.exitCode = EXIT_FAILED;
}
