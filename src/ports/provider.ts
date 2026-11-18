// One build, several networks and several providers. Which one serves a call
// is config, never an import.
//
// Every implementation passes the same conformance suite rather than its own
// bespoke tests. That suite is the contract.

import type { AccountReader } from "./accounts.ts";
import type { ChainReader } from "./chain.ts";

export type ProviderId = "memory" | "blockfrost" | "koios" | "maestro";

export const PROVIDER_IDS: readonly ProviderId[] = ["memory", "blockfrost", "koios", "maestro"];

/**
 * The published ceilings. Blockfrost: 10 requests/second with a burst of 500
 * that cools off at that rate. Koios: 100 per 10 seconds, no key. The
 * scheduler reads these rather than hard-coding a number per call site.
 */
export type ProviderLimits = {
  requestsPerSecond: number;
  burst: number;
};

export type ProviderHealth = {
  id: ProviderId;
  healthy: boolean;
  consecutiveFailures: number;
  /** Epoch milliseconds of the most recent failure, if any. */
  lastFailureAt?: number;
};

export interface ChainProvider extends ChainReader, AccountReader {
  readonly id: ProviderId;
  readonly limits: ProviderLimits;
  health(): ProviderHealth;
}

/**
 * Picks which provider serves the next call and demotes one that is failing.
 * Failover must be sticky enough not to flap and must recover: a demoted
 * provider is retried after a cooldown, not abandoned for the process's life.
 */
export interface ProviderSelector {
  readonly providers: readonly ChainProvider[];
  current(): ChainProvider;
  reportSuccess(id: ProviderId): void;
  reportFailure(id: ProviderId, error: unknown): void;
  health(): ProviderHealth[];
}
