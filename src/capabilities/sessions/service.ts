// SessionsService: the sessions use cases. Depends on core and ports only,
// never on an adapter and never on another capability.

import type { Logger } from "../../ports/logger.ts";
import type { SessionsPlan } from "./plan.ts";
import { planSessions } from "./plan.ts";
import type { SessionsRequest } from "./requests.ts";

export type SessionsServiceDeps = {
  log: Logger;
};

export class SessionsService {
  #log: Logger;

  constructor(deps: SessionsServiceDeps) {
    this.#log = deps.log;
  }

  preview(request: SessionsRequest): SessionsPlan {
    const plan = planSessions(request);
    this.#log.debug("sessions: planned", { capability: plan.capability });
    return plan;
  }
}
