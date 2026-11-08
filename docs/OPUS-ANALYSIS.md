# Opus analysis snapshot — cardafin

Saved 2026-07-31 when the session switched from `claude-opus-4-8` to `claude-fable-5`.
This captures everything Opus had decided, found, and built before the switch.

## 1. Context gathered

- `~/projects/cardafin` is empty — greenfield.
- Read plotmap's `AGENTS.md` / `README.md`: real-estate OS for independent brokers,
  Scala 3 backend + Scala.js frontend on fly.io, $10/listing revenue model, Kerala
  broker persona, and the charter already names "tokenized on-chain listings" as
  long-term vision. cardafin = the service that delivers that.

## 2. Decisions elicited from Ajay (AskUserQuestion)

| Question | Answer |
|---|---|
| Stack | **TypeScript / Node** (best Cardano tooling: Lucid Evolution, Blockfrost) |
| First deliverable | **Working thin slice** — API key + JSON → real token on Preview testnet |
| On-chain model | **Claude recommends** (research CIP-25 vs CIP-68, propose cheapest durable option) |

## 3. Research findings (verified against live docs)

- Package: `@lucid-evolution/lucid`, latest **0.6.0**; project moved from
  Anastasia-Labs to no-witness-labs, same package name.
- Init pattern:
  ```ts
  import { Lucid, Blockfrost } from "@lucid-evolution/lucid";
  const lucid = await Lucid(
    new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", key),
    "Preview");
  lucid.selectWallet.fromPrivateKey(bech32Ed25519Sk);
  ```
- Mint chain (native script policy — no smart contract needed):
  `scriptFromNative({type:"all", scripts:[{type:"sig",keyHash},{type:"before",slot}]})`
  → `mintingPolicyToId` → `newTx().mintAssets({[toUnit(policyId, assetNameHex)]: 1n})`
  → `.pay.ToAddress(...)` → `.validTo(...)` → `.attach.MintingPolicy(...)`
  → `.complete()` → `.sign.withWallet().complete()` → `.submit()`.
- CIP-25 = metadata label 721 at mint time, immutable, no contract, universally
  indexed. CIP-68 = datum on a reference-token UTxO, updatable, requires a Plutus
  script and datum min-ADA.
- **Unverified at time of switch**: exact TxBuilder method name for attaching
  metadata (`attachMetadata(label, json)` assumed). Ground truth identified:
  `https://unpkg.com/browse/@lucid-evolution/lucid@<ver>/dist/index.d.ts` —
  next step was reading that file.

## 4. Opus's chosen on-chain model (v1)

One **native token per record** (CIP-25 style), minted under a native-script
policy signed by the utility key:

- **Label 721** — clean display record (name/image/description + scalar
  passthrough fields) so wallets and explorers render listings nicely.
- **Custom label 1667** — the FULL canonical JSON of the record: keys sorted
  recursively, every string chunked to ≤64 bytes (metadatum limit), plus
  `sha256` of the canonical bytes for integrity verification.
- Record cap ~12 KB (tx size budget). Oversized → reject with guidance to keep
  media off-chain.
- Asset name = client `id` (≤32 bytes, else head + 8-char hash suffix).
- CIP-68 positioned as a **later upgrade path** for updatable listings.

## 5. Repo state at switch (cloud container `~/cardafin`)

Written and complete:
- `package.json` (deps: lucid-evolution 0.6, express, zod, dotenv; tsx/tsc)
- `tsconfig.json`, `.gitignore`, `.dockerignore`, `.env.example`
- `src/config.ts` — env loading, network switch (preview/preprod/mainnet),
  Blockfrost URLs, API-key list, explorer links
- `src/cardano.ts` — cached Lucid singleton, utility wallet address/balance
- `src/listing.ts` — canonical JSON, sha256, UTF-8-safe 64-byte chunking,
  asset-name derivation, CIP-25 + full-record metadata shaping

Not yet written: `src/mint.ts`, `src/index.ts` (Express API), `scripts/gen-key.ts`,
`scripts/mint-example.ts`, README, Dockerfile, `fly.toml`.

## 6. Environment constraints discovered

- The cloud container has **no package-registry / general network access**
  (npm, pip, GitHub raw all blocked) — only WebSearch/WebFetch. So nothing can
  be installed or executed here; the deliverable is a repo Ajay builds locally.
- Doc pages came through the fetcher with mangled multi-line code blocks;
  unpkg `.d.ts` files are the reliable API source.

## 7. Task list at switch

1. ✅ Research tooling & data model
2. 🔄 Scaffold TypeScript repo (config/cardano/listing done, server pending)
3. ⏳ Build mint API (API key + JSON → token on Preview)
4. ⏳ Verify end-to-end + document (README, fly.io deploy, next milestones:
   wallet service, Hydra, USD/stablecoin, website, mainnet)
