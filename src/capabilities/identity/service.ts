// IdentityService: the identity use cases. Depends on core and ports only,
// never on an adapter and never on another capability.

import type { Logger } from "../../ports/logger.ts";
import type { IdentityPlan } from "./plan.ts";
import { planIdentity } from "./plan.ts";
import type { IdentityRequest } from "./requests.ts";

export type IdentityServiceDeps = {
  log: Logger;
};

export class IdentityService {
  #log: Logger;

  constructor(deps: IdentityServiceDeps) {
    this.#log = deps.log;
  }

  preview(request: IdentityRequest): IdentityPlan {
    const plan = planIdentity(request);
    this.#log.debug("identity: planned", { capability: plan.capability });
    return plan;
  }
}
