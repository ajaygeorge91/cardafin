// The redacting logger. cardafin handles a master mnemonic, a Blockfrost
// project id and signed transaction CBOR; none of those may ever reach a log
// line. Rather than trusting every call site to be careful, the only Logger
// implementation in the repo redacts on the way out.
//
// Four rules, in order (see docs/ARCHITECTURE.md §6):
//   1. known secrets  — any configured secret string (>= 8 chars) occurring
//      anywhere in the message or in any string value in `data`, however
//      deeply nested.
//   2. secret-ish keys — any `data` key matching SECRET_KEY_RE, at any depth
//      and in any case, has its whole value replaced.
//   3. mnemonic shapes — any run of 24 *or more* lowercase words separated by
//      single spaces, even if it is not the configured mnemonic. The ">= 24"
//      is deliberate: matching exactly 24 lets a phrase embedded in prose
//      ("the words are <24 words>") shift the window and leave the tail of
//      the phrase in the log. Redacting the whole run instead over-redacts
//      long lowercase prose, which is the cheaper mistake.
//   4. CBOR shapes    — any run of >= 400 hex characters, which in this
//      codebase can only be a serialised transaction or witness set.
//
// Rules 1, 3 and 4 are content-based and therefore catch secrets that arrive
// through a key nobody thought to name.

import process from "node:process";

import type { LogLevel, Logger } from "../ports/logger.ts";

export type LogSink = (
  level: LogLevel,
  msg: string,
  data: Record<string, unknown>,
) => void;

export type LoggerOptions = {
  /** Strings to scrub wherever they appear. Entries under 8 characters are
   *  ignored: redacting a short string would blank out ordinary text. */
  secrets: string[];
  sink?: LogSink;
  /** Minimum level emitted. Default "info", so `debug` is off by default. */
  level?: LogLevel;
};

export const REDACTED = "[REDACTED]";

/** Shortest secret worth matching on. Below this, false positives dominate. */
export const MIN_SECRET_LENGTH = 8;

/** A run of this many hex characters is transaction CBOR, not an identifier. */
export const CBOR_HEX_MIN_LENGTH = 400;

const SECRET_KEY_RE =
  /mnemonic|seed|cbor|witness|privatekey|private_key|secret|apikey|api_key|projectid|project_id/i;

/** 24+ lowercase words separated by single spaces — a BIP-39 phrase shape. */
const MNEMONIC_RE = /\b[a-z]+(?: [a-z]+){23,}\b/g;

const CBOR_HEX_RE = new RegExp(`[0-9a-fA-F]{${CBOR_HEX_MIN_LENGTH},}`, "g");

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Depth guard: deeper than this and we stop walking rather than recurse. */
const MAX_DEPTH = 12;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactString(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) {
      continue;
    }
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  // The length is kept so a reader can tell a 1.2 kB tx body apart from an
  // empty field. How long a transaction was is not a secret; its bytes are.
  out = out.replace(CBOR_HEX_RE, (match) => `[REDACTED:hex len ${match.length}]`);
  out = out.replace(MNEMONIC_RE, REDACTED);
  return out;
}

function redactValue(
  value: unknown,
  secrets: readonly string[],
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) {
    return "[REDACTED:too deep]";
  }
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets, depth + 1));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets),
    };
  }
  if (value !== null && typeof value === "object") {
    return redactRecord(value as Record<string, unknown>, secrets, depth + 1);
  }
  return value;
}

function redactRecord(
  data: Record<string, unknown>,
  secrets: readonly string[],
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = SECRET_KEY_RE.test(key)
      ? REDACTED
      : redactValue(value, secrets, depth);
  }
  return out;
}

/** Exported for the tests; the logger applies it to every `data` object. */
export function redactData(
  data: Record<string, unknown>,
  secrets: readonly string[],
): Record<string, unknown> {
  return redactRecord(data, secrets, 0);
}

function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** One JSON line per record on stderr, so stdout stays usable for data. */
export function stderrSink(
  level: LogLevel,
  msg: string,
  data: Record<string, unknown>,
): void {
  const record = { ts: new Date().toISOString(), level, msg, ...data };
  process.stderr.write(`${JSON.stringify(record, jsonSafe)}\n`);
}

export function createLogger(opts: LoggerOptions): Logger {
  const secrets = (opts.secrets ?? []).filter(
    (s) => typeof s === "string" && s.length >= MIN_SECRET_LENGTH,
  );
  const sink = opts.sink ?? stderrSink;
  const minimum = LEVEL_ORDER[opts.level ?? "info"];

  const emit = (level: LogLevel) => (msg: string, data?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < minimum) {
      return;
    }
    sink(
      level,
      redactString(typeof msg === "string" ? msg : String(msg), secrets),
      redactData(data ?? {}, secrets),
    );
  };

  return {
    debug: emit("debug"),
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

/** A Logger that drops everything. Handy in tests that do not assert on logs. */
export function nullLogger(): Logger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}
