// The /v1 routes this capability contributes.
//
// The router never names them. `src/capabilities/registry.ts` names this
// module in one line and asks for its routes, which is what lets five
// branches each add a capability without ever editing the same table.
// Every path here must start with `/identity` — `registry.test.ts` enforces
// it, and that is what makes one-line registration collision-proof.

import type { CapabilityRoute } from "../types.ts";
import { notBuilt } from "../stub.ts";
import type { IdentityService } from "./service.ts";

export function identityRoutes(service: IdentityService): readonly CapabilityRoute[] {
  return [
    {
      method: "POST",
      path: "/identity/challenge",
      handler: () => notBuilt("identity", "issuing a login challenge"),
    },
    {
      method: "POST",
      path: "/identity/verify",
      handler: () => notBuilt("identity", "verifying a CIP-8 signature"),
    },
    {
      method: "POST",
      path: "/identity/preview",
      handler: (input) => ({ status: 200, body: service.preview((input.body ?? {}) as never) }),
    },
  ];
}
