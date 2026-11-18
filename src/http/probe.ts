// `npm run console:probe` — the console's checks, without a browser.
//
// Why this exists: `npm run console` is the nicest way to see a module work,
// but it assumes you can open http://localhost:8787 in a browser. In a
// sandbox you may not be able to. So the same surface is exercised here and
// printed as text: every static page, every console endpoint, and every
// route every capability registered, with what it answered.
//
// That makes it usable as a Done-when line — a reviewer with nothing but a
// terminal runs one command and reads the result — and as the answer to
// "did my capability actually get mounted", which is otherwise invisible
// until someone clicks something.
//
// Exit code 0 means every check answered as expected. 501 is expected: an
// unbuilt capability route is supposed to say so. See
// docs/ARCHITECTURE.md §1.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import process from "node:process";
import path from "node:path";

import type { Network } from "../core/network.ts";
import { parseNetwork } from "../core/network.ts";
import { createDevHandler, describeCapabilities } from "./dev-server.ts";

export type Check = {
  method: "GET" | "POST";
  path: string;
  /** Statuses that mean "working as intended". */
  expect: number[];
  status: number;
  note: string;
  ok: boolean;
};

export type ProbeReport = {
  network: Network;
  checks: Check[];
  failures: Check[];
  /** One line per capability: how many of its routes are live vs still 501. */
  modules: { name: string; state: string; live: number; todo: number }[];
};

async function run(
  baseUrl: string,
  method: "GET" | "POST",
  urlPath: string,
  expect: number[],
  note = "",
): Promise<Check> {
  let status = 0;
  let detail = note;
  try {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      ...(method === "POST"
        ? { headers: { "content-type": "application/json" }, body: "{}" }
        : {}),
    });
    status = res.status;
    if (note === "" && res.headers.get("content-type")?.startsWith("text/html")) {
      detail = "text/html";
    }
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  return { method, path: urlPath, expect, status, note: detail, ok: expect.includes(status) };
}

export async function probe(network: Network): Promise<ProbeReport> {
  // One handler for the whole probe: `createDevHandler` builds a memory app,
  // and building a fresh one per request would hand every check a different
  // fixture ledger.
  const handler = createDevHandler(network, { logSink: () => {} });
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const checks: Check[] = [
      await run(baseUrl, "GET", "/v1/health", [200], "no auth needed"),
      await run(baseUrl, "GET", "/console", [200]),
      await run(baseUrl, "GET", "/console.css", [200]),
      await run(baseUrl, "GET", "/console.mjs", [200]),
      // console.mjs imports these two. A 404 here breaks the page silently
      // in the browser, so it is worth a line in a report nobody can miss.
      await run(baseUrl, "GET", "/login.mjs", [200], "browser half of wallet login"),
      await run(baseUrl, "GET", "/wallet.mjs", [200], "CIP-30 discovery"),
      await run(baseUrl, "GET", "/console/config", [200]),
      await run(baseUrl, "GET", "/console/capabilities", [200]),
      await run(baseUrl, "GET", "/v1/wallet/address", [200], "fixture ledger"),
      await run(baseUrl, "GET", "/v1/wallet/balance", [200], "fixture ledger"),
      // Not a formality: the console serves files off disk, so traversal is
      // the one way this process could hand out something it should not.
      await run(baseUrl, "GET", "/../../.env", [404], "traversal refused"),
      await run(baseUrl, "GET", "/v1/nothing-here", [404]),
    ];

    const described = await describeCapabilities();
    const modules: ProbeReport["modules"] = [];

    for (const capability of described) {
      let live = 0;
      let todo = 0;
      for (const route of capability.routes) {
        const check = await run(baseUrl, route.method, route.path, [200, 501]);
        checks.push(check);
        if (check.status === 501) {
          check.note = "not built yet";
          todo += 1;
        } else if (check.ok) {
          live += 1;
        }
      }
      modules.push({ name: capability.name, state: capability.state, live, todo });
    }

    return { network, checks, failures: checks.filter((c) => !c.ok), modules };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export function formatReport(report: ProbeReport): string {
  const width = Math.max(...report.checks.map((c) => `${c.method} ${c.path}`.length));
  const rows = report.checks.map((c) => {
    const mark = c.ok ? (c.status === 501 ? "todo" : "ok  ") : "FAIL";
    const label = `${c.method} ${c.path}`.padEnd(width);
    return `  ${mark}  ${String(c.status).padStart(3)}  ${label}  ${c.note}`.trimEnd();
  });

  const moduleRows = report.modules.map(
    (m) => `  ${m.name.padEnd(10)} ${m.state.padEnd(12)} ${m.live} live, ${m.todo} not built`,
  );

  const verdict =
    report.failures.length === 0
      ? `all ${report.checks.length} checks answered as expected`
      : `${report.failures.length} of ${report.checks.length} checks failed`;

  return [
    `cardafin console probe — ${report.network}, memory adapters, no network and no key`,
    "",
    ...rows,
    "",
    "modules:",
    ...moduleRows,
    "",
    verdict,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const parsed = parseNetwork(process.env["CARDAFIN_NETWORK"] ?? "Preview");
  if (!parsed.ok) {
    process.stderr.write(`error: ${parsed.error.code} ${parsed.error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const report = await probe(parsed.value);
  process.stdout.write(formatReport(report));
  if (report.failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
