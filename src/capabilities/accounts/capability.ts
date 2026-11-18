// accounts: see README.md for the brief. Not written yet — every route below
// answers 501 until it is.

import type { CapabilityModule, CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";

const routes: readonly CapabilityRoute[] = [
  { method: "GET", path: "/accounts/addresses", handler: () => notBuilt("accounts", "address enumeration") },
  { method: "GET", path: "/accounts/portfolio", handler: () => notBuilt("accounts", "portfolio aggregation") },
];

export const accountsCapability: CapabilityModule = {
  name: "accounts",
  summary: "Address derivation, gap-limit discovery and portfolio aggregation.",
  routes: () => routes,
};
