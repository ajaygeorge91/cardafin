// How assets plugs into the router: one object, named once in
// `src/capabilities/registry.ts`.
//
// All of this capability's wiring lives here, inside its own folder, so the
// shared file stays one line long and five branches merge.

import type { CapabilityModule } from "../types.ts";
import { assetsRoutes } from "./routes.ts";
import { AssetsService } from "./service.ts";

export const assetsCapability: CapabilityModule = {
  name: "assets",
  summary: "Policies, native tokens and NFTs: CIP-14 fingerprints, CIP-25 metadata, CIP-68 shaping.",
  routes: (ctx) => assetsRoutes(new AssetsService({ log: ctx.log })),
};
