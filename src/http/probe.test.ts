// The probe is a Done-when line, so it has to be honest about failing.
//
// Two things are checked here: that the whole console surface answers as
// expected right now (which is also the regression test for "did anyone
// forget to mount the capabilities"), and that a check which does not
// answer as expected is reported as a failure rather than rounded off.

import test from "node:test";
import assert from "node:assert/strict";

import { formatReport, probe } from "./probe.ts";
import { CAPABILITIES } from "../capabilities/registry.ts";

test("every console and capability route answers as expected", async () => {
  const report = await probe("Preview");
  assert.deepEqual(
    report.failures.map((f) => `${f.method} ${f.path} -> ${f.status} (expected ${f.expect})`),
    [],
  );
});

test("the probe covers every registered capability", async () => {
  const report = await probe("Preview");
  assert.deepEqual(
    report.modules.map((m) => m.name).sort(),
    CAPABILITIES.map((c) => c.name).sort(),
  );
  // Every capability declares at least one route, or it is not reachable.
  for (const module of report.modules) {
    assert.ok(module.live + module.todo > 0, `${module.name} registered no routes`);
  }
});

test("the printed report names the failures rather than burying them", () => {
  const text = formatReport({
    network: "Preview",
    checks: [
      { method: "GET", path: "/v1/health", expect: [200], status: 200, note: "", ok: true },
      { method: "GET", path: "/console", expect: [200], status: 500, note: "", ok: false },
    ],
    failures: [
      { method: "GET", path: "/console", expect: [200], status: 500, note: "", ok: false },
    ],
    modules: [{ name: "identity", state: "scaffold", live: 1, todo: 2 }],
  });

  assert.match(text, /FAIL\s+500\s+GET \/console/);
  assert.match(text, /1 of 2 checks failed/);
});

test("traversal out of web/ is one of the checks, and it is refused", async () => {
  const report = await probe("Preview");
  const traversal = report.checks.find((c) => c.path.includes(".."));
  assert.ok(traversal, "the probe must check traversal");
  assert.equal(traversal.status, 404);
});
