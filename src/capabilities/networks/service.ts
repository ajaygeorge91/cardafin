// NetworksService: the networks use cases. Depends on core and ports only,
// never on an adapter and never on another capability.

import type { Logger } from "../../ports/logger.ts";
import type { NetworksPlan } from "./plan.ts";
import { planNetworks } from "./plan.ts";
import type { NetworksRequest } from "./requests.ts";

export type NetworksServiceDeps = {
  log: Logger;
};

export class NetworksService {
  #log: Logger;

  constructor(deps: NetworksServiceDeps) {
    this.#log = deps.log;
  }

  preview(request: NetworksRequest): NetworksPlan {
    const plan = planNetworks(request);
    this.#log.debug("networks: planned", { capability: plan.capability });
    return plan;
  }
}
