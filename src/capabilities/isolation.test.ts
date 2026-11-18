// Module isolation, enforced rather than agreed.
//
// One capability per folder; capabilities talk through `core/` types and
// `ports/` interfaces or they do not talk at all. The moment
// `capabilities/sessions/` imports `capabilities/identity/`, the two can no
// longer be built by two sessions that never see each other's work, their
// branches stop merging cleanly, and `node --test
// src/capabilities/<name>/*.test.ts` stops being an honest per-module check.
//
// This test is what makes that a guarantee instead of a convention.
// See docs/ARCHITECTURE.md §1.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "src/capabilities";

async function listCapabilities(): Promise<string[]> {
  try {
    const entries = await readdir(ROOT, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
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

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']\s*;/g,
];

function specifiersOf(source: string): string[] {
  const out: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        out.push(match[1]);
      }
    }
  }
  return out;
}

/**
 * Which capability does this specifier resolve into, if any? Resolved
 * against the importing file so `../../identity/service.ts` is caught the
 * same as a path that happens to spell `capabilities/identity` literally.
 *
 * `known` is the set of capability folder names. Without it this would also
 * flag `../types.ts` and `../stub.ts` — the shared contract every capability
 * is *supposed* to import — because their first path segment is a filename,
 * not a folder.
 */
function capabilityOf(
  fromFile: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const resolved = path.normalize(path.join(path.dirname(fromFile), specifier));
  const rel = path.relative(ROOT, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return undefined;
  }
  const [first] = rel.split(path.sep);
  return first !== undefined && known.has(first) ? first : undefined;
}

test("no capability imports another capability", async () => {
  const capabilities = await listCapabilities();
  const known = new Set(capabilities);
  const violations: string[] = [];

  for (const name of capabilities) {
    for (const file of await listTsFiles(path.join(ROOT, name))) {
      const source = await readFile(file, "utf8");
      for (const specifier of specifiersOf(source)) {
        const target = capabilityOf(file, specifier, known);
        if (target !== undefined && target !== name) {
          violations.push(`${file}: imports "${specifier}" from capability "${target}"`);
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    "capabilities must talk through src/ports or src/core, never directly:\n" +
      violations.join("\n"),
  );
});

test("every capability folder has the files the convention promises", async () => {
  const required = ["README.md", "service.ts", "routes.ts", "capability.ts"];
  const missing: string[] = [];

  for (const name of await listCapabilities()) {
    const present = new Set(await readdir(path.join(ROOT, name)));
    for (const file of required) {
      if (!present.has(file)) {
        missing.push(`${ROOT}/${name}/${file}`);
      }
    }
    if (![...present].some((f) => f.endsWith(".test.ts"))) {
      missing.push(`${ROOT}/${name}/*.test.ts (a capability with no test is not done)`);
    }
  }

  assert.deepEqual(missing, [], `missing from capability folders:\n${missing.join("\n")}`);
});
