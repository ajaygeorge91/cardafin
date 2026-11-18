// How sessions plugs into the router: one object, named once in
// `src/capabilities/registry.ts`.
//
// All of this capability's wiring lives here, inside its own folder, so the
// shared file stays one line long and five branches merge.

import type { CapabilityModule } from "../types.ts";
import { sessionsRoutes } from "./routes.ts";
import { SessionsService } from "./service.ts";

export const sessionsCapability: CapabilityModule = {
  name: "sessions",
  summary: "OAuth + wallet login, and the account link between them.",
  routes: (ctx) => sessionsRoutes(new SessionsService({ log: ctx.log })),
};
