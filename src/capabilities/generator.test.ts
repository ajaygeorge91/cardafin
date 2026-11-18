// The generator has to keep producing folders that pass `npm run check`.
//
// It is run once per capability and then not thought about again, which is
// exactly when it rots: a convention changes, the generated file no longer
// matches it, and the next session starts from a scaffold that is red or
// — worse — quietly dark because nothing mounts it.
//
// Running it for real here would mean writing into `src/capabilities/`
// mid-test, where `registry.test.ts` would see an unregistered folder. So
// this drives it the way a person gets it wrong (bad name, no arguments, a
// folder that exists) and checks the generated shape against the shape the
// five real capabilities are held to.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = "scripts/new-capability.mjs";

async function generate(args: string[]): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args]);
    return { code: 0, out: stdout, err: stderr };
  } catch (e) {
    const failure = e as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: failure.stdout ?? "", err: failure.stderr ?? "" };
  }
}

test("no arguments is usage, not a half-written folder", async () => {
  const result = await generate([]);
  assert.equal(result.code, 2);
  assert.match(result.err, /usage: node scripts\/new-capability\.mjs/);
});

test("a name that would not survive the conventions is refused up front", async () => {
  for (const bad of ["Identity", "my_module", "2fa", "has spaces", "trailing-"]) {
    const result = await generate([bad, "a description"]);
    assert.equal(result.code, 2, `"${bad}" should have been refused`);
    assert.match(result.err, /lowercase-kebab-case/);
  }
});

test("an existing capability is never overwritten", async () => {
  const result = await generate(["identity", "a description"]);
  assert.equal(result.code, 1);
  assert.match(result.err, /already exists — nothing written/);
});

test("the generated shape matches what the real capabilities are held to", async () => {
  const source = await readFile(SCRIPT, "utf8");

  // isolation.test.ts requires these four in every capability folder, and
  // registry.test.ts requires the module they export.
  for (const file of ["README.md", "service.ts", "routes.ts", "capability.ts"]) {
    assert.ok(source.includes(`"${file}":`), `the generator no longer writes ${file}`);
  }
  assert.ok(source.includes("Replace with the real contract"), "the scaffold marker is gone, so the console can no longer tell a scaffold from a finished module");
  assert.match(source, /registry\.ts/, "the generator must say which one shared file to edit");
});

test("every real capability still looks like the generator's output", async () => {
  const root = "src/capabilities";
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  assert.ok(names.length >= 5, "the five modules should exist");
  for (const name of names) {
    const capability = await readFile(path.join(root, name, "capability.ts"), "utf8");
    assert.match(capability, new RegExp(`name: "${name}"`), `${name}/capability.ts names a different capability`);
    assert.match(capability, /summary: "/, `${name} declares no summary`);
  }
});
