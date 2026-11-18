// Smoke test for the sessions scaffold. It passes as generated, so
// `npm run check` is green from the moment the folder exists — and it
// fails honestly the instant the contract below stops holding.

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "../../services/logger.ts";
import { parseSessionsRequest } from "./requests.ts";
import { SessionsService } from "./service.ts";

function silentLogger() {
  return createLogger({ secrets: [], sink: () => {} });
}

test("sessions: a well-formed request parses", () => {
  const parsed = parseSessionsRequest({});
  assert.equal(parsed.ok, true);
});

test("sessions: unknown fields are rejected, not ignored", () => {
  const parsed = parseSessionsRequest({ surprise: 1 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_REQUEST");
  }
});

test("sessions: the service previews a plan without touching IO", () => {
  const service = new SessionsService({ log: silentLogger() });
  assert.equal(service.preview({}).capability, "sessions");
});
