# cardafin architecture

Status: v1 design, 2026-11-07. Supersedes the product framing in
`OPUS-ANALYSIS.md` and `FABLE-ANALYSIS.md` (July 2026, "blockchain as a
database for listings"). cardafin is now a **Cardano wallet manager**: a
service layer exposing wallet create/restore, address derivation, balance and
UTxO queries, sending ADA, creating native-token policies, minting, and
sending tokens. Hydra, stablecoins (USDM, not USDT), a web UI and a database
are deliberately out of scope for v1 but the shapes below leave room for them.

Lifted unchanged from the July docs: canonical JSON + sha256, UTF-8-safe
64-byte metadatum chunking, min-ADA lockup as the dominant mainnet cost,
per-client key derivation from one master seed, "Hydra is a state channel, not
storage", and "the fiat-backed stablecoin on Cardano is USDM — name it honestly".

## 1. The one rule: core is pure

```
src/
  core/        pure domain logic. ZERO npm imports. ZERO lucid. Node builtins
               (node:crypto for sha256, node:buffer) are allowed, nothing else.
  ports/       TypeScript interfaces for everything that touches a key or the
               network. Core types only.
  adapters/
    memory/    in-memory implementations of every port. Deterministic. Used by
               every test.
    lucid/     the real thing: @lucid-evolution/lucid + Blockfrost. The ONLY
               directory allowed to import lucid or blockfrost-js.
  services/    wallet + tx use-cases. Depend on core + ports. Never on adapters.
  http/        thin node:http surface over services (step 8). No framework.
  config.ts    env → typed Config. Network selection, mainnet opt-in.
  cli.ts       manual smoke-test CLI (wallet/balance/send/mint) for Preview.
```

Dependency direction: `http → services → ports ← adapters`, and everything may
use `core`. A lint-ish test (`src/core/purity.test.ts`) greps `src/core` and
`src/ports` for `from "@` / `from "lucid` and fails if any appear.

Why: this repo is used for coding-evaluation tasks in a sandbox with no
network and an unreliable npm mirror. `npm test` must run from a clean clone
with **no node_modules** and must never need a key, a node, or Blockfrost.

## 2. Toolchain (decided)

- Node ≥ 22.12. Tests run with `node --experimental-strip-types --test
  'src/**/*.test.ts'` — no test framework, no tsx, no vitest. Imports inside
  `src/` therefore use explicit `.ts` extensions.
- TypeScript (devDependency only) for `npm run typecheck`. `tsconfig.json` is
  self-contained: never `extends` anything. `strict`, `module: NodeNext`,
  `allowImportingTsExtensions`, `noEmit`, `erasableSyntaxOnly`,
  `verbatimModuleSyntax` (no enums, no parameter properties, `import type`).
- Env loading via Node's native `--env-file=.env`. No dotenv.
- Runtime deps: `@lucid-evolution/lucid@0.8.9` (tx building, key derivation)
  and `@blockfrost/blockfrost-js@6.2.0` (reads: tip, protocol params, tx
  await). Nothing else. Adding a dep requires a sentence in the PR on why
  core can't do it.
- HTTP: `node:http`. No express.

## 3. Core modules and their contracts

All amounts are `bigint` lovelace internally. Strings at the API boundary.

### `core/result.ts`
```ts
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = CardafinError> = Ok<T> | Err<E>;
export const ok, err;  // constructors
```

### `core/errors.ts`
```ts
export type ErrorCode =
  | "INVALID_ADDRESS" | "WRONG_NETWORK" | "INVALID_AMOUNT" | "INVALID_ASSET_NAME"
  | "INVALID_POLICY_ID" | "INVALID_UNIT" | "INVALID_METADATA" | "INSUFFICIENT_FUNDS"
  | "BELOW_MIN_ADA" | "MAINNET_NOT_CONFIRMED" | "NOT_IMPLEMENTED" | "PROVIDER_ERROR"
  | "INVALID_REQUEST";
export class CardafinError extends Error { code: ErrorCode; details?: unknown }
```

### `core/network.ts`
```ts
export type Network = "Preview" | "Preprod" | "Mainnet";
export const NETWORKS: readonly Network[];
export function parseNetwork(s: string): Result<Network>;
export function networkId(n: Network): 0 | 1;          // 0 testnets, 1 mainnet
export function addressPrefix(n: Network): "addr_test" | "addr";
export function blockfrostUrl(n: Network): string;      // https://cardano-<lower>.blockfrost.io/api/v0
export function explorerTxUrl(n: Network, txHash: string): string; // cardanoscan / preview.cardanoscan etc.
```

### `core/ada.ts`
```ts
export type Lovelace = bigint;
export const LOVELACE_PER_ADA = 1_000_000n;
export function parseLovelace(input: string | number | bigint): Result<Lovelace>; // integer ≥ 0, no floats
export function adaToLovelace(ada: string): Result<Lovelace>; // "1.5" → 1_500_000n; >6 decimals → INVALID_AMOUNT
export function lovelaceToAda(l: Lovelace): string;            // "1.500000" trimmed to "1.5"; never floating point math
export function formatAda(l: Lovelace): string;                // "1.5 ADA"
```

### `core/assets.ts`
```ts
export type Unit = string;                 // "lovelace" | policyId(56 hex) + assetNameHex(0–64 hex)
export type Assets = Record<Unit, bigint>;
export const LOVELACE: Unit = "lovelace";
export const MAX_ASSET_NAME_BYTES = 32;
export function isHex(s: string): boolean;
export function validatePolicyId(s: string): Result<string>;        // exactly 56 lowercase hex
export function assetNameToHex(name: string): Result<string>;      // UTF-8 bytes ≤ 32, else INVALID_ASSET_NAME
export function hexToAssetName(hex: string): string;               // lossy on non-UTF-8, used for display
export function toUnit(policyId: string, assetNameHex: string): Result<Unit>;
export function fromUnit(unit: Unit): Result<{ policyId: string; assetNameHex: string; assetName: string }>;
export function addAssets(a: Assets, b: Assets): Assets;
export function subtractAssets(a: Assets, b: Assets): Result<Assets>; // INSUFFICIENT_FUNDS if any goes negative; drops zero entries
export function sumUtxoAssets(utxos: readonly Utxo[]): Assets;
export function parseAssets(input: Record<string, string | number | bigint>): Result<Assets>; // validates each unit + positive qty
```

### `core/address.ts`
Bech32 (BIP-173) decoder implemented here — small, no dependency.
```ts
export type AddressInfo = {
  bech32: string; networkId: 0 | 1; headerType: number;
  kind: "base" | "enterprise" | "pointer" | "reward" | "script-base" | ...;
  paymentCredentialHex?: string; // 28-byte hash when type has a payment part
};
export function decodeBech32(s: string): Result<{ hrp: string; data: Uint8Array }>;
export function parseAddress(s: string): Result<AddressInfo>;
export function validateAddress(s: string, network: Network): Result<AddressInfo>;
   // WRONG_NETWORK when hrp/network-byte disagree with `network`;
   // reward addresses (stake1…) are INVALID_ADDRESS for payments;
   // Byron (base58) → INVALID_ADDRESS "Byron addresses are not supported in v1".
```

### `core/metadata.ts`
```ts
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Metadatum = string | bigint | Metadatum[] | { [k: string]: Metadatum };
export const METADATUM_MAX_BYTES = 64;
export function canonicalJson(v: Json): Result<string>;    // keys sorted recursively, no whitespace, reject NaN/Infinity/undefined
export function sha256Hex(bytes: string | Uint8Array): string;  // node:crypto
export function chunkUtf8(s: string, maxBytes = 64): string[]; // never splits a code point; each chunk ≤ maxBytes
export function toMetadatum(v: Json): Result<Metadatum>;   // long strings → chunk arrays; non-integer numbers → INVALID_METADATA; keys > 64 bytes → INVALID_METADATA
export function cip25Metadata(policyId, assetNameHex, fields: {name: string; image?: string; description?: string; [k: string]: Json}): Result<Metadatum>; // label 721 shape, version 1
export const METADATA_LABEL_CIP25 = 721;
```

### `core/fees.ts`
Estimates only — the adapter computes exact values when building. Tests pin
the estimates to known ranges (ADA-only output ≈ 0.97–1.0 ADA; one-token
output ≈ 1.1–1.5 ADA; simple tx fee ≈ 0.17–0.2 ADA).
```ts
export type ProtocolParams = { minFeeA: number; minFeeB: number; coinsPerUtxoByte: number; maxTxSize: number; maxValSize: number };
export const CONWAY_DEFAULT_PARAMS: ProtocolParams; // 44, 155381, 4310, 16384, 5000
export function estimateOutputBytes(address: AddressInfo | "base", assets: Assets): number;
export function estimateMinAda(assets: Assets, params?: ProtocolParams): Lovelace; // coinsPerUtxoByte * (160 + outputBytes)
export function estimateFee(txSizeBytes: number, params?: ProtocolParams): Lovelace; // minFeeA*size + minFeeB
export function estimateSimpleTxBytes(nOutputs: number, nInputs?: number, hasMint?: boolean, metadataBytes?: number): number;
```

### `core/native-script.ts`
```ts
export type NativeScript =
  | { type: "sig"; keyHash: string }
  | { type: "before"; slot: number }
  | { type: "after"; slot: number }
  | { type: "all" | "any"; scripts: NativeScript[] }
  | { type: "atLeast"; required: number; scripts: NativeScript[] };
export function sigAndBeforePolicy(keyHash: string, beforeSlot: number): NativeScript; // {all:[sig, before]}
export function policyIsOpenAt(script: NativeScript, slot: number): boolean;           // evaluates time locks only
export function validateNativeScript(s: unknown): Result<NativeScript>;
```
Policy **id** (blake2b-224 of script CBOR) is NOT computed in core — it comes
through the `KeyPort` (lucid does it; the fake hashes deterministically).

### `core/requests.ts` — the client contract
All requests carry `hydra?: boolean` (default false). Validation returns a
fully typed, bigint-normalised request or a `CardafinError`.
```ts
export type SendAdaRequest    = { to: string; amount: string /* ADA, "1.5" */ | { lovelace: string }; hydra?: boolean; metadata?: Json };
export type CreatePolicyRequest = { lockBeforeSlot?: number; lockInSeconds?: number }; // one of; default lockInSeconds = 365 days
export type MintTokenRequest  = { policyId: string; assetName: string; quantity: string; to?: string; cip25?: { name: string; image?: string; description?: string }; hydra?: boolean };
export type SendTokensRequest = { to: string; assets: Record<Unit, string>; hydra?: boolean };
export function validateSendAda(input: unknown, network: Network): Result<ValidSendAda>;
export function validateMint(input: unknown, network: Network): Result<ValidMint>;
export function validateSendTokens(input: unknown, network: Network): Result<ValidSendTokens>;
export function validateCreatePolicy(input: unknown): Result<ValidCreatePolicy>;
```

### `core/plan.ts` — the pure write path
A **TxPlan** is a network-free description of what a transaction must do.
Services build plans from validated requests + wallet state; executors
(memory / lucid / later hydra) turn plans into transactions. This is what lets
`hydra: true` route differently without changing the client contract.
```ts
export type TxOutput = { address: string; assets: Assets };
export type TxPlan = {
  kind: "send-ada" | "mint" | "send-tokens";
  network: Network;
  route: "l1" | "hydra";
  from: string;                                  // wallet payment address
  outputs: TxOutput[];
  mint?: { script: NativeScript; policyId: string; assets: Assets }; // negative qty = burn
  validToSlot?: number;                          // required when mint has a `before`
  metadata?: Array<{ label: number; value: Metadatum }>;
};
export function planSendAda(req: ValidSendAda, ctx: PlanContext): Result<TxPlan>;
export function planMint(req: ValidMint, policy: PolicyInfo, ctx: PlanContext): Result<TxPlan>;
export function planSendTokens(req: ValidSendTokens, ctx: PlanContext): Result<TxPlan>;
export type PlanContext = { network: Network; from: string; available: Assets; currentSlot: number; params: ProtocolParams };
export function checkFunds(plan: TxPlan, available: Assets, params): Result<{ estimatedFee: Lovelace; minAdaPerOutput: Lovelace[] }>;
export function describePlan(plan: TxPlan): string; // human line for logging; never includes keys
```
Plan rules enforced in core: every output's lovelace ≥ estimated min-ADA
(else BELOW_MIN_ADA with the number needed); mint plans put the minted assets
in an output to `req.to ?? from`; `validToSlot` must be < the policy's
`before` slot and > currentSlot; funds check includes an estimated fee.

## 4. Ports (`src/ports/`)

```ts
// ports/chain.ts
export interface ChainReader {
  readonly network: Network;
  getUtxos(address: string): Promise<Utxo[]>;
  getBalance(address: string): Promise<Assets>;       // default impl = sumUtxoAssets(getUtxos)
  getCurrentSlot(): Promise<number>;
  getProtocolParams(): Promise<ProtocolParams>;
  awaitTx(txHash: string, timeoutMs?: number): Promise<boolean>;
}
export type Utxo = { txHash: string; outputIndex: number; address: string; assets: Assets };

// ports/keys.ts
export interface KeyPort {
  generateMnemonic(): string;                                     // 24 words
  validateMnemonic(m: string): boolean;
  deriveWallet(mnemonic: string, accountIndex: number, network: Network): Promise<WalletInfo>;
  nativeScriptPolicyId(script: NativeScript): string;            // blake2b-224(cbor) in lucid; sha256-derived 56-hex in the fake
}
export type WalletInfo = { address: string; paymentKeyHash: string; accountIndex: number; network: Network };

// ports/executor.ts
export interface TxExecutor {
  readonly route: "l1" | "hydra";
  execute(plan: TxPlan, signer: SignerRef): Promise<TxReceipt>;
}
export type SignerRef = { mnemonic: string; accountIndex: number }; // never logged
export type TxReceipt = { txHash: string; fee: Lovelace; route: "l1" | "hydra"; explorerUrl?: string };
```

`adapters/memory/`:
- `MemoryLedger` implements `ChainReader` + `TxExecutor` (route "l1"). Holds a
  UTxO set keyed by `txHash#index`; `fund(address, assets)` seeds; `setSlot`;
  `execute` validates the plan against the ledger (inputs from `plan.from`,
  min-ADA, time-lock vs slot, policy id matches script), consumes inputs,
  creates outputs + change, charges `estimateFee`, returns a deterministic
  sha256-derived txHash. Applies mints to the asset supply. Throws
  `CardafinError` on failure.
- `MemoryKeys` implements `KeyPort`: mnemonic = 24 words from a small fixed
  word list chosen by `crypto.randomBytes`; `deriveWallet` returns a
  **structurally valid** bech32 enterprise address (header type 6, network id
  per network, 28-byte hash = sha256(mnemonic|account)[0..28]) so core address
  validation passes. Documented as fake derivation — not CIP-1852.
- `HydraExecutor` (`route: "hydra"`): `execute` throws
  `CardafinError("NOT_IMPLEMENTED", "Hydra routing is designed but not built")`.
- `TxRouter`: `{ l1: TxExecutor; hydra?: TxExecutor }` → picks by `plan.route`.

`adapters/lucid/`:
- `LucidChain` (ChainReader) — `@blockfrost/blockfrost-js` for utxos, tip
  slot, protocol params, awaitTx.
- `LucidKeys` (KeyPort) — `generateSeedPhrase`, `walletFromSeed`/
  `selectWallet.fromSeed(seed, { accountIndex })`, `paymentCredentialOf`,
  `scriptFromNative` + `mintingPolicyToId`.
- `LucidExecutor` (TxExecutor "l1") — builds from a TxPlan: `pay.ToAddress`
  per output, `mintAssets` + `attach.MintingPolicy` when `plan.mint`,
  `validTo(slotToUnixTime)` when `validToSlot`, `attachMetadata` per entry,
  `.complete()` → `.sign.withWallet().complete()` → `.submit()`. Logs
  `describePlan(plan)` **before** submit; never logs the seed or the CBOR.
- Verify every method name against `node_modules/@lucid-evolution/lucid/dist/index.d.ts`
  (and `@lucid-evolution/{core-types,utils,wallet}` types). Do not trust snippets.

## 5. Services (`src/services/`)

```ts
export class WalletService {
  constructor(deps: { keys: KeyPort; chain: ChainReader; config: Config });
  create(): { mnemonic: string };                         // caller stores it; we never persist it
  restore(mnemonic: string, accountIndex = 0): Promise<WalletInfo>;
  address(accountIndex = 0): Promise<WalletInfo>;         // from config.mnemonic
  balance(address: string): Promise<{ assets: Assets; ada: string }>;
  utxos(address: string): Promise<Utxo[]>;
}
export class TxService {
  constructor(deps: { keys: KeyPort; chain: ChainReader; router: TxRouter; config: Config; log: Logger });
  sendAda(input: unknown, accountIndex = 0): Promise<TxReceipt>;
  createPolicy(input: unknown, accountIndex = 0): Promise<PolicyInfo>;   // { policyId, script, lockBeforeSlot, keyHash }
  mint(input: unknown, policy: PolicyInfo, accountIndex = 0): Promise<TxReceipt>;
  sendTokens(input: unknown, accountIndex = 0): Promise<TxReceipt>;
}
```
Each tx method: validate → load wallet + balance + slot + params → plan →
`checkFunds` → `assertMainnetAllowed(config)` → `log.info(describePlan)` →
`router.for(plan.route).execute(plan, signer)`.

Per-client keys: one master mnemonic, `accountIndex` = client index
(CIP-1852 account level). Lifted from the July design: blast radius is one
account; a client can leave with their account's derivation path.

## 6. Config and safety

```
CARDAFIN_NETWORK=Preview            # Preview | Preprod | Mainnet
BLOCKFROST_PROJECT_ID=YOUR_BLOCKFROST_KEY_HERE
CARDAFIN_MNEMONIC="abandon abandon ... art"   # 24 words; v1 key custody = env var, see README
CARDAFIN_MAINNET_CONFIRM=            # must equal I_UNDERSTAND_REAL_FUNDS when network is Mainnet
CARDAFIN_HTTP_PORT=8787
CARDAFIN_API_KEYS=                   # comma-separated bearer tokens for the HTTP surface
```
- `loadConfig(env)` is pure (takes an object) so it is testable; the Blockfrost
  URL is derived from the network, never configured.
- Mainnet requires the confirm token or `loadConfig` fails with
  `MAINNET_NOT_CONFIRMED`. Every executor also re-checks before submit.
- Logger redacts: any string that equals the mnemonic, any 24-word sequence,
  `BLOCKFROST_PROJECT_ID`, and anything under keys named `mnemonic`, `seed`,
  `cbor`, `witness`. Tests cover the redactor.
- Key custody v1: the master mnemonic lives in an env var on the host. This is
  stated plainly in the README as "good enough for a single-operator testnet
  service; replace with a KMS/HSM-backed signer behind `KeyPort` before
  holding meaningful mainnet funds". The port boundary is the upgrade path.

## 7. Test fixtures

- Throwaway mnemonic (public, BIP-39 test vector, has never held funds and
  must never): `abandon abandon abandon abandon abandon abandon abandon
  abandon abandon abandon abandon abandon abandon abandon abandon abandon
  abandon abandon abandon abandon abandon abandon abandon art`. Label it as
  such wherever it appears.
- Known-good addresses for validation tests: generate structurally via the
  core bech32 encoder in tests (round-trip), plus one hard-coded mainnet
  (`addr1…`) and one preview (`addr_test1…`) address copied from public
  Cardano docs/explorers for the "real address parses" case.

## 8. Build order and gates

| Step | Deliverable | Gate |
|---|---|---|
| 1 | skeleton, LICENSE, .gitignore, tsconfig, package.json, README stub, GitHub repo | `npm test` (0 tests ok) + `npm run typecheck` green |
| 2 | `src/core/*` + tests | core tests green with `rm -rf node_modules` |
| 3 | `src/ports/*`, `src/adapters/memory/*`, `src/services/*` + tests | same |
| 4 | `src/adapters/lucid/*`, `src/config.ts` | typecheck green; no tests need network |
| 5 | wallet ops wired in `cli.ts` | smoke on Preview by hand |
| 6 | send ADA | smoke on Preview by hand |
| 7 | policy / mint / send tokens | smoke on Preview by hand |
| 8 | `src/http/*` | tests via `node:http` against memory adapters |

Nothing touches Mainnet in this plan.
