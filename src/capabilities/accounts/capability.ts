// How accounts plugs into the router: one object, named once in
// `src/capabilities/registry.ts`.
//
// All of this capability's wiring lives here, inside its own folder, so the
// shared file stays one line long and five branches merge.

import type { CapabilityModule } from "../types.ts";
import { accountsRoutes } from "./routes.ts";
import { AccountsService } from "./service.ts";

export const accountsCapability: CapabilityModule = {
  name: "accounts",
  summary: "Address derivation, gap-limit discovery and portfolio aggregation.",
  routes: (ctx) => accountsRoutes(new AccountsService({ log: ctx.log })),
};
