// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// networks: see README.md for the brief. Not written yet — every route below
// answers 501 until it is.

import type { CapabilityModule, CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";

const routes: readonly CapabilityRoute[] = [
  { method: "GET", path: "/networks", handler: () => notBuilt("networks", "listing the configured networks") },
  { method: "GET", path: "/networks/health", handler: () => notBuilt("networks", "provider health") },
];

export const networksCapability: CapabilityModule = {
  name: "networks",
  summary: "Network and provider selection, rate limiting and failover.",
  routes: () => routes,
};
