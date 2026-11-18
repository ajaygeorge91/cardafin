// The /v1 routes this capability contributes.
//
// The router never names them. `src/capabilities/registry.ts` names this
// module in one line and asks for its routes, which is what lets five
// branches each add a capability without ever editing the same table.
// Every path here must start with `/sessions` — `registry.test.ts` enforces
// it, and that is what makes one-line registration collision-proof.

import type { CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";
import type { SessionsService } from "./service.ts";

export function sessionsRoutes(service: SessionsService): readonly CapabilityRoute[] {
  return [
    {
      method: "POST",
      path: "/sessions/login",
      handler: () => notBuilt("sessions", "wallet login"),
    },
    {
      method: "POST",
      path: "/sessions/link",
      handler: () => notBuilt("sessions", "linking an OAuth account to a wallet"),
    },
    {
      method: "GET",
      path: "/sessions/current",
      handler: () => notBuilt("sessions", "reading the current session"),
    },
    {
      method: "POST",
      path: "/sessions/preview",
      handler: (input) => ({ status: 200, body: service.preview((input.body ?? {}) as never) }),
    },
  ];
}
