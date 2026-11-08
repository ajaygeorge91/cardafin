// createMemoryApp: the same composition root as `src/app.ts`, built from the
// in-memory adapters. Two uses:
//
//   * tests — one call instead of six constructors, and the `ledger` handle
//     comes back so a test can `fund`, `setSlot` and inspect `history`;
//   * local development — `CARDAFIN_NETWORK=Preview` with no Blockfrost key
//     and no tADA, to exercise the service and HTTP surfaces against
//     imaginary money.
//
// Pure: node: builtins and relative imports only, so it stays inside
// `src/core/purity.test.ts`'s rule and the test suite still runs with no
// node_modules. Nothing here derives a real key or submits anything.

import type { ProtocolParams } from "../../core/fees.ts";
import type { Network } from "../../core/network.ts";
import { blockfrostUrl, isMainnet } from "../../core/network.ts";
import type { ChainReader } from "../../ports/chain.ts";
import type { KeyPort } from "../../ports/keys.ts";
import type { Logger } from "../../ports/logger.ts";
import type { Config } from "../../config.ts";
import { secretsOf } from "../../config.ts";
import type { LogSink } from "../../services/logger.ts";
import { createLogger } from "../../services/logger.ts";
import { TxRouter } from "../../services/router.ts";
import { TxService } from "../../services/tx.ts";
import { WalletService } from "../../services/wallet.ts";
import { HydraExecutor } from "./hydra.ts";
import { MemoryKeys } from "./keys.ts";
import { MemoryLedger } from "./ledger.ts";

/**
 * Stands in for a Blockfrost project id. Not a key, could not be one, and
 * long enough (>= 8 characters) that the logger's secret scrubber will
 * redact it — so a test asserting "no secrets in the logs" is testing the
 * same code path production does.
 */
export const MEMORY_PROJECT_ID = "memoryADAPTERnotarealblockfrostkey";

export type MemoryAppOptions = {
  /**
   * Defaults to a fresh `MemoryKeys` phrase — *not* a BIP-39 mnemonic, and
   * not the public test vector, so nothing in `src/` outside a test file
   * contains a real-looking seed phrase.
   */
  mnemonic?: string;
  projectId?: string;
  slot?: number;
  params?: ProtocolParams;
  /** Wire the hydra route (which throws NOT_IMPLEMENTED). Default true. */
  hydra?: boolean;
  log?: Logger;
  /** Capture log records instead of writing them to stderr. */
  logSink?: LogSink;
};

export type MemoryApp = {
  wallet: WalletService;
  tx: TxService;
  chain: ChainReader;
  keys: KeyPort;
  router: TxRouter;
  log: Logger;
  config: Config;
  /** The same object as `chain`, typed so tests can `fund` and `setSlot`. */
  ledger: MemoryLedger;
};

export function createMemoryApp(
  network: Network,
  opts: MemoryAppOptions = {},
): MemoryApp {
  const keys = new MemoryKeys();
  const config: Config = {
    network,
    blockfrostProjectId: opts.projectId ?? MEMORY_PROJECT_ID,
    blockfrostUrl: blockfrostUrl(network),
    mnemonic: opts.mnemonic ?? keys.generateMnemonic(),
    // There is no real money behind a MemoryLedger, but the gate is kept
    // honest: a Mainnet memory app is still "confirmed" the same way.
    mainnetConfirmed: isMainnet(network),
    httpPort: 8787,
    apiKeys: [],
  };

  const ledger = new MemoryLedger(network, {
    keys,
    ...(opts.slot !== undefined ? { slot: opts.slot } : {}),
    ...(opts.params !== undefined ? { params: opts.params } : {}),
  });

  const log =
    opts.log ??
    createLogger({
      secrets: secretsOf(config),
      ...(opts.logSink !== undefined ? { sink: opts.logSink } : {}),
    });

  const router = new TxRouter(
    opts.hydra === false ? { l1: ledger } : { l1: ledger, hydra: new HydraExecutor() },
  );

  return {
    keys,
    chain: ledger,
    ledger,
    router,
    log,
    config,
    wallet: new WalletService({ keys, chain: ledger, config }),
    tx: new TxService({ keys, chain: ledger, router, config, log }),
  };
}
