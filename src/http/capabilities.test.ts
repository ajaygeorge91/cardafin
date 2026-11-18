// The capability mount, end to end on a real node:http server.
//
// `src/capabilities/registry.test.ts` proves the registry's shape is sane.
// This proves the router actually serves it: auth applies, an unbuilt route
// answers 501 and says where the brief is, a finished one answers 200, and a
// capability that would shadow or duplicate a path fails at construction
// rather than silently winning or losing a race.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryApp } from "../adapters/memory/app.ts";
import { CAPABILITIES } from "../capabilities/registry.ts";
import type { CapabilityModule } from "../capabilities/types.ts";
import { fixedClock } from "../services/clock.ts";
import { createHttpHandler } from "./router.ts";

const AUTH = { Authorization: "Bearer test-key-1234" } as const;

async function setup(capabilities: readonly CapabilityModule[] = CAPABILITIES) {
  const app = createMemoryApp("Preview", { logSink: () => {} });
  const handler = createHttpHandler({
    wallet: app.wallet,
    tx: app.tx,
    config: { network: "Preview", apiKeys: ["test-key-1234"] },
    log: app.log,
    capabilities,
    clock: fixedClock(1_700_000_000_000),
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("a registered capability route is served under /v1", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/identity/preview`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { capability: "identity", request: {} });
  } finally {
    await ctx.close();
  }
});

test("capability routes are behind the same auth gate as everything else", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/identity/preview`, { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  } finally {
    await ctx.close();
  }
});

test("an unbuilt route answers 501 and names the brief that finishes it", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/identity/verify`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 501);
    const body = (await res.json()) as {
      error: { code: string; details: { readme: string; doneWhen: string } };
    };
    assert.equal(body.error.code, "NOT_IMPLEMENTED");
    assert.equal(body.error.details.readme, "src/capabilities/identity/README.md");
    assert.match(body.error.details.doneWhen, /src\/capabilities\/identity/);
  } finally {
    await ctx.close();
  }
});

test("the wrong method on a capability path is 405 with Allow, not 404", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/identity/verify`, { headers: AUTH });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  } finally {
    await ctx.close();
  }
});

test("with no capabilities wired, their paths are 404 — nothing is served by accident", async () => {
  const ctx = await setup([]);
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/identity/preview`, {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

test("a capability that shadows a v1 route fails at construction, not at request time", () => {
  const app = createMemoryApp("Preview", { logSink: () => {} });
  const shadow: CapabilityModule = {
    name: "wallet",
    summary: "a capability that collides with the v1 surface",
    routes: () => [{ method: "GET", path: "/wallet/address", handler: () => ({ status: 200, body: {} }) }],
  };

  assert.throws(
    () =>
      createHttpHandler({
        wallet: app.wallet,
        tx: app.tx,
        config: { network: "Preview", apiKeys: ["k"] },
        log: app.log,
        capabilities: [shadow],
      }),
    /shadows the v1 route \/v1\/wallet\/address/,
  );
});

test("two capabilities claiming one method and path fail at construction", () => {
  const app = createMemoryApp("Preview", { logSink: () => {} });
  const route = { method: "POST" as const, path: "/twin/go", handler: () => ({ status: 200, body: {} }) };
  const a: CapabilityModule = { name: "twin", summary: "first", routes: () => [route] };
  const b: CapabilityModule = { name: "twin", summary: "second", routes: () => [route] };

  assert.throws(
    () =>
      createHttpHandler({
        wallet: app.wallet,
        tx: app.tx,
        config: { network: "Preview", apiKeys: ["k"] },
        log: app.log,
        capabilities: [a, b],
      }),
    /two capabilities claim POST \/v1\/twin\/go/,
  );
});
