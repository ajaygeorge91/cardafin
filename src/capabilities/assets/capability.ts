// assets: see README.md for the brief. Not written yet — every route below
// answers 501 until it is.

import type { CapabilityModule, CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";

const routes: readonly CapabilityRoute[] = [
  { method: "POST", path: "/assets/policies", handler: () => notBuilt("assets", "policy creation") },
  { method: "POST", path: "/assets/mint", handler: () => notBuilt("assets", "minting") },
  { method: "GET", path: "/assets/fingerprint", handler: () => notBuilt("assets", "fingerprinting an asset") },
];

export const assetsCapability: CapabilityModule = {
  name: "assets",
  summary: "Policies, native tokens and NFTs: CIP-14 fingerprints, CIP-25 and CIP-68 metadata.",
  routes: () => routes,
};
