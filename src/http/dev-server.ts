// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// `npm run console` — the whole service over the in-memory adapters, plus a
// page to watch it work.
//
// It needs no node_modules, no network and no key: `createMemoryApp` imports
// only node builtins and relative files, and the page is three static files.
// So it runs offline from a clean clone, which is what makes "open the
// accounts panel and see 120 rows" a check a stranger can perform.
//
// This is not `src/http/server.ts`. That one wires the real adapters and can
// move real funds. There is no executor behind this one but a fake ledger.

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
  /** "scaffold" while any route still answers 501. A light, not a gate. */
  state: "scaffold" | "implemented";
  doneWhen: string[];
  routes: { method: "GET" | "POST"; path: string }[];
};

/** Per-module status for the console: the registered routes, read back from
 *  the capability itself, plus its README's description and Done-when. */
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
    const declaration = await readFile(path.join(dir, "capability.ts"), "utf8").catch(() => "");
    const description = readme.split("\n").map((l) => l.trim()).filter(Boolean)[1] ?? capability.summary;
    const doneWhen = [...readme.matchAll(/^(node |npm run )[^\n]*$/gm)].map((m) => m[0] ?? "");
    out.push({
      name: capability.name,
      description,
      state: declaration.includes("notBuilt") ? "scaffold" : "implemented",
      doneWhen,
      routes: capability.routes(ctx).map((r) => ({ method: r.method, path: `/v1${r.path}` })),
    });
  }
  return out;
}

export type DevHandlerOptions = {
  /** Where the request log goes. The console leaves it on stderr; the probe
   *  silences it, since its own report is the output. */
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
