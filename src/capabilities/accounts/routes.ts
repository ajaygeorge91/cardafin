// The /v1 routes this capability contributes.
//
// The router never names them. `src/capabilities/registry.ts` names this
// module in one line and asks for its routes, which is what lets five
// branches each add a capability without ever editing the same table.
// Every path here must start with `/accounts` — `registry.test.ts` enforces
// it, and that is what makes one-line registration collision-proof.

import type { CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";
import type { AccountsService } from "./service.ts";

export function accountsRoutes(service: AccountsService): readonly CapabilityRoute[] {
  return [
    {
      method: "GET",
      path: "/accounts/addresses",
      handler: () => notBuilt("accounts", "address enumeration"),
    },
    {
      method: "GET",
      path: "/accounts/portfolio",
      handler: () => notBuilt("accounts", "portfolio aggregation"),
    },
    {
      method: "POST",
      path: "/accounts/preview",
      handler: (input) => ({ status: 200, body: service.preview((input.body ?? {}) as never) }),
    },
  ];
}
