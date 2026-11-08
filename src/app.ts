// The production wiring: a `Config` in, the service surface out.
//
// There is exactly one composition root in cardafin and this is it. Services
// never construct an adapter, adapters never read `process.env`, and the
// decision "which KeyPort, which ChainReader, which executor per route" is
// made here and nowhere else. `src/adapters/memory/app.ts` is the same shape
// built from fakes, which is what makes the test suite's wiring and the real
// wiring comparable.
//
// Importing this module pulls in @lucid-evolution/lucid and
// @blockfrost/blockfrost-js, which is why it is not re-exported from
// `src/index.ts` and why no test imports it. See docs/ARCHITECTURE.md §1.

import type { Config } from "./config.ts";
import { secretsOf } from "./config.ts";
import type { ChainReader } from "./ports/chain.ts";
import type { KeyPort } from "./ports/keys.ts";
import type { Logger } from "./ports/logger.ts";
import { TxRouter } from "./services/router.ts";
import { TxService } from "./services/tx.ts";
import { WalletService } from "./services/wallet.ts";
import { createLogger } from "./services/logger.ts";
import { HydraExecutor } from "./adapters/memory/hydra.ts";
import { LucidChain } from "./adapters/lucid/chain.ts";
import { LucidExecutor } from "./adapters/lucid/executor.ts";
import { LucidKeys } from "./adapters/lucid/keys.ts";

export type App = {
  wallet: WalletService;
  tx: TxService;
  chain: ChainReader;
  keys: KeyPort;
  router: TxRouter;
  log: Logger;
};

/**
 * Wire the real adapters. `log` is injectable so the CLI and the HTTP surface
 * can choose a sink; the default redacts the mnemonic and the Blockfrost
 * project id, which is the only sensible default when the thing being wired
 * holds both.
 *
 * The "hydra" route is wired to `HydraExecutor`, which throws
 * NOT_IMPLEMENTED. That is on purpose: `hydra: true` should fail with "not
 * built" rather than silently settling on L1.
 */
export function createApp(config: Config, log?: Logger): App {
  const logger = log ?? createLogger({ secrets: secretsOf(config) });

  const keys = new LucidKeys();
  const chain = new LucidChain({
    network: config.network,
    projectId: config.blockfrostProjectId,
  });
  const router = new TxRouter({
    l1: new LucidExecutor(
      {
        network: config.network,
        projectId: config.blockfrostProjectId,
        blockfrostUrl: config.blockfrostUrl,
        mainnetConfirmed: config.mainnetConfirmed,
      },
      logger,
    ),
    hydra: new HydraExecutor(),
  });

  return {
    keys,
    chain,
    router,
    log: logger,
    wallet: new WalletService({ keys, chain, config }),
    tx: new TxService({ keys, chain, router, config, log: logger }),
  };
}
