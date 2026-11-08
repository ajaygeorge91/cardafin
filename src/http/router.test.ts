// End-to-end tests for the HTTP surface: a real `createHttpHandler` on a
// real `node:http` server (ephemeral port), driven with the global `fetch`,
// wired to `createMemoryApp` — no network, no npm, no lucid. See
// docs/ARCHITECTURE.md §9.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";

import { LOVELACE, assetNameToHex, toUnit } from "../core/assets.ts";
import { unwrap } from "../core/result.ts";
import type { LogLevel } from "../ports/logger.ts";
import { createMemoryApp } from "../adapters/memory/app.ts";
import { MemoryKeys } from "../adapters/memory/keys.ts";
import { createHttpHandler, toJson } from "./router.ts";

// The public BIP-39 test vector. Throwaway: it has never held funds and must
// never hold funds. docs/ARCHITECTURE.md §7.
const THROWAWAY_MNEMONIC = `${"abandon ".repeat(23)}art`;
const TEN_ADA = 10_000_000n;
const AUTH = { Authorization: "Bearer test-key-1234" } as const;
const JSON_HEADERS = { ...AUTH, "Content-Type": "application/json" } as const;

type Line = { level: LogLevel; msg: string; data: Record<string, unknown> };

/**
 * `fetch`'s `Response.json()` types as `Promise<unknown>` under this repo's
 * DOM-less lib config. The response shapes under test are only ever read
 * loosely (`body.error.code`, `body.receipt.txHash`, …), so this test file
 * opts into `any` at the one seam where the data crosses from the wire,
 * rather than writing out a parallel response type per route.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(res: Response): Promise<any> {
  return res.json();
}

async function setup(opts: { apiKeys?: string[] | undefined; slot?: number } = {}) {
  const lines: Line[] = [];
  const app = createMemoryApp("Preview", {
    slot: opts.slot ?? 1_000,
    logSink: (level, msg, data) => lines.push({ level, msg, data }),
  });
  const apiKeys = opts.apiKeys ?? ["test-key-1234"];
  const handler = createHttpHandler({
    wallet: app.wallet,
    tx: app.tx,
    config: { network: app.config.network, apiKeys },
    log: app.log,
  });
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    app,
    lines,
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// --- health / auth ----------------------------------------------------

test("GET /v1/health needs no auth", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(await readJson(res), { ok: true, network: "Preview", version: "0.1.0" });
  } finally {
    await ctx.close();
  }
});

test("a missing or wrong bearer key is 401", async () => {
  const ctx = await setup();
  try {
    const missing = await fetch(`${ctx.baseUrl}/v1/wallet/address`);
    assert.equal(missing.status, 401);
    assert.equal((await readJson(missing)).error.code, "UNAUTHORIZED");

    const wrong = await fetch(`${ctx.baseUrl}/v1/wallet/address`, {
      headers: { Authorization: "Bearer not-the-key" },
    });
    assert.equal(wrong.status, 401);
  } finally {
    await ctx.close();
  }
});

test("an empty CARDAFIN_API_KEYS fails closed with 503, never open", async () => {
  const ctx = await setup({ apiKeys: [] });
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/wallet/address`, { headers: AUTH });
    assert.equal(res.status, 503);
    assert.deepEqual(await readJson(res), {
      error: { code: "NO_API_KEYS", message: "set CARDAFIN_API_KEYS" },
    });
  } finally {
    await ctx.close();
  }
});

// --- wallet reads -------------------------------------------------------

test("GET /v1/wallet/address derives the configured wallet", async () => {
  const ctx = await setup();
  try {
    const expected = await ctx.app.wallet.address(0);
    const res = await fetch(`${ctx.baseUrl}/v1/wallet/address?account=0`, { headers: AUTH });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.address, expected.address);
    assert.equal(body.paymentKeyHash, expected.paymentKeyHash);
    assert.equal(body.accountIndex, 0);
    assert.equal(body.network, "Preview");
  } finally {
    await ctx.close();
  }
});

test("`account` out of range is 400", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/wallet/address?account=-1`, { headers: AUTH });
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).error.code, "INVALID_REQUEST");
  } finally {
    await ctx.close();
  }
});

test("GET /v1/wallet/balance agrees whether called by account or by address", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const byAccount = await fetch(`${ctx.baseUrl}/v1/wallet/balance?account=0`, { headers: AUTH });
    assert.equal(byAccount.status, 200);
    const accountBody = await readJson(byAccount);
    assert.equal(accountBody.ada, "10");

    const byAddress = await fetch(
      `${ctx.baseUrl}/v1/wallet/balance?address=${encodeURIComponent(me.address)}`,
      { headers: AUTH },
    );
    assert.equal(byAddress.status, 200);
    assert.deepEqual(await readJson(byAddress), accountBody);
  } finally {
    await ctx.close();
  }
});

test("GET /v1/wallet/utxos serialises lovelace as a decimal string, not a number", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: 5_000_000n });

    const res = await fetch(`${ctx.baseUrl}/v1/wallet/utxos?account=0`, { headers: AUTH });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.utxos.length, 1);
    assert.equal(typeof body.utxos[0].assets.lovelace, "string");
    assert.equal(body.utxos[0].assets.lovelace, "5000000");
  } finally {
    await ctx.close();
  }
});

// --- restore --------------------------------------------------------------

test("POST /v1/wallet/restore accepts the throwaway vector and never logs the body", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/wallet/restore`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mnemonic: THROWAWAY_MNEMONIC, account: 2 }),
    });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.equal(body.accountIndex, 2);
    assert.match(body.address, /^addr_test1/);

    const logged = JSON.stringify(ctx.lines);
    assert.equal(logged.includes(THROWAWAY_MNEMONIC), false, "the mnemonic leaked into a log line");
    assert.equal(logged.includes("abandon"), false, "a mnemonic word leaked into a log line");
  } finally {
    await ctx.close();
  }
});

// --- send-ada ---------------------------------------------------------

test("POST /v1/tx/send-ada happy path returns a receipt and moves the balance", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, amount: "2" }),
    });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.match(body.receipt.txHash, /^[0-9a-f]{64}$/);
    assert.equal(typeof body.receipt.fee, "string");

    const otherBalance = await ctx.app.wallet.balance(other.address);
    assert.equal(otherBalance.ada, "2");
  } finally {
    await ctx.close();
  }
});

test("POST /v1/tx/send-ada?dryRun=1 previews without moving any funds", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada?dryRun=1`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, amount: "2" }),
    });
    assert.equal(res.status, 200);
    const body = await readJson(res);
    assert.ok(body.plan);
    assert.ok("estimatedFee" in body);
    assert.ok(Array.isArray(body.minAdaPerOutput));

    assert.deepEqual(ctx.app.ledger.history, []);
    assert.equal((await ctx.app.wallet.balance(other.address)).ada, "0");
    assert.equal((await ctx.app.wallet.balance(me.address)).ada, "10");
  } finally {
    await ctx.close();
  }
});

test("send-ada below min-ADA is 400 BELOW_MIN_ADA", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, amount: "0.1" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).error.code, "BELOW_MIN_ADA");
  } finally {
    await ctx.close();
  }
});

test("send-ada with insufficient funds is 402 INSUFFICIENT_FUNDS", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: 2_000_000n });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, amount: "5" }),
    });
    assert.equal(res.status, 402);
    assert.equal((await readJson(res)).error.code, "INSUFFICIENT_FUNDS");
  } finally {
    await ctx.close();
  }
});

test("send-ada to a wrong-network address is 400 WRONG_NETWORK", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });
    const mainnetAddress = (
      await new MemoryKeys().deriveWallet(ctx.app.config.mnemonic, 1, "Mainnet")
    ).address;

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: mainnetAddress, amount: "2" }),
    });
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).error.code, "WRONG_NETWORK");
  } finally {
    await ctx.close();
  }
});

test("`hydra: true` is accepted and returns 501 NOT_IMPLEMENTED by design", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, amount: "2", hydra: true }),
    });
    assert.equal(res.status, 501);
    assert.equal((await readJson(res)).error.code, "NOT_IMPLEMENTED");
  } finally {
    await ctx.close();
  }
});

// --- policies / mint / send-tokens -----------------------------------

test("policies -> mint (by stored policyId) -> balance shows the unit -> send-tokens", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const policyRes = await fetch(`${ctx.baseUrl}/v1/policies`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    assert.equal(policyRes.status, 200);
    const policy = await readJson(policyRes);
    assert.match(policy.policyId, /^[0-9a-f]{56}$/);

    // Mint without passing `policy`: the handler looks it up by policyId.
    const mintRes = await fetch(`${ctx.baseUrl}/v1/tx/mint`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ policyId: policy.policyId, assetName: "CARDAFIN", quantity: "1000" }),
    });
    assert.equal(mintRes.status, 200);
    const minted = await readJson(mintRes);
    assert.match(minted.receipt.txHash, /^[0-9a-f]{64}$/);

    const unit = unwrap(toUnit(policy.policyId, unwrap(assetNameToHex("CARDAFIN"))));
    const balanceRes = await fetch(`${ctx.baseUrl}/v1/wallet/balance?account=0`, { headers: AUTH });
    const balance = await readJson(balanceRes);
    assert.equal(balance.assets[unit], "1000");

    const sendRes = await fetch(`${ctx.baseUrl}/v1/tx/send-tokens`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, assets: { [unit]: "400" } }),
    });
    assert.equal(sendRes.status, 200);
    const sent = await readJson(sendRes);
    assert.match(sent.receipt.txHash, /^[0-9a-f]{64}$/);

    const otherBalance = await ctx.app.wallet.balance(other.address);
    assert.equal(otherBalance.assets[unit], 400n);
  } finally {
    await ctx.close();
  }
});

test("mint with an unknown policyId and no `policy` object is 400", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/mint`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ policyId: "ab".repeat(28), assetName: "GHOST", quantity: "1" }),
    });
    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.match(body.error.message, /unknown policyId/);
  } finally {
    await ctx.close();
  }
});

// --- malformed / oversized requests, routing errors --------------------

test("invalid JSON in the body is 400 INVALID_REQUEST", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: "{not valid json",
    });
    assert.equal(res.status, 400);
    assert.equal((await readJson(res)).error.code, "INVALID_REQUEST");
  } finally {
    await ctx.close();
  }
});

test("a body over 64 KiB is 413", async () => {
  const ctx = await setup();
  try {
    const padding = "x".repeat(70 * 1024);
    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: "addr_test1q...", amount: "1", padding }),
    });
    assert.equal(res.status, 413);
  } finally {
    await ctx.close();
  }
});

test("an unknown route is 404", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/nope`, { headers: AUTH });
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

test("the wrong method on a known route is 405 with an Allow header", async () => {
  const ctx = await setup();
  try {
    const res = await fetch(`${ctx.baseUrl}/v1/wallet/address`, {
      method: "DELETE",
      headers: AUTH,
    });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("allow"), "GET");
  } finally {
    await ctx.close();
  }
});

test("unknown keys in a request body are 400 (core already rejects them)", async () => {
  const ctx = await setup();
  try {
    const me = await ctx.app.wallet.address(0);
    const other = await ctx.app.wallet.address(1);
    ctx.app.ledger.fund(me.address, { [LOVELACE]: TEN_ADA });

    const res = await fetch(`${ctx.baseUrl}/v1/tx/send-ada`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ to: other.address, amount: "2", bogus: true }),
    });
    assert.equal(res.status, 400);
    const body = await readJson(res);
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.match(body.error.message, /unknown field/);
  } finally {
    await ctx.close();
  }
});

// --- toJson -------------------------------------------------------------

test("toJson converts bigints to decimal strings, recursively", () => {
  assert.equal(toJson(5n), "5");
  assert.equal(toJson("plain"), "plain");
  assert.equal(toJson(42), 42);
  assert.equal(toJson(null), null);
  assert.deepEqual(
    toJson({ fee: 170_000n, outputs: [{ assets: { lovelace: 2_000_000n } }, "x"] }),
    { fee: "170000", outputs: [{ assets: { lovelace: "2000000" } }, "x"] },
  );
  assert.deepEqual(toJson([1n, 2n, 3n]), ["1", "2", "3"]);
});
