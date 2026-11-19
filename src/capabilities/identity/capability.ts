// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ajay George

// identity: see README.md for the brief. Not written yet — every route below
// answers 501 until it is.

import type { CapabilityModule, CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";

const routes: readonly CapabilityRoute[] = [
  { method: "POST", path: "/identity/challenge", handler: () => notBuilt("identity", "issuing a login challenge") },
  { method: "POST", path: "/identity/verify", handler: () => notBuilt("identity", "verifying a signature") },
];

export const identityCapability: CapabilityModule = {
  name: "identity",
  summary: "CIP-8 / COSE_Sign1 verification: the server half of browser wallet login.",
  routes: () => routes,
};
