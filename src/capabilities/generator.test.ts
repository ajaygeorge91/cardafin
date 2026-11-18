// The generator runs once per capability and is then forgotten, which is
// when it rots: the convention moves and the next scaffold is red, or worse,
// silently unregistered.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = "scripts/new-capability.mjs";

async function generate(args: string[]): Promise<{ code: number; err: string }> {
  try {
    await run(process.execPath, [SCRIPT, ...args]);
    return { code: 0, err: "" };
  } catch (e) {
    const failed = e as { code?: number; stderr?: string };
    return { code: failed.code ?? 1, err: failed.stderr ?? "" };
  }
}

test("bad input is refused before anything is written", async () => {
  assert.equal((await generate([])).code, 2);
  for (const bad of ["Identity", "my_module", "2fa", "has spaces", "trailing-"]) {
    const result = await generate([bad, "a description"]);
    assert.equal(result.code, 2, `"${bad}" should have been refused`);
    assert.match(result.err, /lowercase-kebab-case/);
  }
});

test("an existing capability is never overwritten", async () => {
  const result = await generate(["identity", "a description"]);
  assert.equal(result.code, 1);
  assert.match(result.err, /already exists/);
});

test("the generated shape is the shape the other tests require", async () => {
  const source = await readFile(SCRIPT, "utf8");
  for (const file of ["README.md", "capability.ts"]) {
    assert.ok(source.includes(`"${file}":`), `the generator no longer writes ${file}`);
  }
  assert.match(source, /registry\.ts/, "it must name the one shared file to edit");
});

test("every capability declares itself under its own folder name", async () => {
  const names = (await readdir("src/capabilities", { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  assert.ok(names.length >= 5);
  for (const name of names) {
    const source = await readFile(path.join("src/capabilities", name, "capability.ts"), "utf8");
    assert.match(source, new RegExp(`name: "${name}"`), `${name}/capability.ts names another`);
  }
});
