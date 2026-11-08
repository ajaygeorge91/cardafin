// Shared data shapes that core owns but several modules (and, from step 3,
// `src/ports`) need. Kept separate from assets.ts to avoid import cycles.

import type { Assets } from "./assets.ts";

/**
 * An unspent transaction output. Core defines it because `sumUtxoAssets` and
 * the planners reason about it; `ports/chain.ts` re-exports this exact type
 * rather than declaring its own.
 */
export type Utxo = {
  txHash: string;
  outputIndex: number;
  address: string;
  assets: Assets;
};

/** Stable key for a UTxO: "<txHash>#<outputIndex>". */
export function utxoRef(u: Utxo): string {
  return `${u.txHash}#${u.outputIndex}`;
}
