// Network identity: the one place that knows testnet-vs-mainnet ids, bech32
// prefixes, Blockfrost hosts and explorer URLs. See docs/ARCHITECTURE.md §3.

import type { Result } from "./result.ts";
import { ok } from "./result.ts";
import { fail } from "./errors.ts";

export type Network = "Preview" | "Preprod" | "Mainnet";

export const NETWORKS: readonly Network[] = ["Preview", "Preprod", "Mainnet"];

export function parseNetwork(s: string): Result<Network> {
  for (const n of NETWORKS) {
    if (n === s) {
      return ok(n);
    }
  }
  return fail(
    "INVALID_REQUEST",
    `unknown network "${s}": expected one of ${NETWORKS.join(", ")}`,
    { allowed: NETWORKS },
  );
}

/** Cardano network id as it appears in the low nibble of an address header. */
export function networkId(n: Network): 0 | 1 {
  return n === "Mainnet" ? 1 : 0;
}

export function addressPrefix(n: Network): "addr_test" | "addr" {
  return n === "Mainnet" ? "addr" : "addr_test";
}

export function rewardAddressPrefix(n: Network): "stake_test" | "stake" {
  return n === "Mainnet" ? "stake" : "stake_test";
}

export function isMainnet(n: Network): boolean {
  return n === "Mainnet";
}

export function blockfrostUrl(n: Network): string {
  return `https://cardano-${n.toLowerCase()}.blockfrost.io/api/v0`;
}

export function explorerTxUrl(n: Network, txHash: string): string {
  switch (n) {
    case "Mainnet":
      return `https://cardanoscan.io/transaction/${txHash}`;
    case "Preprod":
      return `https://preprod.cardanoscan.io/transaction/${txHash}`;
    case "Preview":
      return `https://preview.cardanoscan.io/transaction/${txHash}`;
  }
}
