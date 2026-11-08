// createHttpHandler: a thin node:http surface over WalletService and
// TxService. No framework, no new dependencies — just a routing table, a
// bearer-auth gate and JSON in/out. See docs/ARCHITECTURE.md §1 and §9.
//
// Rules this file keeps:
//   * fail closed — an empty `apiKeys` list means every protected route is
//     refused with 503, never silently open.
//   * never log a request body. The one-line-per-request log
//     (`{ method, path, status, ms }`) is the only thing this module logs
//     about a request; everything else (plan summaries, receipts) is logged
//     by the services themselves, through the same redacting logger.
//   * bigints never reach `JSON.stringify` directly — `toJson` converts them
//     to decimal strings first, recursively.
//   * the in-memory `policies` map is process-lifetime only. There is no
//     registry: v1 expects the caller to keep the PolicyInfo JSON it got
//     back from `POST /v1/policies`, the same as the CLI's `policy.json`.

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { validatePolicyId } from "../core/assets.ts";
import type { ErrorCode } from "../core/errors.ts";
import { CardafinError, isCardafinError } from "../core/errors.ts";
import { validateNativeScript } from "../core/native-script.ts";
import type { PolicyInfo } from "../core/plan.ts";
import type { Config } from "../config.ts";
import type { Logger } from "../ports/logger.ts";
import type { TxKind, TxService } from "../services/tx.ts";
import type { WalletService } from "../services/wallet.ts";
import { VERSION } from "../version.ts";

export type RouterDeps = {
  wallet: WalletService;
  tx: TxService;
  config: Pick<Config, "network" | "apiKeys">;
  log: Logger;
  /**
   * In-memory policy registry, keyed by policyId. Optional: when omitted,
   * `createHttpHandler` keeps its own map for the life of the process.
   */
  policies?: Map<string, PolicyInfo>;
};

type Method = "GET" | "POST";

type RouteResult = { status: number; body: unknown };

/** The largest JSON body this surface will read. Beyond it: 413. */
const BODY_LIMIT_BYTES = 64 * 1024;

/** `account` is a CIP-1852 account index: a non-negative 31-bit integer. */
const MAX_ACCOUNT_INDEX = 2 ** 31 - 1;

// --- errors -----------------------------------------------------------

/**
 * An error carrying its own HTTP status and wire code, for failures that are
 * about the HTTP surface itself (auth, routing, body size, malformed JSON)
 * rather than a `CardafinError` from core or a service.
 */
class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly allow?: string;

  constructor(status: number, code: string, message: string, details?: unknown, allow?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
    if (allow !== undefined) {
      this.allow = allow;
    }
  }
}

/** CardafinError code → HTTP status. See docs/ARCHITECTURE.md §9. */
function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "INVALID_ADDRESS":
    case "WRONG_NETWORK":
    case "INVALID_AMOUNT":
    case "INVALID_ASSET_NAME":
    case "INVALID_POLICY_ID":
    case "INVALID_UNIT":
    case "INVALID_METADATA":
    case "INVALID_REQUEST":
    case "BELOW_MIN_ADA":
      return 400;
    case "INSUFFICIENT_FUNDS":
      return 402;
    case "MAINNET_NOT_CONFIRMED":
      return 403;
    case "NOT_IMPLEMENTED":
      return 501;
    case "PROVIDER_ERROR":
      return 502;
  }
}

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

/**
 * Turn whatever a handler threw into a status + JSON body. An error this
 * module and core do not know about is a 500 with a generic message — never
 * the stack, never the raw error text in the response — logged server-side
 * through the redacting logger instead.
 */
function mapError(e: unknown, log: Logger): { status: number; body: ErrorBody } {
  if (e instanceof HttpError) {
    return {
      status: e.status,
      body: {
        error:
          e.details === undefined
            ? { code: e.code, message: e.message }
            : { code: e.code, message: e.message, details: e.details },
      },
    };
  }
  if (isCardafinError(e)) {
    return { status: statusForCode(e.code), body: { error: e.toJSON() } };
  }
  log.error("unhandled error in HTTP handler", { error: e });
  return { status: 500, body: { error: { code: "INTERNAL", message: "internal server error" } } };
}

// --- JSON helpers -------------------------------------------------------

/**
 * Recursively replace every `bigint` with its decimal string, since
 * `JSON.stringify` cannot serialise one. Everything else passes through
 * unchanged, including `undefined` entries in objects (dropped by
 * `JSON.stringify` as usual) and arrays (mapped in place).
 */
export function toJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJson(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJson(item);
    }
    return out;
  }
  return value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(toJson(body)));
}

// --- auth -----------------------------------------------------------------

/**
 * Fail closed: no configured keys means no protected route runs, ever — a
 * misconfigured deployment refuses traffic instead of serving it
 * unauthenticated. A configured key must match exactly, length included, so
 * the comparison is `crypto.timingSafeEqual` on equal-length buffers only.
 */
function requireAuth(req: IncomingMessage, apiKeys: readonly string[]): void {
  if (apiKeys.length === 0) {
    throw new HttpError(503, "NO_API_KEYS", "set CARDAFIN_API_KEYS");
  }
  const header = req.headers.authorization;
  const match = typeof header === "string" ? /^Bearer (.+)$/.exec(header) : null;
  if (!match) {
    throw new HttpError(401, "UNAUTHORIZED", "missing or malformed Authorization header");
  }
  const provided = Buffer.from(match[1] ?? "", "utf8");
  let matched = false;
  for (const key of apiKeys) {
    const configured = Buffer.from(key, "utf8");
    if (configured.length === provided.length && timingSafeEqual(configured, provided)) {
      matched = true;
    }
  }
  if (!matched) {
    throw new HttpError(401, "UNAUTHORIZED", "invalid API key");
  }
}

// --- body / query parsing --------------------------------------------------

function readBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) {
        return;
      }
      total += chunk.length;
      if (total > limitBytes) {
        failed = true;
        // Do not `req.destroy()`: on HTTP/1.1 the request and response share
        // one socket, and destroying it would drop the 413 response too.
        // Just stop buffering and let the rest of the body drain unread.
        reject(
          new HttpError(413, "PAYLOAD_TOO_LARGE", `request body exceeds ${limitBytes} bytes`),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", (err) => {
      if (!failed) {
        failed = true;
        reject(err);
      }
    });
  });
}

/** Empty body reads as `{}`, so an endpoint with no required fields works. */
function parseJsonBody(buf: Buffer): unknown {
  if (buf.length === 0) {
    return {};
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_REQUEST", "invalid JSON body");
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fieldOf(value: unknown, key: string): unknown {
  return isPlainRecord(value) ? value[key] : undefined;
}

/**
 * Split request-level fields (`account`, `dryRun`, `policy`) out of a body
 * before it reaches a core `validate*` function — those reject any field
 * they do not recognise, and none of them know about HTTP-layer concerns.
 */
function extractFields(
  body: unknown,
  keys: readonly string[],
): { rest: unknown; extracted: Record<string, unknown> } {
  if (!isPlainRecord(body)) {
    return { rest: body, extracted: {} };
  }
  const rest: Record<string, unknown> = {};
  const extracted: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(body)) {
    if (keys.includes(key)) {
      extracted[key] = item;
    } else {
      rest[key] = item;
    }
  }
  return { rest, extracted };
}

/** Accepts `undefined`/`null` (→ account 0), a safe-integer `number`, or a
 *  digits-only `string`. Anything else — negative, fractional, too big,
 *  non-numeric — is a 400. */
function parseAccountValue(raw: unknown): number {
  if (raw === undefined || raw === null) {
    return 0;
  }
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= MAX_ACCOUNT_INDEX) {
    return raw;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n <= MAX_ACCOUNT_INDEX) {
      return n;
    }
  }
  throw new HttpError(
    400,
    "INVALID_REQUEST",
    `\`account\` must be a non-negative integer ≤ ${MAX_ACCOUNT_INDEX}`,
  );
}

function resolveDryRun(url: URL, extracted: Record<string, unknown>): boolean {
  const q = url.searchParams.get("dryRun");
  return q === "1" || q === "true" || extracted.dryRun === true;
}

/**
 * Validate a `policy` object the same way `cli.ts`'s `loadPolicy` validates
 * one read off disk: trust nothing, check the policy id's shape and the
 * native script's structure before handing it to `TxService.mint`.
 */
function coercePolicyInfo(raw: unknown): PolicyInfo {
  if (!isPlainRecord(raw)) {
    throw new CardafinError("INVALID_REQUEST", "`policy` must be a PolicyInfo object");
  }
  const policyId = validatePolicyId(String(raw.policyId ?? ""));
  if (!policyId.ok) {
    throw policyId.error;
  }
  const script = validateNativeScript(raw.script);
  if (!script.ok) {
    throw script.error;
  }
  const keyHash = typeof raw.keyHash === "string" ? raw.keyHash : "";
  const policy: PolicyInfo = { policyId: policyId.value, script: script.value, keyHash };
  if (typeof raw.lockBeforeSlot === "number") {
    policy.lockBeforeSlot = raw.lockBeforeSlot;
  }
  return policy;
}

// --- route handlers ---------------------------------------------------

type Ctx = { req: IncomingMessage; url: URL; deps: RouterDeps; policies: Map<string, PolicyInfo> };

function handleHealth(ctx: Ctx): RouteResult {
  return { status: 200, body: { ok: true, network: ctx.deps.config.network, version: VERSION } };
}

async function handleWalletAddress(ctx: Ctx): Promise<RouteResult> {
  const account = parseAccountValue(ctx.url.searchParams.get("account"));
  const info = await ctx.deps.wallet.address(account);
  return { status: 200, body: info };
}

/** `address` wins when given; otherwise the service's own wallet at `account` (default 0). */
async function resolveAddress(ctx: Ctx): Promise<string> {
  const address = ctx.url.searchParams.get("address");
  if (address !== null && address !== "") {
    return address;
  }
  const account = parseAccountValue(ctx.url.searchParams.get("account"));
  return (await ctx.deps.wallet.address(account)).address;
}

async function handleWalletBalance(ctx: Ctx): Promise<RouteResult> {
  const address = await resolveAddress(ctx);
  const report = await ctx.deps.wallet.balance(address);
  return { status: 200, body: report };
}

async function handleWalletUtxos(ctx: Ctx): Promise<RouteResult> {
  const address = await resolveAddress(ctx);
  const utxos = await ctx.deps.wallet.utxos(address);
  return { status: 200, body: { utxos } };
}

/**
 * Never logs the body: `mnemonic` is read straight off the parsed JSON and
 * handed to `WalletService.restore`, and nothing about this request reaches
 * `deps.log` except the one-line `{ method, path, status, ms }` the main
 * dispatcher writes for every request.
 */
async function handleWalletRestore(ctx: Ctx): Promise<RouteResult> {
  const body = parseJsonBody(await readBody(ctx.req, BODY_LIMIT_BYTES));
  const mnemonic = fieldOf(body, "mnemonic");
  if (typeof mnemonic !== "string") {
    throw new CardafinError("INVALID_REQUEST", "`mnemonic` must be a string");
  }
  const account = parseAccountValue(fieldOf(body, "account"));
  const info = await ctx.deps.wallet.restore(mnemonic, account);
  return { status: 200, body: info };
}

async function handleSendAda(ctx: Ctx): Promise<RouteResult> {
  const body = parseJsonBody(await readBody(ctx.req, BODY_LIMIT_BYTES));
  const { rest, extracted } = extractFields(body, ["account", "dryRun"]);
  const account = parseAccountValue(extracted.account);
  if (resolveDryRun(ctx.url, extracted)) {
    return { status: 200, body: await ctx.deps.tx.preview("send-ada", rest, account) };
  }
  const receipt = await ctx.deps.tx.sendAda(rest, account);
  return { status: 200, body: { receipt } };
}

async function handleSendTokens(ctx: Ctx): Promise<RouteResult> {
  const body = parseJsonBody(await readBody(ctx.req, BODY_LIMIT_BYTES));
  const { rest, extracted } = extractFields(body, ["account", "dryRun"]);
  const account = parseAccountValue(extracted.account);
  if (resolveDryRun(ctx.url, extracted)) {
    return { status: 200, body: await ctx.deps.tx.preview("send-tokens", rest, account) };
  }
  const receipt = await ctx.deps.tx.sendTokens(rest, account);
  return { status: 200, body: { receipt } };
}

/**
 * No `POST /v1/wallet/create`: minting a mnemonic through an HTTP call and
 * handing it back in the response body is a footgun (it will end up in an
 * access log, a proxy, a browser history, somewhere). Generate one offline
 * with `cli wallet new` instead and restore it through `/v1/wallet/restore`.
 */
async function handleCreatePolicy(ctx: Ctx): Promise<RouteResult> {
  const body = parseJsonBody(await readBody(ctx.req, BODY_LIMIT_BYTES));
  const { rest, extracted } = extractFields(body, ["account"]);
  const account = parseAccountValue(extracted.account);
  const policy = await ctx.deps.tx.createPolicy(rest, account);
  ctx.policies.set(policy.policyId, policy);
  return { status: 200, body: policy };
}

async function handleMint(ctx: Ctx): Promise<RouteResult> {
  const body = parseJsonBody(await readBody(ctx.req, BODY_LIMIT_BYTES));
  const { rest, extracted } = extractFields(body, ["account", "policy", "dryRun"]);
  const account = parseAccountValue(extracted.account);

  let policy: PolicyInfo | undefined;
  if (extracted.policy !== undefined) {
    policy = coercePolicyInfo(extracted.policy);
  } else {
    const policyId = fieldOf(rest, "policyId");
    policy = typeof policyId === "string" ? ctx.policies.get(policyId) : undefined;
  }
  if (policy === undefined) {
    throw new CardafinError("INVALID_REQUEST", "unknown policyId; pass the policy object");
  }

  if (resolveDryRun(ctx.url, extracted)) {
    const kind: TxKind = "mint";
    return { status: 200, body: await ctx.deps.tx.preview(kind, rest, account, policy) };
  }
  const receipt = await ctx.deps.tx.mint(rest, policy, account);
  return { status: 200, body: { receipt } };
}

// --- dispatch ---------------------------------------------------------

type RouteTable = Partial<Record<Method, (ctx: Ctx) => Promise<RouteResult> | RouteResult>>;

const PROTECTED_ROUTES: Record<string, RouteTable> = {
  "/v1/wallet/address": { GET: handleWalletAddress },
  "/v1/wallet/balance": { GET: handleWalletBalance },
  "/v1/wallet/utxos": { GET: handleWalletUtxos },
  "/v1/wallet/restore": { POST: handleWalletRestore },
  "/v1/tx/send-ada": { POST: handleSendAda },
  "/v1/policies": { POST: handleCreatePolicy },
  "/v1/tx/mint": { POST: handleMint },
  "/v1/tx/send-tokens": { POST: handleSendTokens },
};

export function createHttpHandler(
  deps: RouterDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const policies = deps.policies ?? new Map<string, PolicyInfo>();

  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const start = Date.now();
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = (req.method ?? "GET") as Method;
    let status = 500;

    try {
      if (path === "/v1/health" && method === "GET") {
        const result = handleHealth({ req, url, deps, policies });
        status = result.status;
        sendJson(res, result.status, result.body);
        return;
      }

      requireAuth(req, deps.config.apiKeys);

      const table = PROTECTED_ROUTES[path];
      if (!table) {
        throw new HttpError(404, "NOT_FOUND", "not found");
      }
      const route = table[method];
      if (!route) {
        throw new HttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "method not allowed",
          undefined,
          Object.keys(table).join(", "),
        );
      }

      const result = await route({ req, url, deps, policies });
      status = result.status;
      sendJson(res, result.status, result.body);
    } catch (e) {
      const mapped = mapError(e, deps.log);
      status = mapped.status;
      if (e instanceof HttpError && e.allow !== undefined) {
        res.setHeader("Allow", e.allow);
      }
      sendJson(res, mapped.status, mapped.body);
    } finally {
      // Path only, never the query string's values and never the body —
      // an address can ride along in `?address=`, which is fine, but
      // nothing here depends on that staying true.
      deps.log.info("request", { method: req.method ?? "GET", path, status, ms: Date.now() - start });
    }
  };
}
