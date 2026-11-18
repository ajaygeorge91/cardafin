// AssetsService: the assets use cases. Depends on core and ports only,
// never on an adapter and never on another capability.

import type { Logger } from "../../ports/logger.ts";
import type { AssetsPlan } from "./plan.ts";
import { planAssets } from "./plan.ts";
import type { AssetsRequest } from "./requests.ts";

export type AssetsServiceDeps = {
  log: Logger;
};

export class AssetsService {
  #log: Logger;

  constructor(deps: AssetsServiceDeps) {
    this.#log = deps.log;
  }

  preview(request: AssetsRequest): AssetsPlan {
    const plan = planAssets(request);
    this.#log.debug("assets: planned", { capability: plan.capability });
    return plan;
  }
}
