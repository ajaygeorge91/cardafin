// The ports are the one thing several modules share, and widening a contract
// is always type-legal for whoever widens it — so the typecheck will not
// catch it. The contracts are fingerprinted instead.
//
// This fails on any change to a type, a field or a signature, and ignores
// comments and blank lines so improving a doc comment is free. To change one
// on purpose: `npm run freeze`, and the manifest diff says which moved.

import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

test("port contracts match src/ports/frozen.json", async () => {
  // Shelling out keeps one implementation of the fingerprint rule: the
  // script is the single source of truth, and the same `--check` runs in
  // CI, in a pre-upload check and here.
  try {
    const { stdout } = await run(process.execPath, ["scripts/freeze-ports.mjs", "--check"]);
    assert.match(stdout, /match/);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? String(err);
    assert.fail(`a shared port contract changed without being re-frozen:\n${stderr}`);
  }
});

test("rewording a doc comment is not a contract change", async () => {
  const { fingerprint } = await import("../../scripts/freeze-ports.mjs");

  const before = `// a header
/** One line. */
export type T = { a: string };
`;
  const after = `// a different header, longer than the one it replaces
/**
 * The same meaning, reflowed across
 * several lines instead of one.
 */
export type T = { a: string };
`;
  assert.equal(fingerprint(before), fingerprint(after));

  // ...but adding a field is.
  assert.notEqual(fingerprint(before), fingerprint(`export type T = { a: string; b: string };\n`));
});
