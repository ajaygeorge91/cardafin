// cardafin's public surface: the pure core, the port interfaces, the
// services and the config loader.
//
// Deliberately **not** re-exported here: `src/adapters/*`. The lucid adapter
// pulls in @lucid-evolution/lucid and @blockfrost/blockfrost-js, and the
// memory adapter is test scaffolding; importing cardafin should cost neither.
// Reach for them by path: `src/adapters/memory/index.ts`.

export * from "./core/index.ts";
export * from "./services/index.ts";
export * from "./config.ts";

// Explicit rather than `export *`: ports/chain.ts re-exports core's `Utxo`,
// and two star exports of the same name are ambiguous.
export type {
  ChainReader,
  KeyPort,
  WalletInfo,
  TxExecutor,
  TxRoute,
  SignerRef,
  TxReceipt,
  Logger,
  LogLevel,
} from "./ports/index.ts";
