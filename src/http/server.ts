// The HTTP entry point: `npm run serve`. Wires the real adapters through
// `createApp`, builds the routing handler, and listens. See
// docs/ARCHITECTURE.md §9.
//
// Mirrors `cli.ts`'s two rules for a misconfigured environment: a bad
// `Config` is reported before any adapter is constructed, and the process
// exits 2 (not 1) so a deploy script can tell "cardafin refused to start"
// apart from "a request failed".

import { createServer } from "node:http";
import process from "node:process";

import { createApp } from "../app.ts";
import type { Config } from "../config.ts";
import { loadConfig } from "../config.ts";
import { isMainnet } from "../core/network.ts";
import type { PolicyInfo } from "../core/plan.ts";
import { createHttpHandler } from "./router.ts";

const EXIT_MISCONFIGURED = 2;

function mainnetBanner(config: Config): void {
  const line = "!".repeat(70);
  process.stderr.write(
    `\n${line}\nMAINNET: ${config.network} — this HTTP surface can move REAL FUNDS.\n${line}\n\n`,
  );
}

function main(): void {
  const loaded = loadConfig(process.env);
  if (!loaded.ok) {
    process.stderr.write(`error: ${loaded.error.code} ${loaded.error.message}\n`);
    process.exitCode = EXIT_MISCONFIGURED;
    return;
  }
  const config = loaded.value;

  if (isMainnet(config.network)) {
    mainnetBanner(config);
  }

  const app = createApp(config);
  const policies = new Map<string, PolicyInfo>();
  const handler = createHttpHandler({
    wallet: app.wallet,
    tx: app.tx,
    config,
    log: app.log,
    policies,
  });

  const server = createServer(handler);

  server.listen(config.httpPort, () => {
    app.log.info("listening", { port: config.httpPort, network: config.network });
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info("shutting down", { signal });
    server.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
