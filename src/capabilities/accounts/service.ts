// AccountsService: the accounts use cases. Depends on core and ports only,
// never on an adapter and never on another capability.

import type { Logger } from "../../ports/logger.ts";
import type { AccountsPlan } from "./plan.ts";
import { planAccounts } from "./plan.ts";
import type { AccountsRequest } from "./requests.ts";

export type AccountsServiceDeps = {
  log: Logger;
};

export class AccountsService {
  #log: Logger;

  constructor(deps: AccountsServiceDeps) {
    this.#log = deps.log;
  }

  preview(request: AccountsRequest): AccountsPlan {
    const plan = planAccounts(request);
    this.#log.debug("accounts: planned", { capability: plan.capability });
    return plan;
  }
}
