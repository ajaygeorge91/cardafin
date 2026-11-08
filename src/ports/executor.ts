// The write side: turn a pure `TxPlan` into a submitted transaction. One
// implementation per route — `MemoryLedger` and (step 4) `LucidExecutor` for
// "l1", `HydraExecutor` for "hydra". See docs/ARCHITECTURE.md §4.

import type { Lovelace } from "../core/ada.ts";
import type { TxPlan } from "../core/plan.ts";

export type TxRoute = "l1" | "hydra";

/** Never logged. The logger redacts anything under a `mnemonic` key. */
export type SignerRef = { mnemonic: string; accountIndex: number };

export type TxReceipt = {
  txHash: string;
  fee: Lovelace;
  route: TxRoute;
  explorerUrl?: string;
};

export interface TxExecutor {
  readonly route: TxRoute;
  execute(plan: TxPlan, signer: SignerRef): Promise<TxReceipt>;
}
