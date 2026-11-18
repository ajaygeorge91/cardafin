// How identity plugs into the router: one object, named once in
// `src/capabilities/registry.ts`.
//
// All of this capability's wiring lives here, inside its own folder, so the
// shared file stays one line long and five branches merge.

import type { CapabilityModule } from "../types.ts";
import { identityRoutes } from "./routes.ts";
import { IdentityService } from "./service.ts";

export const identityCapability: CapabilityModule = {
  name: "identity",
  summary: "CIP-8 / COSE_Sign1 verification: the server half of browser wallet login.",
  routes: (ctx) => identityRoutes(new IdentityService({ log: ctx.log })),
};
