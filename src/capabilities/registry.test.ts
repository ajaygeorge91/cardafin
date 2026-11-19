// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// registry.ts is the one file parallel work on different modules shares.
// These are the invariants that make a one-line registration safe.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

import { CORE_V1_PATHS } from "../http/router.ts";
import { createLogger } from "../services/logger.ts";
import { fixedClock } from "../services/clock.ts";
import { CAPABILITIES } from "./registry.ts";
import type { CapabilityContext } from "./types.ts";

const ctx: CapabilityContext = {
  network: "Preview",
  log: createLogger({ secrets: [], sink: () => {} }),
  clock: fixedClock(1_700_000_000_000),
};

const routes = CAPABILITIES.flatMap((c) => c.routes(ctx).map((route) => ({ name: c.name, route })));

test("every capability folder is registered, and every registration is a folder", async () => {
  const onDisk = (await readdir("src/capabilities", { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  assert.deepEqual(
    CAPABILITIES.map((c) => c.name).sort(),
    onDisk,
    "an unregistered capability is never served and nothing says so",
  );
});

test("every route path lives under its own capability's name", () => {
  const strays = routes
    .filter(({ name, route }) => route.path !== `/${name}` && !route.path.startsWith(`/${name}/`))
    .map(({ name, route }) => `${name}: ${route.method} ${route.path}`);

  assert.deepEqual(strays, [], strays.join("\n"));
});

test("no two capabilities claim the same method and path", () => {
  const owners = new Map<string, string>();
  const clashes: string[] = [];

  for (const { name, route } of routes) {
    const key = `${route.method} ${route.path}`;
    const owner = owners.get(key);
    if (owner === undefined) {
      owners.set(key, name);
    } else {
      clashes.push(`${key}: ${owner} and ${name}`);
    }
  }

  assert.deepEqual(clashes, [], clashes.join("\n"));
});

test("no capability shadows a route the v1 surface already serves", () => {
  const shadows = routes
    .filter(({ route }) => CORE_V1_PATHS.includes(`/v1${route.path}`))
    .map(({ name, route }) => `${name}: /v1${route.path}`);

  assert.deepEqual(shadows, [], shadows.join("\n"));
});

test("every capability declares a name and a summary", () => {
  for (const capability of CAPABILITIES) {
    assert.ok(capability.name.trim() !== "", "a capability needs a name");
    assert.ok(capability.summary.trim() !== "", `${capability.name} has no summary`);
    assert.ok(capability.routes(ctx).length > 0, `${capability.name} registers no routes`);
  }
});
