// core/ports purity gate: `src/core` and `src/ports` may import only
// relative files (./ or ../) or node: builtins. No npm packages, no lucid,
// no blockfrost. See docs/ARCHITECTURE.md §1.

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

test("src/core and src/ports import only relative paths or node: builtins", async () => {
  const roots = ["src/core", "src/ports"];
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
    `found non-relative, non-node: imports in src/core or src/ports:\n${violations.join("\n")}`,
  );
});
