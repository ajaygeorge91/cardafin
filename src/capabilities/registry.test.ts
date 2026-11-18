// What makes the append-only registry safe.
//
// `registry.ts` is the only file five parallel branches touch. These tests
// are the reason that is survivable: they catch a capability that was built
// but never registered, a capability registered under a name that does not
// match its folder, two capabilities claiming the same path, and a
// capability shadowing a route the v1 surface already serves.
//
// Without them, "add one line to a list" is a convention. With them it is
// checked by `npm run check` on every branch before it merges.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

import { createLogger } from "../services/logger.ts";
import { fixedClock } from "../services/clock.ts";
import { CORE_V1_PATHS } from "../http/router.ts";
import { CAPABILITIES } from "./registry.ts";
import type { CapabilityContext, CapabilityRoute } from "./types.ts";

const ROOT = "src/capabilities";

function context(): CapabilityContext {
  return {
    network: "Preview",
    log: createLogger({ secrets: [], sink: () => {} }),
    clock: fixedClock(1_700_000_000_000),
  };
}

async function folders(): Promise<string[]> {
  const entries = await readdir(ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function allRoutes(): { capability: string; route: CapabilityRoute }[] {
  const ctx = context();
  return CAPABILITIES.flatMap((capability) =>
    capability.routes(ctx).map((route) => ({ capability: capability.name, route })),
  );
}

test("every capability folder is registered, and every registration is a folder", async () => {
  const onDisk = await folders();
  const registered = CAPABILITIES.map((c) => c.name).sort();

  assert.deepEqual(
    registered,
    onDisk,
    "a capability that exists but is not in CAPABILITIES is dark — its routes are never " +
      "served and nothing says so. Add it to src/capabilities/registry.ts.",
  );
});

test("capability names are unique", () => {
  const names = CAPABILITIES.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, `duplicate capability name in ${names.join(", ")}`);
});

test("every route path lives under its own capability's name", () => {
  const strays = allRoutes()
    .filter(({ capability, route }) => {
      const prefix = `/${capability}`;
      return route.path !== prefix && !route.path.startsWith(`${prefix}/`);
    })
    .map(({ capability, route }) => `${capability}: ${route.method} ${route.path}`);

  assert.deepEqual(
    strays,
    [],
    "a capability may only serve paths under /<its own name>. That is what makes one-line " +
      `registration collision-proof:\n${strays.join("\n")}`,
  );
});

test("no two capabilities claim the same method and path", () => {
  const seen = new Map<string, string>();
  const clashes: string[] = [];

  for (const { capability, route } of allRoutes()) {
    const key = `${route.method} ${route.path}`;
    const owner = seen.get(key);
    if (owner !== undefined) {
      clashes.push(`${key} claimed by both ${owner} and ${capability}`);
    } else {
      seen.set(key, capability);
    }
  }

  assert.deepEqual(clashes, [], clashes.join("\n"));
});

test("no capability shadows a route the v1 surface already serves", () => {
  const shadows = allRoutes()
    .filter(({ route }) => CORE_V1_PATHS.includes(`/v1${route.path}`))
    .map(({ capability, route }) => `${capability} would shadow /v1${route.path}`);

  assert.deepEqual(shadows, [], shadows.join("\n"));
});

test("every capability declares a summary the console can show", () => {
  const empty = CAPABILITIES.filter((c) => c.summary.trim() === "").map((c) => c.name);
  assert.deepEqual(empty, [], `capabilities with no summary: ${empty.join(", ")}`);
});
