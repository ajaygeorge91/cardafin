// TxRouter: picks the executor for a plan's route. The whole of cardafin's
// Hydra story at the service layer is this class plus a `hydra?: boolean` on
// the request. See docs/ARCHITECTURE.md §4.

import { CardafinError } from "../core/errors.ts";
import type { TxExecutor, TxRoute } from "../ports/executor.ts";

export type TxExecutors = {
  l1: TxExecutor;
  hydra?: TxExecutor;
};

export class TxRouter {
  #l1: TxExecutor;
  #hydra?: TxExecutor;

  constructor(executors: TxExecutors) {
    this.#l1 = executors.l1;
    if (executors.hydra) {
      this.#hydra = executors.hydra;
    }
  }

  /** True when a hydra executor is wired up at all. */
  get hasHydra(): boolean {
    return this.#hydra !== undefined;
  }

  for(route: TxRoute): TxExecutor {
    if (route === "l1") {
      return this.#l1;
    }
    if (!this.#hydra) {
      throw new CardafinError(
        "NOT_IMPLEMENTED",
        "hydra routing was requested but no hydra executor is configured",
        { route },
      );
    }
    return this.#hydra;
  }
}
