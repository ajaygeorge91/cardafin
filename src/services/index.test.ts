import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import * as services from "./index.ts";

test("the services barrel re-exports every use case", () => {
  for (const name of [
    "TxRouter",
    "createLogger",
    "nullLogger",
    "redactString",
    "redactData",
    "stderrSink",
    "REDACTED",
    "WalletService",
    "tokensOf",
    "TxService",
  ]) {
    assert.ok(Object.hasOwn(services, name), `services/index.ts does not export ${name}`);
  }
});

test("no service imports an adapter", async () => {
  // Services depend on core + ports only. An adapter import here would make
  // the fake ledger a production dependency and break the direction of the
  // dependency graph (docs/ARCHITECTURE.md §1).
  const files = (await readdir("src/services", { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => path.join("src/services", e.name));
  assert.ok(files.length >= 4, `expected the service modules, found ${files.length}`);

  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\bfrom\s*["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      if (specifier.includes("adapters/")) {
        offenders.push(`${file} imports ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
