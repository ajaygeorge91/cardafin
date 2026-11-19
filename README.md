# cardafin

[![check](https://github.com/ajaygeorge91/cardafin/actions/workflows/check.yml/badge.svg)](https://github.com/ajaygeorge91/cardafin/actions/workflows/check.yml)

## What it is

cardafin is a service layer that lets a web app offer wallet-based identity and
issue its own tokens on Cardano, without handling a key or talking to a chain
node itself.

Working today: create and restore wallets, derive addresses, read balances and
UTxOs, send ADA and native tokens, and mint under time-locked native-script
policies — over both a CLI and an HTTP API, with every path tested offline.

Being built, as five modules that talk only through frozen interfaces:

| Module | What it is |
|---|---|
| `identity` | CIP-8 / COSE_Sign1 verification — the server half of browser wallet login |
| `accounts` | CIP-1852 derivation, gap-limit discovery, portfolio aggregation |
| `assets` | CIP-14 fingerprints, CIP-25 and CIP-68 metadata, policy composition |
| `sessions` | OAuth and wallet login landing on one linked account |
| `networks` | provider selection, rate limiting, retry and failover |

Its first consumer is [plotmap](https://plotmap.com), my own map-first
real-estate marketplace, which records a listing's price and status history on
chain so a buyer can check a claim rather than trust a screenshot.
`docs/PLOTMAP-BRIEF.md` is what that requires.

`docs/ARCHITECTURE.md` is the binding design. `docs/archive/` holds superseded
July 2026 explorations from when this was scoped as a verifiable database.

## Status

v1 is complete — core, ports, memory adapters, the Lucid/Blockfrost adapter,
the CLI and the HTTP surface (steps 1–8 of `docs/ARCHITECTURE.md` §8). Every
service has both a CLI command and an HTTP route.

The shared foundation for the five modules is in place: their port contracts,
fingerprinted; the capability registry and its isolation test; the spec vectors
the crypto modules need; the offline dev console; and the browser half of
wallet login. 451 tests, all offline.

The modules themselves are briefs and route declarations. Every route answers
`501 NOT_IMPLEMENTED` with a pointer to its README until it is written, and
`npm run console:probe` shows which.

Two caveats. The Lucid adapter has not been run against Preview — see *Not yet
smoke-tested* below for what to watch on a first run. And the HTTP surface is
tested only against the in-memory adapters, deliberately:
`src/http/router.test.ts` never imports `src/app.ts`.

## Try it without installing anything

The test suite and the dev console need no `node_modules`, no network and no
API key. `src/core`, `src/ports`, `src/services`, `src/capabilities`,
`src/fixtures` and `src/adapters/memory` import nothing but relative files and
`node:` builtins, and `src/core/purity.test.ts` fails the build if that stops
being true.

```sh
git clone https://github.com/ajaygeorge91/cardafin && cd cardafin
npm test               # 451 tests, nothing installed
npm run console:probe  # every HTTP route, exercised and printed as text
npm run console        # the same, in a browser at localhost:8787/console
```

`npm run console` serves the whole service over a deterministic fake ledger.
There is no executor behind it, so it cannot reach a chain. The page is plain
HTML, CSS and ES modules — no framework, no build step, no CDN.

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

That is exactly what `createMemoryApp(network)` in
`src/adapters/memory/app.ts` does in one call. `createApp(config)` in
`src/app.ts` is the same wiring with `LucidKeys`/`LucidChain`/`LucidExecutor`
instead, and nothing in `services` or `core` changes between the two.

## How a module is added

One module per folder under `src/capabilities/`. A new one starts as a brief
and a route declaration:

```sh
npm run new-capability records "Listing versions recorded on chain"
```

then two lines in `src/capabilities/registry.ts` — an import and a list entry.
That is the only shared file, and three tests keep it safe to share:

- **`registry.test.ts`** — every folder is registered, every route path lives
  under `/<its own module name>`, no two modules claim a path, and nothing
  shadows an existing `/v1` route. A collision throws at construction.
- **`isolation.test.ts`** — no module imports another; they talk through
  `src/ports/*`. Specifiers are resolved, so `../../identity/service.ts` is
  caught, not just a literal path match.
- **`src/ports/frozen.test.ts`** — the port contracts are fingerprinted, with
  comments stripped so improving a doc comment is free. Changing one means
  `npm run freeze` and a one-line manifest diff.

`src/capabilities/README.md` has the rules each module keeps: pure request
parsing, closed request shapes, obviously-fake fixtures.

## What the lucid adapter does

`src/adapters/lucid/` is the only directory allowed to import
`@lucid-evolution/lucid` or `@blockfrost/blockfrost-js`, which would normally
make it the least testable code in the repo — `npm test` has to pass from a
clean clone with no `node_modules`, no network and no Blockfrost key. So the
two parts most worth testing were pulled out into modules that import nothing
from npm:

- **`translate.ts`** — `TxPlan` → builder calls. `applyPlan` decides which
  calls a plan implies, in what order, with what arguments (an output per
  `pay.ToAddress`; `mintAssets` plus `attach.MintingPolicy` when the plan
  mints; `validTo(slotToUnixTime(slot))` when it is time-locked; one
  `attachMetadata` per label), against a structural `MinimalTxBuilder` subset
  that lucid's real `TxBuilder` satisfies. The tests drive it with a
  recording fake and assert the exact call sequence. `metadatumToLucid`
  narrows core's `bigint` metadatum integers to the `number` lucid's
  `TransactionMetadata` accepts, and refuses anything past 2^53 with
  `INVALID_METADATA` rather than silently writing a different number on
  chain.
- **`mappers.ts`** — Blockfrost JSON → core types. Decimal-string quantities
  become `bigint` exactly; nullable `coins_per_utxo_size` and `max_val_size`
  fall back to `CONWAY_DEFAULT_PARAMS` so a min-ADA estimate can never
  collapse to zero; a 404 is detected on the numeric `status_code` rather
  than by matching an error message.

What is left genuinely needs a network, and only `LucidExecutor.execute`
touches it on the write path: open a Blockfrost provider, select the wallet
from the seed, check that the address it derives is the one the plan was
built for, apply the plan, `.complete()` (lucid does coin selection, change,
balancing and the exact fee), read the fee off the built transaction body,
log `describePlan` **before** submitting, then
`sign.withWallet().complete().submit()`. Lucid's own error messages can
contain a whole serialised transaction, so they are sanitised — runs of 400+
hex characters omitted, 500-character truncation — before being re-thrown as
`PROVIDER_ERROR`.

`LucidKeys` is the only file in cardafin that handles signing material. A
mnemonic never leaves it in any form, error messages included: lucid's error
for an invalid phrase can echo the words back, so it is replaced rather than
wrapped.

## Requirements

**Node >= 22.12**, and nothing else to run the tests.

The version matters: `npm test` runs the TypeScript sources directly through
Node's built-in type stripping (`--experimental-strip-types`, Node 22.6+) and
built-in test runner, with no transpile step and no test framework. On an
older Node the suite cannot run at all. `npm run typecheck` additionally wants
`typescript` and `@types/node` from npm, which is the only thing in this repo
that needs an install.

## CLI

```sh
npm install
npm run cli -- --help
```

| Command | What it does |
|---|---|
| `wallet new [--json]` | Generate a fresh 24-word mnemonic and print it once. |
| `wallet address [--account N]` | Derive a payment address from `CARDAFIN_MNEMONIC`. |
| `wallet balance [--account N \| --address ADDR]` | ADA and native-token balance. |
| `wallet utxos [--account N \| --address ADDR]` | Unspent outputs at an address. |
| `send-ada --to ADDR --amount ADA` | Send ADA. |
| `policy new [--lock-seconds S \| --lock-before-slot SLOT] [--out FILE]` | Create a time-locked minting policy. |
| `mint --policy FILE --name NAME --quantity Q` | Mint (negative quantity burns). |
| `send-tokens --to ADDR --asset UNIT=QTY` | Send native tokens; `--asset` repeats. |

Every command takes `--json` for machine-readable output on stdout. Every
write command (`send-ada`, `mint`, `send-tokens`) previews first — the plan,
the network, the route and the estimated fee — and then asks `Proceed?
[y/N]`. `--yes` skips that prompt on a testnet so the commands are
scriptable. It does **not** skip it on Mainnet, where the operator has to
type the word `Mainnet`: a `--yes` copied out of a Preview runbook must not
move real money.

stdout is for data and stderr is for everything else — log records, plan
summaries, prompts — so `npm run cli -- wallet balance --json | jq` works.
`wallet new` and `--help` need no `.env` at all; everything else exits 2 if
the environment is incomplete.

## HTTP API

```sh
npm run serve
```

starts `src/http/server.ts` on `CARDAFIN_HTTP_PORT` (default `8787`), wired
to the same `Config` and the same real adapters as the CLI. It is a thin
`node:http` surface — no framework — over `WalletService` and `TxService`;
see `docs/ARCHITECTURE.md` §9 for how the routing, auth and error mapping
are built.

**Auth.** Every route except `GET /v1/health` requires
`Authorization: Bearer <key>`, where `<key>` is one of the comma-separated
tokens in `CARDAFIN_API_KEYS`. If `CARDAFIN_API_KEYS` is empty, every
protected route returns `503 NO_API_KEYS` — this surface fails closed, it
never serves a protected route unauthenticated.

| Route | What it does | Example |
|---|---|---|
| `POST /v1/tx/send-ada?dryRun=1` | Price a send without submitting it — the plan, the estimated fee, the min-ADA per output. | `curl -s localhost:8787/v1/tx/send-ada?dryRun=1 -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"to":"addr_test1...","amount":"2"}'` |
| `GET /v1/health` | `{ ok, network, version }`. No auth. | `curl -s localhost:8787/v1/health` |
| `GET /v1/wallet/address?account=N` | Derive a payment address. | `curl -s "localhost:8787/v1/wallet/address?account=0" -H "Authorization: Bearer $KEY"` |
| `GET /v1/wallet/balance?account=N\|address=ADDR` | ADA and native-token balance. | `curl -s "localhost:8787/v1/wallet/balance?account=0" -H "Authorization: Bearer $KEY"` |
| `GET /v1/wallet/utxos?account=N\|address=ADDR` | Unspent outputs. | `curl -s "localhost:8787/v1/wallet/utxos?account=0" -H "Authorization: Bearer $KEY"` |
| `POST /v1/wallet/restore` | Derive a wallet from a mnemonic (never logged). | `curl -s localhost:8787/v1/wallet/restore -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"mnemonic":"..."}'` |
| `POST /v1/tx/send-ada` | Send ADA; `{ receipt }`. | `curl -s localhost:8787/v1/tx/send-ada -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"to":"addr_test1...","amount":"2"}'` |
| `POST /v1/policies` | Create a time-locked minting policy. | `curl -s localhost:8787/v1/policies -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"lockInSeconds":86400}'` |
| `POST /v1/tx/mint` | Mint under a policy; `{ receipt }`. | `curl -s localhost:8787/v1/tx/mint -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"policyId":"...","assetName":"CARDAFIN","quantity":"1000"}'` |
| `POST /v1/tx/send-tokens` | Send native tokens; `{ receipt }`. | `curl -s localhost:8787/v1/tx/send-tokens -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"to":"addr_test1...","assets":{"<unit>":"400"}}'` |

Every write route (`send-ada`, `mint`, `send-tokens`) accepts `?dryRun=1` or
`{"dryRun": true}` in the body, as shown above for `send-ada`. A request
body also takes an optional `account` (the CIP-1852 account index, default
0); `mint` additionally accepts a `policy` object instead of relying on the
in-memory lookup.

**Errors** are always `{ "error": { "code", "message", "details"? } }`:

| Code | Status |
|---|---|
| `INVALID_*`, `BELOW_MIN_ADA`, `WRONG_NETWORK` | 400 |
| `INSUFFICIENT_FUNDS` | 402 |
| `UNAUTHORIZED` | 401 |
| `MAINNET_NOT_CONFIRMED` | 403 |
| `NOT_IMPLEMENTED` | 501 |
| `NO_API_KEYS` | 503 |
| `PROVIDER_ERROR` | 502 |
| anything else | 500, generic message, never the stack |

**Notes, by design, not oversight:**

- **No `POST /v1/wallet/create` over HTTP.** Minting a fresh mnemonic through
  an API call and handing it back in the response body is a footgun — it
  will end up in an access log or a proxy somewhere. Generate one offline
  with `npm run cli -- wallet new` and bring it in through
  `POST /v1/wallet/restore` instead.
- **Policies are in-memory for the process**, keyed by `policyId`, and are
  gone on restart. v1 has no registry; the caller keeps the `PolicyInfo`
  JSON `POST /v1/policies` returns, the same as the CLI's `policy.json` —
  lose it and the policy can never mint or burn again.
- **`hydra: true` is accepted and returns `501 NOT_IMPLEMENTED` by design.**
  The flag flows straight through to the plan unchanged, so the client
  contract will not change shape the day a real Hydra executor lands.

## Try it on Preview

Preview is a public Cardano testnet. The tADA on it is free and worthless,
which makes it the right place to find out whether this actually works.

**1. Get a Blockfrost project.** Sign up at
[blockfrost.io](https://blockfrost.io), create a project, and choose the
**Preview** network — a Preprod or Mainnet key will not work against Preview
and will fail with a 403 rather than something helpful.

**2. Generate a wallet.** This needs no configuration:

```sh
npm install
npm run cli -- wallet new
```

Those 24 words are the only copy. cardafin does not store them.

**3. Write `.env`.**

```sh
cp .env.example .env
```

```ini
CARDAFIN_NETWORK=Preview
BLOCKFROST_PROJECT_ID=previewYOURKEYHERE
CARDAFIN_MNEMONIC="the twenty four words from step 2"
```

**4. Find your address and fund it.**

```sh
npm run cli -- wallet address
```

Paste the `addr_test1…` address into the
[Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet),
pick **Preview**, and request tADA. It arrives in a block or two.

```sh
npm run cli -- wallet balance
npm run cli -- wallet utxos
```

**5. Send some ADA.** To a second account of the same mnemonic, which is the
easiest second address to get hold of:

```sh
npm run cli -- wallet address --account 1
npm run cli -- send-ada --to addr_test1... --amount 5
```

**6. Create a policy and mint.** Keep the policy file: the native script
cannot be recovered from the policy id, and without it the policy can never
mint or burn again.

```sh
npm run cli -- policy new --lock-seconds 86400 --out policy.json
npm run cli -- mint --policy policy.json --name CARDAFIN --quantity 1000 \
  --cip25-name "Cardafin" --cip25-description "Preview smoke test"
```

**7. Send the tokens.** The unit is the 56-character policy id followed by
the asset name in hex — `wallet balance --json` prints it for you.

```sh
npm run cli -- wallet balance --json
npm run cli -- send-tokens --to addr_test1... --asset <policyId><nameHex>=400
```

cardafin funds the recipient's min-ADA itself, so a token send takes one
number, not two.

## Not yet smoke-tested

The lucid adapter has **not** been run against Preview in this build. It was
written against the exact pinned `.d.ts` files of
`@lucid-evolution/lucid@0.8.9` and `@blockfrost/blockfrost-js@6.2.0` rather
than from memory, and `translate.ts`/`mappers.ts` are tested offline, but no
transaction has been submitted. On a first real run, watch for:

- **Address agreement.** `LucidExecutor` refuses to submit unless
  `lucid.wallet().address()` equals the plan's `from`, which `LucidKeys`
  derived with `walletFromSeed`. Both use `addressType: "Base"` and the same
  `accountIndex`, but they are two different lucid entry points — if they
  disagree, that guard fires with "plan was built for a different wallet"
  and nothing is sent. That is the check working, not the bug.
- **Blockfrost network mismatch.** A Preprod key against Preview gives a 403
  wrapped as `PROVIDER_ERROR`. Check the project's network first.
- **Fee and min-ADA estimates.** Core's numbers are deliberately rounded up;
  the receipt's `fee` is the node's exact value read off the built
  transaction body. A large gap between the previewed estimate and the
  charged fee is interesting but not an error.
- **The mint validity window.** `planMint` sets `validTo` to
  `min(lockBeforeSlot - 1, currentSlot + 7200)`. If the node rejects a mint
  as outside its validity interval, the slot/time mapping is the thing to
  look at — `validTo` is a POSIX millisecond value derived from a slot via
  `lucid.slotToUnixTime`.
- **CIP-25 display.** Metadata under label 721 uses CIP-25 **version 2**
  (asset keyed by hex name, `version: 2`). If a wallet shows the token
  without its name or image, that is where to look.
- **`awaitTx`.** Not called by any CLI command; the receipt carries a
  Cardanoscan link instead. Nothing waits for a confirmation yet.

## Test

`npm test` runs `node --experimental-strip-types --test 'src/**/*.test.ts'
'web/**/*.test.mjs'` directly against the sources, with Node's built-in type
stripping and built-in test runner (`node:test` + `node:assert/strict`). It
needs no `node_modules`, no network access and no key: `src/core`,
`src/ports`, `src/services`, `src/capabilities`, `src/fixtures` and
`src/adapters/memory` all import nothing but relative files and `node:`
builtins, which `src/core/purity.test.ts` enforces by grepping them. See
`docs/ARCHITECTURE.md` §1 for why.

The browser code is in the same suite. `web/*.test.mjs` drives the CIP-30
login flow against a fake wallet and the dev console against a minimal fake
DOM — so the half of wallet login that runs in the browser is covered by the
same command, not by clicking.

The service tests are end-to-end against `MemoryLedger` and `MemoryKeys` —
real planning, fees, min-ADA, time-locked policies, minting and change, with
imaginary money. `adapters/lucid` is the one directory exempt from the purity
rule, and no test file imports lucid or blockfrost even transitively: its two
pure modules (`translate.ts`, `mappers.ts`) carry that directory's tests, and
`src/cli/args.ts` is pure for the same reason. `src/app.ts` and `src/cli.ts`
are the only modules that pull in the real adapters, and nothing in the test
suite imports either.

`npm run typecheck` runs `tsc`, which does need `npm install` first (it is a
devDependency, not part of the Node runtime).

```sh
npm test               # no install needed
npm run console:probe  # no install needed
npm install
npm run typecheck
npm run check          # typecheck + test
```

`npm run console:probe` starts the dev server in-process, exercises every
static page, every console endpoint and every route each capability
registered, prints the result as a table and exits non-zero if anything
answers unexpectedly. A `501` is expected and shown as `todo` — that is a
module not yet written, not a failure.

## Env vars

| Var | Meaning |
|---|---|
| `CARDAFIN_NETWORK` | `Preview` \| `Preprod` \| `Mainnet`. Default `Preview`. Mainnet is real money. |
| `BLOCKFROST_PROJECT_ID` | Blockfrost project id; must match the network above. |
| `CARDAFIN_MNEMONIC` | 24-word master mnemonic. v1 key custody is this env var on the host — see Security below. |
| `CARDAFIN_MAINNET_CONFIRM` | Must equal `I_UNDERSTAND_REAL_FUNDS` when `CARDAFIN_NETWORK=Mainnet`, else startup is refused. |
| `CARDAFIN_HTTP_PORT` | Port for the HTTP surface (see "HTTP API" above). Default `8787`. |
| `CARDAFIN_API_KEYS` | Comma-separated bearer tokens accepted by the HTTP surface. |

## Security

- No secrets are committed to git: `.env` is gitignored (`.env.example` is
  the only tracked env file) and `AGENTS.md` / `CLAUDE.md` / `.claude/` are
  also gitignored.
- **Key custody in v1 is a single master mnemonic in an env var on the
  host** (`CARDAFIN_MNEMONIC`), read once by `loadConfig` and held in memory.
  Nothing is persisted: there is no wallet store, no database and no key
  file. Per-client separation is by CIP-1852 account index — one account per
  client, so a leaked account is one client's blast radius rather than
  everyone's, and a client can leave with their derivation path.

  That is good enough for a single-operator testnet service. It is **not**
  good enough for meaningful mainnet funds: anything that can read the
  process environment can move every account's money. The upgrade path is
  the port boundary — swap the implementation behind `KeyPort` for a
  KMS/HSM-backed signer, which changes one adapter and nothing in `services`
  or `core`. `LucidKeys` is the only file in the repo that touches signing
  material, and `SignerRef` (`{ mnemonic, accountIndex }`) is the only shape
  that crosses the port. See `docs/ARCHITECTURE.md` §6.
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
core + ports into wallet and transaction use-cases; `app.ts` is the single
composition root; `cli.ts` and `http/` (step 8, see "HTTP API" above) are
thin surfaces over services, with `cli/args.ts` keeping argument parsing
pure and tested. See `docs/ARCHITECTURE.md` for the full, binding spec.

## License

Apache License 2.0 — see `LICENSE` and `NOTICE`.

Apache rather than MIT for the patent grant in §3. This repo hand-writes
cryptography and implements CIP standards, and an explicit, irrevocable patent
licence makes that a smaller question for anyone building on it. §5 also means
contributions arrive under the same terms without a separate CLA.
