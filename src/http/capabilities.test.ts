// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// The capability mount, on a real node:http server. registry.test.ts proves
// the registry's shape; this proves the router serves it.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryApp } from "../adapters/memory/app.ts";
import { CAPABILITIES } from "../capabilities/registry.ts";
import type { CapabilityModule } from "../capabilities/types.ts";
import { createHttpHandler } from "./router.ts";

const AUTH = { Authorization: "Bearer test-key-1234" } as const;
const JSON_POST = { ...AUTH, "Content-Type": "application/json" } as const;

/** A capability whose one route works, for the cases where 501 is not the point. */
const working: CapabilityModule = {
  name: "echo",
  summary: "a capability with a route that answers",
  routes: () => [
    { method: "POST", path: "/echo", handler: (input) => ({ status: 200, body: input.body }) },
  ],
};

function handler(capabilities: readonly CapabilityModule[]) {
  const app = createMemoryApp("Preview", { logSink: () => {} });
  return createHttpHandler({
    wallet: app.wallet,
    tx: app.tx,
    config: { network: "Preview", apiKeys: ["test-key-1234"] },
    log: app.log,
    capabilities,
  });
}

async function serve(capabilities: readonly CapabilityModule[]) {
  const server = createServer(handler(capabilities));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("a registered route is served under /v1 and gets the parsed body", async () => {
  const s = await serve([working]);
  try {
    const res = await fetch(`${s.url}/v1/echo`, {
      method: "POST",
      headers: JSON_POST,
      body: '{"hello":"there"}',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { hello: "there" });
  } finally {
    await s.close();
  }
});

test("capability routes are behind the same auth gate as everything else", async () => {
  const s = await serve([working]);
  try {
    const res = await fetch(`${s.url}/v1/echo`, { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
  } finally {
    await s.close();
  }
});

test("an unwritten route answers 501 and names the brief that finishes it", async () => {
  const s = await serve(CAPABILITIES);
  try {
    const res = await fetch(`${s.url}/v1/identity/verify`, { method: "POST", headers: JSON_POST, body: "{}" });
    assert.equal(res.status, 501);
    const body = (await res.json()) as { error: { code: string; details: { readme: string } } };
    assert.equal(body.error.code, "NOT_IMPLEMENTED");
    assert.equal(body.error.details.readme, "src/capabilities/identity/README.md");
  } finally {
    await s.close();
  }
});

test("the wrong method on a capability path is 405 with Allow, not 404", async () => {
  const s = await serve(CAPABILITIES);
  try {
    const res = await fetch(`${s.url}/v1/identity/verify`, { headers: AUTH });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "POST");
  } finally {
    await s.close();
  }
});

test("with no capabilities wired, their paths are 404", async () => {
  const s = await serve([]);
  try {
    const res = await fetch(`${s.url}/v1/identity/verify`, { method: "POST", headers: JSON_POST, body: "{}" });
    assert.equal(res.status, 404);
  } finally {
    await s.close();
  }
});

test("a capability that shadows or duplicates a path throws at construction", () => {
  const shadow: CapabilityModule = {
    name: "wallet",
    summary: "collides with the v1 surface",
    routes: () => [{ method: "GET", path: "/wallet/address", handler: () => ({ status: 200, body: {} }) }],
  };
  assert.throws(() => handler([shadow]), /shadows the v1 route \/v1\/wallet\/address/);
  assert.throws(() => handler([working, working]), /two capabilities claim POST \/v1\/echo/);
});
