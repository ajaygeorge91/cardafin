#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// Regenerate src/ports/frozen.json — the recorded fingerprint of every port
// contract. Run this ONLY when you mean to change a contract:
//
//   node scripts/freeze-ports.mjs
//
// Not to forbid change — to make it show up as a one-line manifest diff that
// gets reviewed on its own, rather than hiding inside a feature that widened
// an interface to make its own tests pass. Five modules share these files.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PORTS_DIR = "src/ports";
const MANIFEST = path.join(PORTS_DIR, "frozen.json");

/** Contract files only: tests and the barrel's own test are not contracts. */
export function isContractFile(name) {
  return name.endsWith(".ts") && !name.endsWith(".test.ts");
}

/**
 * Hash the meaning, not the prose: comments and blank lines come out, so
 * rewording a doc comment is not a contract change while any change to a
 * type, a field or a signature is.
 *
 * Order matters. Block comments go first, because stripping one leaves blank
 * lines behind — do it after the blank-line filter and a reflowed comment
 * changes the hash, which is the bug this ordering fixes.
 */
export function normalizeSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trimEnd())
    .filter((line) => line.trim() !== "")
    .join("\n");
}

export function fingerprint(source) {
  return createHash("sha256").update(normalizeSource(source), "utf8").digest("hex").slice(0, 16);
}

export async function readPortFingerprints(dir = PORTS_DIR) {
  const names = (await readdir(dir)).filter(isContractFile).sort();
  const out = {};
  for (const name of names) {
    out[name] = fingerprint(await readFile(path.join(dir, name), "utf8"));
  }
  return out;
}

/** Returns a list of human-readable drifts; empty means the manifest is current. */
export async function checkPorts() {
  const current = await readPortFingerprints();
  let recorded;
  try {
    recorded = JSON.parse(await readFile(MANIFEST, "utf8")).ports ?? {};
  } catch {
    return ["src/ports/frozen.json is missing — run `node scripts/freeze-ports.mjs`"];
  }

  const drifts = [];
  for (const [name, hash] of Object.entries(current)) {
    if (recorded[name] === undefined) {
      drifts.push(`new port contract not frozen: ${name}`);
    } else if (recorded[name] !== hash) {
      drifts.push(`port contract changed: ${name} (${recorded[name]} -> ${hash})`);
    }
  }
  for (const name of Object.keys(recorded)) {
    if (current[name] === undefined) {
      drifts.push(`port contract removed: ${name}`);
    }
  }
  return drifts;
}

async function main() {
  if (process.argv.includes("--check")) {
    const drifts = await checkPorts();
    if (drifts.length > 0) {
      process.stderr.write(
        `${drifts.join("\n")}\n\nA port is a contract five modules share. If you meant this, ` +
          `run \`node scripts/freeze-ports.mjs\` and commit the manifest in its own change.\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write("port contracts match src/ports/frozen.json\n");
    return;
  }

  const ports = await readPortFingerprints();
  const manifest = {
    note: "Regenerate with `node scripts/freeze-ports.mjs`. A diff here is a contract change.",
    ports,
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`froze ${Object.keys(ports).length} port contracts into ${MANIFEST}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
