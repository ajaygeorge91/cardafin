// Smoke test for the assets scaffold. It passes as generated, so
// `npm run check` is green from the moment the folder exists — and it
// fails honestly the instant the contract below stops holding.

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "../../services/logger.ts";
import { parseAssetsRequest } from "./requests.ts";
import { AssetsService } from "./service.ts";

function silentLogger() {
  return createLogger({ secrets: [], sink: () => {} });
}

test("assets: a well-formed request parses", () => {
  const parsed = parseAssetsRequest({});
  assert.equal(parsed.ok, true);
});

test("assets: unknown fields are rejected, not ignored", () => {
  const parsed = parseAssetsRequest({ surprise: 1 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_REQUEST");
  }
});

test("assets: the service previews a plan without touching IO", () => {
  const service = new AssetsService({ log: silentLogger() });
  assert.equal(service.preview({}).capability, "assets");
});
