// Smoke test for the identity scaffold. It passes as generated, so
// `npm run check` is green from the moment the folder exists — and it
// fails honestly the instant the contract below stops holding.

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "../../services/logger.ts";
import { parseIdentityRequest } from "./requests.ts";
import { IdentityService } from "./service.ts";

function silentLogger() {
  return createLogger({ secrets: [], sink: () => {} });
}

test("identity: a well-formed request parses", () => {
  const parsed = parseIdentityRequest({});
  assert.equal(parsed.ok, true);
});

test("identity: unknown fields are rejected, not ignored", () => {
  const parsed = parseIdentityRequest({ surprise: 1 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_REQUEST");
  }
});

test("identity: the service previews a plan without touching IO", () => {
  const service = new IdentityService({ log: silentLogger() });
  assert.equal(service.preview({}).capability, "identity");
});
