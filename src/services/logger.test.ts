import test from "node:test";
import assert from "node:assert/strict";

import type { LogLevel } from "../ports/logger.ts";
import {
  CBOR_HEX_MIN_LENGTH,
  MIN_SECRET_LENGTH,
  REDACTED,
  createLogger,
  nullLogger,
  redactData,
  redactString,
  stderrSink,
} from "./logger.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;
// A fake Blockfrost-shaped project id. Not a credential for anything.
const FAKE_PROJECT_ID = "previewFAKEnotarealblockfrostkey01";
// A fake "signed transaction": 500 hex characters, which is what rule 4 is for.
const FAKE_TX_CBOR = "84a400".padEnd(500, "9f");

type Record_ = { level: LogLevel; msg: string; data: Record<string, unknown> };

function capture(opts: { level?: LogLevel; secrets?: string[] } = {}) {
  const lines: Record_[] = [];
  const log = createLogger({
    secrets: opts.secrets ?? [THROWAWAY_MNEMONIC, FAKE_PROJECT_ID],
    sink: (level, msg, data) => lines.push({ level, msg, data }),
    ...(opts.level ? { level: opts.level } : {}),
  });
  return { log, lines };
}

/** Everything a sink received, as one string, with bigints made printable. */
function flatten(lines: Record_[]): string {
  return JSON.stringify(lines, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

test("rule 1: a configured secret is scrubbed from the message and from data at any depth", () => {
  const { log, lines } = capture();
  log.info(`restoring with ${THROWAWAY_MNEMONIC} against ${FAKE_PROJECT_ID}`, {
    // A key nobody thought to call "secret" — content matching still catches it.
    note: `project ${FAKE_PROJECT_ID}`,
    deep: { deeper: [{ phrase: THROWAWAY_MNEMONIC }] },
  });

  const line = lines[0];
  assert.ok(line);
  assert.equal(line.msg, `restoring with ${REDACTED} against ${REDACTED}`);
  assert.equal(line.data.note, `project ${REDACTED}`);
  assert.deepEqual(line.data.deep, { deeper: [{ phrase: REDACTED }] });

  const all = flatten(lines);
  assert.equal(all.includes("abandon"), false);
  assert.equal(all.includes(FAKE_PROJECT_ID), false);
});

test("rule 1: secrets shorter than the floor are ignored, so ordinary text survives", () => {
  // "art" is 3 characters. Redacting it would blank out "started", "partial"…
  const { log, lines } = capture({ secrets: ["art", "ok"] });
  log.info("started the art of parting");
  assert.equal(lines[0]?.msg, "started the art of parting");
  assert.equal(MIN_SECRET_LENGTH, 8);
  assert.equal(redactString("short", ["short"]), "short");
  assert.equal(redactString("longenough", ["longenough"]), REDACTED);
});

test("rule 2: a secret-ish key has its value replaced, at any depth and in any case", () => {
  const { log, lines } = capture({ secrets: [] });
  log.info("wiring", {
    mnemonic: "whatever words these are",
    MNEMONIC: "upper",
    seed: 12345,
    txCbor: "84a400",
    witnessSet: ["a", "b"],
    privateKey: "x",
    private_key: "x",
    apiKey: "x",
    api_key: "x",
    clientSecret: "x",
    projectId: "x",
    project_id: "x",
    nested: { walletSeedPhrase: "x", fine: "kept" },
    // Not secret-ish: these must survive untouched.
    txHash: "ab".repeat(32),
    policyId: "cd".repeat(28),
    network: "Preview",
  });

  const data = lines[0]?.data;
  assert.ok(data);
  for (const key of [
    "mnemonic",
    "MNEMONIC",
    "seed",
    "txCbor",
    "witnessSet",
    "privateKey",
    "private_key",
    "apiKey",
    "api_key",
    "clientSecret",
    "projectId",
    "project_id",
  ]) {
    assert.equal(data[key], REDACTED, `${key} was not redacted`);
  }
  assert.deepEqual(data.nested, { walletSeedPhrase: REDACTED, fine: "kept" });
  assert.equal(data.txHash, "ab".repeat(32));
  assert.equal(data.policyId, "cd".repeat(28));
  assert.equal(data.network, "Preview");
});

test("rule 3: a 24-lowercase-word run is redacted even when it is not a known secret", () => {
  // Nothing is configured as a secret here: the *shape* is what triggers it.
  const { log, lines } = capture({ secrets: [] });
  log.warn("recovery attempt", {
    userInput: THROWAWAY_MNEMONIC,
    embedded: `the phrase is ${THROWAWAY_MNEMONIC} apparently`,
  });

  assert.equal(lines[0]?.data.userInput, REDACTED);
  // The surrounding lowercase prose is swallowed too: the rule matches a run
  // of 24 *or more* words so that no tail of the phrase can survive.
  assert.equal(lines[0]?.data.embedded, REDACTED);
  assert.equal(flatten(lines).includes("abandon"), false);

  // 23 words is not a mnemonic shape and must not be touched.
  const twentyThree = `${"abandon ".repeat(22)}art`;
  assert.equal(redactString(twentyThree, []), twentyThree);
  // Neither is a capitalised sentence of 24 words.
  const capitalised = `Abandon ${"abandon ".repeat(22)}art`;
  assert.equal(redactString(capitalised, []), capitalised);
});

test("rule 4: a long hex run is reported by length, never by content", () => {
  const { log, lines } = capture({ secrets: [] });
  log.debug("ignored at the default level");
  log.error("submit failed", { body: FAKE_TX_CBOR, inline: `cbor=${FAKE_TX_CBOR}!` });

  assert.equal(FAKE_TX_CBOR.length, 500);
  assert.equal(lines[0]?.data.body, "[REDACTED:hex len 500]");
  assert.equal(lines[0]?.data.inline, "cbor=[REDACTED:hex len 500]!");
  assert.equal(flatten(lines).includes(FAKE_TX_CBOR.slice(0, 80)), false);

  // A 64-hex tx hash and a 56-hex policy id are far below the floor and stay.
  assert.equal(CBOR_HEX_MIN_LENGTH, 400);
  const txHash = "ab".repeat(32);
  assert.equal(redactString(txHash, []), txHash);
  const justUnder = "a".repeat(CBOR_HEX_MIN_LENGTH - 1);
  assert.equal(redactString(justUnder, []), justUnder);
  assert.equal(
    redactString("f".repeat(CBOR_HEX_MIN_LENGTH), []),
    `[REDACTED:hex len ${CBOR_HEX_MIN_LENGTH}]`,
  );
});

test("level filtering: debug is off by default and on when asked", () => {
  const quiet = capture();
  quiet.log.debug("nope");
  quiet.log.info("yes");
  quiet.log.warn("yes");
  quiet.log.error("yes");
  assert.deepEqual(quiet.lines.map((l) => l.level), ["info", "warn", "error"]);

  const loud = capture({ level: "debug" });
  loud.log.debug("now emitted");
  assert.equal(loud.lines.length, 1);

  const silent = capture({ level: "error" });
  silent.log.info("dropped");
  silent.log.error("kept");
  assert.deepEqual(silent.lines.map((l) => l.msg), ["kept"]);
});

test("data is optional, bigints survive, and cycles do not hang the logger", () => {
  const { log, lines } = capture({ secrets: [] });
  log.info("no data");
  assert.deepEqual(lines[0]?.data, {});

  log.info("fee", { fee: 168_581n });
  assert.equal(lines[1]?.data.fee, 168_581n);

  const cyclic: Record<string, unknown> = { name: "loop" };
  cyclic.self = cyclic;
  log.info("cyclic", cyclic);
  assert.equal(lines[2]?.data.name, "loop");
  // Depth-limited rather than infinite: the exact marker is an implementation
  // detail, not hanging is the contract.
  assert.ok(JSON.stringify(lines[2]?.data).includes("too deep"));
});

test("an Error value is reduced to name + redacted message", () => {
  const { log, lines } = capture();
  log.error("failed", { cause: new Error(`bad seed ${FAKE_PROJECT_ID}`) });
  assert.deepEqual(lines[0]?.data.cause, {
    name: "Error",
    message: `bad seed ${REDACTED}`,
  });
});

test("redactData and the default stderr sink are usable directly", () => {
  assert.deepEqual(redactData({ mnemonic: "x", keep: "y" }, []), {
    mnemonic: REDACTED,
    keep: "y",
  });

  // stderrSink must serialise bigints rather than throwing on them.
  const original = process.stderr.write.bind(process.stderr);
  const written: string[] = [];
  process.stderr.write = ((chunk: string) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    stderrSink("info", "submitted", { fee: 168_581n, txHash: "ab" });
  } finally {
    process.stderr.write = original;
  }
  assert.equal(written.length, 1);
  const line = written[0] ?? "";
  assert.ok(line.endsWith("\n"));
  const parsed = JSON.parse(line) as Record<string, unknown>;
  assert.equal(parsed.level, "info");
  assert.equal(parsed.msg, "submitted");
  assert.equal(parsed.fee, "168581");
  assert.equal(typeof parsed.ts, "string");
});

test("nullLogger accepts everything and does nothing", () => {
  const log = nullLogger();
  log.debug("a");
  log.info("b", { mnemonic: THROWAWAY_MNEMONIC });
  log.warn("c");
  log.error("d");
  assert.ok(true);
});
