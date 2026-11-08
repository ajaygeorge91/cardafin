// HydraExecutor: the "hydra" route, designed and deliberately unimplemented.
//
// Hydra is a state channel, not storage. Routing a cardafin transaction
// through a head means opening one, committing UTxOs to it, transacting
// off-chain and closing with a fanout — none of which exists yet. The port
// and the route flag exist so that `hydra: true` is a routing decision all
// the way from the client contract to the executor, and so that adding a
// real head later changes one adapter instead of the request shape.
//
// See docs/ARCHITECTURE.md §4.

import { CardafinError } from "../../core/errors.ts";
import type { TxPlan } from "../../core/plan.ts";
import type { SignerRef, TxExecutor, TxReceipt } from "../../ports/executor.ts";

export const HYDRA_NOT_IMPLEMENTED_MESSAGE =
  "Hydra routing is designed but not built; see docs/ARCHITECTURE.md";

export class HydraExecutor implements TxExecutor {
  readonly route: "hydra" = "hydra";

  async execute(plan: TxPlan, _signer: SignerRef): Promise<TxReceipt> {
    throw new CardafinError("NOT_IMPLEMENTED", HYDRA_NOT_IMPLEMENTED_MESSAGE, {
      kind: plan.kind,
      network: plan.network,
    });
  }
}
