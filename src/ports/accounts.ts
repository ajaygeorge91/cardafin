// The read side of an account rather than a single address.
//
// Separate from `chain.ts` because the cost shape is different: base
// addresses share one stake credential, so a whole account comes back in a
// call or two, while enterprise addresses have no stake part — a hundred of
// them is a hundred lookups, ten seconds at Blockfrost's 10 req/s. Hence
// `getUtxosBatch` rather than a loop over `ChainReader.getUtxos`.

import type { Network } from "../core/network.ts";
import type { Utxo } from "../core/types.ts";

export interface AccountReader {
  readonly network: Network;
  /**
   * Every address the chain has seen for this stake credential — base
   * addresses only. Enterprise addresses carry no stake part and are
   * invisible here, so discovery cannot be built on this call alone.
   */
  getAccountAddresses(rewardAddress: string): Promise<string[]>;
  /**
   * UTxOs for many addresses; the implementation owns batching, rate
   * limiting and concurrency. An address with no UTxOs comes back with an
   * empty array rather than missing, so "empty" and "never queried" stay
   * distinct.
   */
  getUtxosBatch(addresses: readonly string[]): Promise<Map<string, Utxo[]>>;
  /**
   * The gap-scan primitive, and not `getUtxos`: an address that was used and
   * then emptied is still used, and must not end the scan.
   */
  isUsed(address: string): Promise<boolean>;
}
