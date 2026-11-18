// How networks plugs into the router: one object, named once in
// `src/capabilities/registry.ts`.
//
// All of this capability's wiring lives here, inside its own folder, so the
// shared file stays one line long and five branches merge.

import type { CapabilityModule } from "../types.ts";
import { networksRoutes } from "./routes.ts";
import { NetworksService } from "./service.ts";

export const networksCapability: CapabilityModule = {
  name: "networks",
  summary: "Network and provider selection, rate limiting, failover.",
  routes: (ctx) => networksRoutes(new NetworksService({ log: ctx.log })),
};
