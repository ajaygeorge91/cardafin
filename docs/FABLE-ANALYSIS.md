# Fable analysis — cardafin

My independent response to the vision brief ("database in blockchain as a
service" on Cardano), written 2026-07-31 without inheriting Opus's design.
Same inputs: the vision text, plotmap's charter, current Cardano tooling.

## 1. What cardafin actually is

Strip the blockchain vocabulary and the product is: **a write API and a read
API around Cardano used as a durable, publicly verifiable database, sold as a
service.** The client (plotmap) doesn't want blockchain semantics — they want
cheap permanent publishing where someone else handles keys, fees, and infra.
Every design choice should be scored against three things: cost per record,
cost per **update**, and how easily a third party can reconstruct the whole
database without trusting cardafin.

## 2. The core issue the brief hides: listings are mutable

"Just listings as tokens" sounds like NFT minting, but a real-estate listing
is a *mutable row*: price cuts, status → sold, new photos. Plotmap's own reality
(brokers editing from a phone in a field) guarantees frequent updates. That
makes mutability the primary design axis, not an afterthought:

- **CIP-25** (metadata at mint) is immutable. Updating means burn + re-mint —
  a new transaction, a new fee, *and* stale copies of old data forever
  presented under the same asset unless indexers are careful. A database whose
  rows can't change is the wrong v1 for this client.
- **CIP-68** stores the record in a datum on a reference-token UTxO. The datum
  can be rewritten in place: same asset id, same policy, new state. Costs a
  Plutus script and slightly more min-ADA, but the database semantics are
  correct.
- **Metadata event-log** (no token at all) is the cheapest possible model:
  each write is a transaction whose metadata carries
  `{client, table, id, version, sha256, data}` under one custom label. The
  database = fold of events, latest version wins. Nothing is locked, batching
  is trivial, and reads are one Blockfrost metadata-label query.

**My recommendation: the event-log is the database; the token is the deed.**
v1 writes every record (and every update) to the metadata event-log — that is
the actual "database on blockchain" product, and it's near-free. Minting a
CIP-68 token per listing is a *tier*, offered where a record needs an owner:
transferable, sellable, walletable. This matches the brief ("listings as
tokens") without forcing token economics onto every row update.

## 3. The cost model nobody mentioned: min-ADA lockup

Fees are not the dominant mainnet cost — **min-ADA is**. Every token must sit
in a UTxO carrying ~1.2–1.5 ADA. Token-per-listing at 10,000 listings locks
~12–15k ADA (refundable on burn, but real capital). Mitigations, in order:

1. Event-log records lock nothing (no token, no UTxO kept).
2. Batch mints: many listing tokens into shared UTxOs at the utility address —
   min-ADA grows sub-linearly with assets per UTxO.
3. Price the lockup as a refundable *deposit* per tokenized listing, not a fee.

Per-write fee math: a metadata tx is ~0.17–0.5 ADA; batching N records per tx
amortizes it to pennies. Preview/preprod are free (faucet ADA). "Low cost to no
cost" is achievable — but only the event-log model keeps it true at update time.

## 4. Hydra: it is not storage

Hydra is a state channel. Metadata inside an open head **never settles to L1**;
when a head closes, only the final UTxO set lands on-chain. So "use Hydra for
free storage" is a category error. Where Hydra genuinely fits cardafin:
bulk-update sessions — open a head, apply thousands of CIP-68 datum updates at
zero fee, close, and settle the *final* datums to L1. That's a phase-3 feature
with a real server to run (fly.io can host the hydra-node), not a v1
requirement. Design the write API so a `hydra: true` flag can route writes
later without changing the client contract.

## 5. Key model: per-client keys, not one global utility key

One shared utility key means every client's data hangs off cardafin's identity
and one compromise burns everyone. Instead: one master seed (BIP-39), derive a
**per-client signing key + minting policy**. Two wins:

- Blast-radius: a leaked client key affects one client.
- Exit story: a client can leave with their key and their policy — their data
  AND their on-chain identity are portable. "You can leave whenever you want"
  is the strongest possible pitch for blockchain-DB-as-a-service, and no
  centralized competitor can copy it.

## 6. Stablecoins: USDT is not on Cardano

The brief says "transfer usd like usdt to cardano." As of mid-2026, USDT/USDC
are not natively issued on Cardano; the fiat-backed native option is **USDM**
(plus USDA, DJED, iUSD synthetics), and bridging USDC/USDT→USDM is still
proposal-stage. So the deliverable is "send USD-pegged value on Cardano" =
USDM transfers via the same wallet service — a simple `pay.ToAddress` with a
USDM asset unit. Rename the feature accordingly; don't promise USDT.

## 7. Reads are first-class, not an afterthought

"The whole database available, preview and mainnet" is an indexer requirement:

- `GET /v1/db` — reconstruct all records for a client (Blockfrost: assets by
  policy for tokens; metadata-by-label + fold for the event-log), with
  `?network=preview|mainnet`.
- `GET /v1/records/:id` — latest state + full version history + tx proofs.
- The website is just a UI over this read API — deployable to fly.io alongside.

Caching matters: Blockfrost free tier is rate-limited; the service should keep
a local index (SQLite is fine) rebuilt from chain on boot. The chain is the
database of record; the index is disposable.

## 8. What I'd build first (same thin-slice instinct, different slice)

1. `POST /v1/records` — API key + JSON → **event-log write on Preview**
   (batchable), returns tx hash + sha256 + explorer link.
2. `GET /v1/db` — fold the log, return the whole database. *Write+read together
   prove "database", not just "mint".*
3. `POST /v1/records/:id/tokenize` — optional CIP-68 mint for ownership tier.
4. Then: mainnet flag, USDM transfer endpoint, per-client key derivation,
   website, Hydra bulk sessions.

Stack: TypeScript/Node + `@lucid-evolution/lucid` + Blockfrost + fly.io — same
conclusion as Opus; the tooling argument is decisive.

## 9. Where I differ from Opus (honest diff)

| Axis | Opus | Fable |
|---|---|---|
| Primary model | CIP-25 token per record; full JSON in custom label 1667; CIP-68 "later" | Metadata **event-log** is the database; **CIP-68** token as optional ownership tier; CIP-25-only rejected because listings mutate |
| Thin slice | Mint one record as a token | Write **and read back the whole DB** (fold of the log) |
| Cost analysis | Tx-size cap (12 KB/record) | Adds **min-ADA lockup** as the dominant mainnet cost + batching/deposit answer |
| Updates | Not addressed in v1 | The central design axis; versioned events, latest-wins |
| Hydra | Deferred, unexamined | Pre-empted: not storage; bulk-update sessions only |
| Keys | One global utility key | Per-client derivation from master seed; client-exit story |
| Stablecoin leg | Not yet examined | USDT isn't on Cardano; target USDM, name it honestly |

What I'd keep from Opus unchanged: stack choice, canonical-JSON + sha256
integrity hashing, UTF-8-safe 64-byte chunking, network switching via env,
the API-key header contract, and the refusal to over-build before one slice
works. `src/listing.ts` survives almost intact — it just gains a `version`
field and loses the assumption that every record mints a token.
