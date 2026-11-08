// Purity gate: `src/core`, `src/ports`, `src/services` and
// `src/adapters/memory` may import only relative files (./ or ../) or node:
// builtins. No npm packages, no lucid, no blockfrost. That is what lets
// `npm test` pass from a clean clone with no node_modules, no network and no
// key. `src/adapters/lucid` is the one directory exempt from this rule.
// See docs/ARCHITECTURE.md §1.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function listTsFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(full)));
    } else if (entry.isFile() && full.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

const IMPORT_SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']\s*;/g,
];

function extractSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier) {
        specifiers.push(specifier);
      }
    }
  }
  return specifiers;
}

function isAllowedSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) {
    return true;
  }
  return specifier.startsWith("./") || specifier.startsWith("../");
}

const PURE_ROOTS = ["src/core", "src/ports", "src/services", "src/adapters/memory"];

test("core, ports, services and the memory adapters import only relative paths or node: builtins", async () => {
  const roots = PURE_ROOTS;
  const violations: string[] = [];

  for (const root of roots) {
    const files = await listTsFiles(root);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const specifier of extractSpecifiers(source)) {
        if (!isAllowedSpecifier(specifier)) {
          violations.push(`${file}: imports "${specifier}"`);
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `found non-relative, non-node: imports in ${PURE_ROOTS.join(", ")}:\n${violations.join("\n")}`,
  );
});
