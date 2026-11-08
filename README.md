# cardafin

## What it is

cardafin is a Cardano wallet manager: a service layer for creating and
restoring wallets, deriving addresses, reading balances and UTxOs, sending
ADA and native tokens, and minting under time-locked native-script policies.
It is not a listings database — that earlier framing (see
`docs/OPUS-ANALYSIS.md` / `docs/FABLE-ANALYSIS.md`, July 2026) is superseded
by `docs/ARCHITECTURE.md`.

## Status

v1 is in progress, built in the step order below (see
`docs/ARCHITECTURE.md` §8).

| Step | Deliverable | Status |
|---|---|---|
| 1 | skeleton, LICENSE, .gitignore, tsconfig, package.json, README stub, GitHub repo | done |
| 2 | `src/core/*` + tests | done |
| 3 | `src/ports/*`, `src/adapters/memory/*`, `src/services/*` + tests | done |
| 4 | `src/adapters/lucid/*`, `src/config.ts` | not started |
| 5 | wallet ops wired in `cli.ts` | not started |
| 6 | send ADA | not started |
| 7 | policy / mint / send tokens | not started |
| 8 | `src/http/*` | not started |

## Architecture at a glance

Services take ports, not implementations. Wiring them to the in-memory
adapters is the whole of a test setup — and the shape the lucid adapter will
drop into unchanged:

```ts
import { MemoryKeys, MemoryLedger, HydraExecutor } from "./src/adapters/memory/index.ts";
import { TxRouter, TxService, WalletService, createLogger, loadConfig, secretsOf } from "./src/index.ts";

const config = loadConfig(process.env);          // Result<Config>, pure
if (!config.ok) throw config.error;

const keys = new MemoryKeys();                                   // KeyPort
const ledger = new MemoryLedger(config.value.network, { keys }); // ChainReader + TxExecutor "l1"
const router = new TxRouter({ l1: ledger, hydra: new HydraExecutor() });
const log = createLogger({ secrets: secretsOf(config.value) }); // redacts seeds, keys, CBOR

const wallet = new WalletService({ keys, chain: ledger, config: config.value });
const tx = new TxService({ keys, chain: ledger, router, config: config.value, log });
```

Swap `MemoryKeys`/`MemoryLedger` for `LucidKeys`/`LucidChain`/`LucidExecutor`
(step 4) and nothing in `services` or `core` changes.

## Requirements

Node >= 22.12.

## Run

```sh
cp .env.example .env
# fill in BLOCKFROST_PROJECT_ID (and CARDAFIN_MNEMONIC if not using the
# throwaway test vector) in .env
npm install
npm run cli -- --help   # coming in step 5
```

## Test

`npm test` runs `node --experimental-strip-types --test 'src/**/*.test.ts'`
directly against the TypeScript sources with Node's built-in type stripping
and built-in test runner (`node:test` + `node:assert/strict`). It needs no
`node_modules`, no network access and no key: `src/core`, `src/ports`,
`src/services` and `src/adapters/memory` all import nothing but relative
files and `node:` builtins, which `src/core/purity.test.ts` enforces by
grepping them. See `docs/ARCHITECTURE.md` §1 for why.

The service tests are end-to-end against `MemoryLedger` and `MemoryKeys` —
real planning, fees, min-ADA, time-locked policies, minting and change, with
imaginary money. `adapters/lucid` (step 4) is the one directory exempt from
the purity rule, and nothing in the test suite touches it.

`npm run typecheck` runs `tsc`, which does need `npm install` first (it is a
devDependency, not part of the Node runtime).

```sh
npm test         # no install needed
npm install
npm run typecheck
npm run check    # typecheck + test
```

## Env vars

| Var | Meaning |
|---|---|
| `CARDAFIN_NETWORK` | `Preview` \| `Preprod` \| `Mainnet`. Default `Preview`. Mainnet is real money. |
| `BLOCKFROST_PROJECT_ID` | Blockfrost project id; must match the network above. |
| `CARDAFIN_MNEMONIC` | 24-word master mnemonic. v1 key custody is this env var on the host — see Security below. |
| `CARDAFIN_MAINNET_CONFIRM` | Must equal `I_UNDERSTAND_REAL_FUNDS` when `CARDAFIN_NETWORK=Mainnet`, else startup is refused. |
| `CARDAFIN_HTTP_PORT` | Port for the HTTP surface (step 8). Default `8787`. |
| `CARDAFIN_API_KEYS` | Comma-separated bearer tokens accepted by the HTTP surface. |

## Security

- No secrets are committed to git: `.env` is gitignored (`.env.example` is
  the only tracked env file) and `AGENTS.md` / `CLAUDE.md` / `.claude/` are
  also gitignored.
- Key custody in v1 is a single master mnemonic in an env var on the host.
  That is good enough for a single-operator testnet service; it is not good
  enough for meaningful mainnet funds. The upgrade path is swapping the
  implementation behind `KeyPort` for a KMS/HSM-backed signer without
  touching services or core.
- Mainnet is opt-in: `loadConfig` refuses to start against `Mainnet` unless
  `CARDAFIN_MAINNET_CONFIRM=I_UNDERSTAND_REAL_FUNDS`, and every executor
  re-checks before submitting.
- The logger redacts on the way out, by four rules: any configured secret
  string (the mnemonic and the Blockfrost project id, via `secretsOf`); any
  data key matching `mnemonic|seed|cbor|witness|privatekey|secret|apikey|projectid`
  at any depth and in any case; any run of 24 or more lowercase words, even
  one that was never configured; and any run of 400+ hex characters, which is
  reported as `[REDACTED:hex len N]`. Seeds, keys and transaction bodies are
  never logged, and `src/services/logger.test.ts` covers all four rules.
- `loadConfig` refuses the `.env.example` placeholder project id by name, so
  a copied-but-unedited `.env` fails at startup rather than at the first
  Blockfrost call.

## Architecture

`core` is pure domain logic (bigint lovelace, addresses, assets, metadata,
fees, native scripts, request validation, tx planning) with zero npm
imports; `ports` define the interfaces for anything touching a key or the
network; `adapters/memory` gives deterministic fakes for every port used by
tests, while `adapters/lucid` is the only directory allowed to import
`@lucid-evolution/lucid` and `@blockfrost/blockfrost-js`; `services` compose
core + ports into wallet and transaction use-cases; `http` and `cli` are thin
surfaces over services. See `docs/ARCHITECTURE.md` for the full, binding
spec.

## License

MIT — see `LICENSE`.
