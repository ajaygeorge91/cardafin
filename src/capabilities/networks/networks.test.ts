// Smoke test for the networks scaffold. It passes as generated, so
// `npm run check` is green from the moment the folder exists — and it
// fails honestly the instant the contract below stops holding.

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "../../services/logger.ts";
import { parseNetworksRequest } from "./requests.ts";
import { NetworksService } from "./service.ts";

function silentLogger() {
  return createLogger({ secrets: [], sink: () => {} });
}

test("networks: a well-formed request parses", () => {
  const parsed = parseNetworksRequest({});
  assert.equal(parsed.ok, true);
});

test("networks: unknown fields are rejected, not ignored", () => {
  const parsed = parseNetworksRequest({ surprise: 1 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_REQUEST");
  }
});

test("networks: the service previews a plan without touching IO", () => {
  const service = new NetworksService({ log: silentLogger() });
  assert.equal(service.preview({}).capability, "networks");
});
