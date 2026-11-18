// The /v1 routes this capability contributes.
//
// The router never names them. `src/capabilities/registry.ts` names this
// module in one line and asks for its routes, which is what lets five
// branches each add a capability without ever editing the same table.
// Every path here must start with `/assets` — `registry.test.ts` enforces
// it, and that is what makes one-line registration collision-proof.

import type { CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";
import type { AssetsService } from "./service.ts";

export function assetsRoutes(service: AssetsService): readonly CapabilityRoute[] {
  return [
    {
      method: "POST",
      path: "/assets/policies",
      handler: () => notBuilt("assets", "policy creation"),
    },
    {
      method: "POST",
      path: "/assets/mint",
      handler: () => notBuilt("assets", "minting"),
    },
    {
      method: "POST",
      path: "/assets/preview",
      handler: (input) => ({ status: 200, body: service.preview((input.body ?? {}) as never) }),
    },
  ];
}
