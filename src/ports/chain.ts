// The read side of the chain. Everything that needs a network round trip in
// production lives behind this interface; `adapters/memory/ledger.ts` is the
// deterministic fake and `adapters/lucid/` (step 4) is the real thing.
// See docs/ARCHITECTURE.md §4.

import type { Assets } from "../core/assets.ts";
import type { ProtocolParams } from "../core/fees.ts";
import type { Network } from "../core/network.ts";
import type { Utxo } from "../core/types.ts";

// Core owns the UTxO shape (`sumUtxoAssets` and the planners reason about
// it), so ports re-export it rather than declaring a second one.
export type { Utxo };

export interface ChainReader {
  readonly network: Network;
  getUtxos(address: string): Promise<Utxo[]>;
  /** Conventionally `sumUtxoAssets(await getUtxos(address))`. */
  getBalance(address: string): Promise<Assets>;
  getCurrentSlot(): Promise<number>;
  getProtocolParams(): Promise<ProtocolParams>;
  /** Resolves true when the transaction is on chain, false on timeout. */
  awaitTx(txHash: string, timeoutMs?: number): Promise<boolean>;
}
