// Smoke test for the accounts scaffold. It passes as generated, so
// `npm run check` is green from the moment the folder exists — and it
// fails honestly the instant the contract below stops holding.

import test from "node:test";
import assert from "node:assert/strict";

import { createLogger } from "../../services/logger.ts";
import { parseAccountsRequest } from "./requests.ts";
import { AccountsService } from "./service.ts";

function silentLogger() {
  return createLogger({ secrets: [], sink: () => {} });
}

test("accounts: a well-formed request parses", () => {
  const parsed = parseAccountsRequest({});
  assert.equal(parsed.ok, true);
});

test("accounts: unknown fields are rejected, not ignored", () => {
  const parsed = parseAccountsRequest({ surprise: 1 });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "INVALID_REQUEST");
  }
});

test("accounts: the service previews a plan without touching IO", () => {
  const service = new AccountsService({ log: silentLogger() });
  assert.equal(service.preview({}).capability, "accounts");
});
