// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// Every source file carries an SPDX header, so a file that gets copied out of
// this repo carries its licence with it. Enforced rather than remembered.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["src", "web", "scripts"];
const EXTENSIONS = [".ts", ".mts", ".mjs"];
const SPDX = "// SPDX-License-Identifier: Apache-2.0";
const COPYRIGHT = "// Copyright 2026 Ajay George";

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await sourceFiles(full)));
    } else if (entry.isFile() && EXTENSIONS.some((e) => full.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

test("every source file carries the SPDX header", async () => {
  const missing: string[] = [];
  let checked = 0;

  for (const root of ROOTS) {
    for (const file of await sourceFiles(root)) {
      const lines = (await readFile(file, "utf8")).split("\n");
      // A shebang has to stay on line 1 for the script to run.
      const head = lines[0]?.startsWith("#!") ? lines.slice(1, 3) : lines.slice(0, 2);
      if (head[0] !== SPDX || head[1] !== COPYRIGHT) {
        missing.push(file);
      }
      checked += 1;
    }
  }

  assert.ok(checked > 100, `expected the whole tree, checked only ${checked}`);
  assert.deepEqual(missing, [], `add the SPDX header to:\n${missing.join("\n")}`);
});
