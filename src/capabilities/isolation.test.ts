// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// No capability imports another. They talk through src/ports or not at all,
// which is what keeps `node --test src/capabilities/<name>/` an honest check
// and keeps parallel work on two modules from colliding.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "src/capabilities";

async function capabilities(): Promise<string[]> {
  const entries = await readdir(ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function tsFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await tsFiles(full)));
    } else if (entry.isFile() && full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']\s*;/g,
];

function specifiers(source: string): string[] {
  return PATTERNS.flatMap((p) => [...source.matchAll(p)].map((m) => m[1] ?? ""));
}

/**
 * Which capability a specifier resolves into, if any. Resolved against the
 * importing file, so `../../identity/service.ts` is caught and `../types.ts`
 * — the shared contract — is not.
 */
function target(file: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const rel = path.relative(ROOT, path.normalize(path.join(path.dirname(file), specifier)));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined;
  }
  const [first] = rel.split(path.sep);
  return first !== undefined && known.has(first) ? first : undefined;
}

test("no capability imports another", async () => {
  const names = await capabilities();
  const known = new Set(names);
  const violations: string[] = [];

  for (const name of names) {
    for (const file of await tsFiles(path.join(ROOT, name))) {
      const source = await readFile(file, "utf8");
      for (const specifier of specifiers(source)) {
        const other = target(file, specifier, known);
        if (other !== undefined && other !== name) {
          violations.push(`${file} imports "${specifier}"`);
        }
      }
    }
  }

  assert.deepEqual(violations, [], violations.join("\n"));
});

test("every capability has a brief and a declaration", async () => {
  const missing: string[] = [];
  for (const name of await capabilities()) {
    const present = new Set(await readdir(path.join(ROOT, name)));
    for (const file of ["README.md", "capability.ts"]) {
      if (!present.has(file)) {
        missing.push(`${ROOT}/${name}/${file}`);
      }
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});
