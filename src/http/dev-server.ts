// `npm run console` — the whole service over the in-memory adapters, plus a
// browser console to watch it work.
//
// The point of this file: it needs **no node_modules, no network, no key and
// no Blockfrost project id**. `createMemoryApp` is pure (node builtins and
// relative imports only), `node:http` is a builtin, and the console page is
// three static files. So it runs from a clean clone, offline, in a sandbox —
// which is what makes "then open the Accounts panel and see 120 rows" a
// check a stranger can actually perform.
//
// This is NOT `src/http/server.ts`. That one wires the real adapters, can
// move real funds, and pulls lucid in transitively. This one cannot touch a
// chain even if you ask it to: there is no executor behind it but a fake
// ledger of imaginary money.
// See docs/ARCHITECTURE.md §1.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createMemoryApp } from "../adapters/memory/app.ts";
import { CAPABILITIES } from "../capabilities/registry.ts";
import type { CapabilityModule } from "../capabilities/types.ts";
import type { PolicyInfo } from "../core/plan.ts";
import type { Network } from "../core/network.ts";
import { parseNetwork } from "../core/network.ts";
import type { LogSink } from "../services/logger.ts";
import { createLogger } from "../services/logger.ts";
import { systemClock } from "../services/clock.ts";
import { createHttpHandler } from "./router.ts";

/**
 * Not a secret and could not be one: the console is a local development
 * surface over imaginary money. It is spelled obviously-fake so that no
 * automatic credential scanner — and no reader — mistakes it for a key.
 */
const DEV_API_KEY = "dev-console-not-a-real-key";

const WEB_DIR = "web";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * Resolve a URL path inside `web/`, or undefined if it escapes. Traversal is
 * rejected rather than clamped — a request for `../../.env` is a bug or an
 * attack, and either way the answer is 404, not a file.
 */
export function resolveStatic(urlPath: string, root = WEB_DIR): string | undefined {
  const decoded = decodeURIComponent(urlPath);
  const name = decoded === "/" || decoded === "/console" ? "/console.html" : decoded;
  const resolved = path.resolve(root, `.${name}`);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return undefined;
  }
  return resolved;
}

async function serveStatic(res: ServerResponse, file: string): Promise<boolean> {
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export type CapabilityStatus = {
  name: string;
  description: string;
  /** "scaffold" until the generated placeholder contract is replaced. */
  state: "scaffold" | "implemented";
  doneWhen: string[];
  /** The routes this capability actually registered, fully qualified. */
  routes: { method: "GET" | "POST"; path: string }[];
};

/**
 * What the console shows per module: the registered route surface, taken
 * from the capability itself rather than guessed from its name, plus the
 * README's description and Done-when.
 *
 * "scaffold" is detected from the generated placeholder still being present
 * in `requests.ts` — crude on purpose: it is a progress light, not a gate.
 * The gate is `npm run check`.
 */
export async function describeCapabilities(
  capabilities: readonly CapabilityModule[] = CAPABILITIES,
  root = "src/capabilities",
): Promise<CapabilityStatus[]> {
  const ctx = {
    network: "Preview" as Network,
    log: createLogger({ secrets: [], sink: () => {} }),
    clock: systemClock,
  };

  const out: CapabilityStatus[] = [];
  for (const capability of [...capabilities].sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, capability.name);
    const readme = await readFile(path.join(dir, "README.md"), "utf8").catch(() => "");
    const requests = await readFile(path.join(dir, "requests.ts"), "utf8").catch(() => "");
    const description = readme.split("\n").map((l) => l.trim()).filter(Boolean)[1] ?? capability.summary;
    const doneWhen = [...readme.matchAll(/^(node |npm run )[^\n]*$/gm)].map((m) => m[0] ?? "");
    out.push({
      name: capability.name,
      description,
      state: requests.includes("Replace with the real contract") ? "scaffold" : "implemented",
      doneWhen,
      routes: capability.routes(ctx).map((r) => ({ method: r.method, path: `/v1${r.path}` })),
    });
  }
  return out;
}

export type DevHandlerOptions = {
  /**
   * Where the request log goes. `npm run console` leaves it on stderr;
   * `npm run console:probe` silences it, because the probe's own report is
   * the output and a wall of JSON in front of it is not evidence of
   * anything.
   */
  logSink?: LogSink;
};

export function createDevHandler(network: Network, opts: DevHandlerOptions = {}) {
  const app = createMemoryApp(network, opts.logSink ? { logSink: opts.logSink } : {});
  const policies = new Map<string, PolicyInfo>();
  const api = createHttpHandler({
    wallet: app.wallet,
    tx: app.tx,
    config: { network, apiKeys: [DEV_API_KEY] },
    log: app.log,
    policies,
    capabilities: CAPABILITIES,
    clock: systemClock,
  });

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const urlPath = (req.url ?? "/").split("?")[0] ?? "/";

    if (urlPath.startsWith("/v1/")) {
      // The console is same-origin and unauthenticated by design; the API
      // key exists only so the router's fail-closed gate stays exercised
      // exactly as it is in production rather than being bypassed here.
      req.headers.authorization ??= `Bearer ${DEV_API_KEY}`;
      await api(req, res);
      return;
    }

    if (urlPath === "/console/capabilities") {
      const body = await describeCapabilities();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
      return;
    }

    if (urlPath === "/console/config") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ network, apiKey: DEV_API_KEY }));
      return;
    }

    const file = resolveStatic(urlPath);
    if (file !== undefined && (await serveStatic(res, file))) {
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: urlPath } }));
  };
}

function main(): void {
  const requested = process.env["CARDAFIN_NETWORK"] ?? "Preview";
  const parsed = parseNetwork(requested);
  if (!parsed.ok) {
    process.stderr.write(`error: ${parsed.error.code} ${parsed.error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const port = Number(process.env["CARDAFIN_HTTP_PORT"] ?? 8787);
  const server = createServer((req, res) => {
    void createDevHandlerSingleton(parsed.value)(req, res);
  });

  server.listen(port, () => {
    process.stdout.write(
      `cardafin console on http://localhost:${port}/console  (${parsed.value}, memory adapters, no real funds)\n`,
    );
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

let handler: ReturnType<typeof createDevHandler> | undefined;
function createDevHandlerSingleton(network: Network): ReturnType<typeof createDevHandler> {
  handler ??= createDevHandler(network);
  return handler;
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
