import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as cardafin from "./index.ts";

test("the public barrel re-exports core, services and config", () => {
  for (const name of [
    // core
    "CardafinError",
    "ok",
    "err",
    "LOVELACE",
    "validateAddress",
    "planSendAda",
    "checkFunds",
    "describePlan",
    "sigAndBeforePolicy",
    "cip25Metadata",
    // services
    "TxRouter",
    "TxService",
    "WalletService",
    "createLogger",
    // config
    "loadConfig",
    "secretsOf",
    "assertMainnetAllowed",
    "MAINNET_CONFIRM_TOKEN",
  ]) {
    assert.ok(Object.hasOwn(cardafin, name), `src/index.ts does not re-export ${name}`);
  }
});

test("the public barrel pulls in no adapter", async () => {
  // Importing cardafin must not drag in @lucid-evolution/lucid (heavy) or the
  // in-memory fakes (test scaffolding). Adapters are reached by path.
  const source = await readFile("src/index.ts", "utf8");
  for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
    const specifier = match[1] ?? "";
    assert.equal(
      specifier.includes("adapters/"),
      false,
      `src/index.ts imports ${specifier}`,
    );
  }
  assert.equal(Object.hasOwn(cardafin, "MemoryLedger"), false);
  assert.equal(Object.hasOwn(cardafin, "MemoryKeys"), false);
  assert.equal(Object.hasOwn(cardafin, "HydraExecutor"), false);
});
