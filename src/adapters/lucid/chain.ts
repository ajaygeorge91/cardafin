// LucidChain: the real `ChainReader`, backed by Blockfrost.
//
// Reads only — nothing here holds a key or submits anything. It talks to
// `@blockfrost/blockfrost-js` directly rather than through lucid's provider
// wrapper because the four things cardafin needs (UTxOs, tip slot, protocol
// parameters, tx confirmation) are four plain REST calls, and going through
// the raw client keeps the conversions in `mappers.ts` where they are tested.
//
// Three decisions worth knowing about:
//
//  1. A 404 from `/addresses/{a}/utxos` means "this address has never
//     appeared on chain", which is an empty UTxO set, not a failure. Every
//     fresh wallet hits it, so it is mapped to `[]`.
//  2. Every other provider failure becomes a `CardafinError("PROVIDER_ERROR")`
//     carrying the provider's message — but never the project id. The id
//     travels in a header rather than the URL, so it should not appear in an
//     error anyway; `#sanitise` strips it regardless, because "should not" is
//     not a guarantee worth betting a key on.
//  3. `awaitTx` polls. blockfrost-js has no `awaitTx` of its own (that is a
//     lucid provider-class addition), so this is a 5-second `GET /txs/{hash}`
//     loop that treats 404 as "not yet" and anything else as a failure.
//
// See docs/ARCHITECTURE.md §4.

import { setTimeout as sleep } from "node:timers/promises";

import { BlockFrostAPI } from "@blockfrost/blockfrost-js";

import type { Assets } from "../../core/assets.ts";
import { sumUtxoAssets } from "../../core/assets.ts";
import { CardafinError, isCardafinError } from "../../core/errors.ts";
import type { ProtocolParams } from "../../core/fees.ts";
import type { Network } from "../../core/network.ts";
import type { Utxo } from "../../core/types.ts";
import type { ChainReader } from "../../ports/chain.ts";
import {
  blockfrostParamsToCore,
  blockfrostUtxoToCore,
  isBlockfrost404,
} from "./mappers.ts";

export type LucidChainConfig = {
  network: Network;
  projectId: string;
};

export type LucidChainDeps = {
  /** Injectable so a future integration test can drive a stub client. */
  api?: BlockFrostAPI;
};

/** Default `awaitTx` budget: two minutes, a few Cardano blocks. */
export const DEFAULT_AWAIT_TIMEOUT_MS = 120_000;

/** How often `awaitTx` asks. Blocks are ~20 s apart; 5 s is responsive. */
export const AWAIT_POLL_INTERVAL_MS = 5_000;

/** cardafin's `Network` → the lowercase name blockfrost-js expects. */
export function blockfrostNetworkName(
  network: Network,
): "mainnet" | "preview" | "preprod" {
  switch (network) {
    case "Mainnet":
      return "mainnet";
    case "Preprod":
      return "preprod";
    case "Preview":
      return "preview";
  }
}

export class LucidChain implements ChainReader {
  readonly network: Network;

  #api: BlockFrostAPI;
  #projectId: string;

  constructor(config: LucidChainConfig, deps: LucidChainDeps = {}) {
    if (typeof config.projectId !== "string" || config.projectId.trim() === "") {
      throw new CardafinError(
        "INVALID_REQUEST",
        "a Blockfrost project id is required to read the chain",
      );
    }
    this.network = config.network;
    this.#projectId = config.projectId;
    this.#api =
      deps.api ??
      new BlockFrostAPI({
        projectId: config.projectId,
        network: blockfrostNetworkName(config.network),
      });
  }

  async getUtxos(address: string): Promise<Utxo[]> {
    try {
      const rows = await this.#api.addressesUtxosAll(address);
      return rows.map(blockfrostUtxoToCore);
    } catch (e) {
      if (isBlockfrost404(e)) {
        // Unused address: no transaction has ever paid it, so it has no
        // UTxOs. Not an error — it is the state every new wallet starts in.
        return [];
      }
      throw this.#wrap(e, `reading UTxOs for ${truncate(address)}`);
    }
  }

  async getBalance(address: string): Promise<Assets> {
    return sumUtxoAssets(await this.getUtxos(address));
  }

  async getCurrentSlot(): Promise<number> {
    let slot: number | null | undefined;
    try {
      slot = (await this.#api.blocksLatest()).slot;
    } catch (e) {
      throw this.#wrap(e, "reading the chain tip");
    }
    if (typeof slot !== "number") {
      // The schema types `slot` as nullable (a block can predate slots in the
      // Byron era). On a live chain it never is, and a plan cannot be built
      // without it, so this is a provider failure rather than a default.
      throw new CardafinError(
        "PROVIDER_ERROR",
        "Blockfrost returned a latest block with no slot number",
      );
    }
    return slot;
  }

  async getProtocolParams(): Promise<ProtocolParams> {
    try {
      return blockfrostParamsToCore(await this.#api.epochsLatestParameters());
    } catch (e) {
      throw this.#wrap(e, "reading protocol parameters");
    }
  }

  /**
   * Poll until the transaction is visible, or give up. `false` means "not seen
   * within the timeout", which on Cardano is not the same as "rejected" — the
   * caller already holds the tx hash and can look it up later.
   */
  async awaitTx(
    txHash: string,
    timeoutMs: number = DEFAULT_AWAIT_TIMEOUT_MS,
  ): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      try {
        await this.#api.txs(txHash);
        return true;
      } catch (e) {
        if (!isBlockfrost404(e)) {
          throw this.#wrap(e, `awaiting transaction ${txHash}`);
        }
        // 404: not in a block yet.
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      await sleep(Math.min(AWAIT_POLL_INTERVAL_MS, remaining));
    }
  }

  /** Never let the project id into a message, whatever the provider said. */
  #sanitise(message: string): string {
    if (this.#projectId.length < 8) {
      return message;
    }
    return message.split(this.#projectId).join("[REDACTED]");
  }

  #wrap(e: unknown, what: string): CardafinError {
    if (isCardafinError(e)) {
      return e;
    }
    const message = e instanceof Error ? e.message : String(e);
    const status =
      e !== null && typeof e === "object"
        ? (e as { status_code?: unknown }).status_code
        : undefined;
    return new CardafinError(
      "PROVIDER_ERROR",
      `Blockfrost failed while ${what}: ${this.#sanitise(message)}`,
      typeof status === "number" ? { network: this.network, status } : { network: this.network },
    );
  }
}

function truncate(address: string): string {
  return address.length <= 20 ? address : `${address.slice(0, 12)}…${address.slice(-6)}`;
}
