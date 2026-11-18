# assets

Policies, native tokens and NFTs: CIP-14 fingerprints, CIP-25 metadata, CIP-68 shaping.

Builds on what step 7 already landed (native-script policy, mint, send tokens) rather than
replacing it, and gives policies a durable home behind `ports/policies.ts`.

## Scope

1. **Policy composition** — `sig`, `before` (the time-lock that makes an NFT permanently
   uncounterfeitable), `all` / `any` / `atLeast` for multisig. The shapes are in
   `core/native-script.ts`; what is missing is composition and the expiry-slot arithmetic
   against a real tip.
2. **CIP-14 asset fingerprints** — bech32 over blake2b-160. The eight published vectors are
   in `src/fixtures/vectors.ts` and all eight must pass.
3. **CIP-25 vs CIP-68** — CIP-25 metadata already works with 64-byte chunking. Add CIP-68
   label prefixes (`000643b0` reference, `000de140` NFT, `0014df10` FT) and the datum shape.
4. **`PolicyStore`** — retires the process-lifetime `Map` in `http/router.ts`. A policy's
   script *is* its recovery key: lose it and you can never mint under that policy again, even
   though the tokens live on chain forever.

## The boundary to scope explicitly

Minting a CIP-68 reference/user token pair works under a **native script**. *Updating* the
reference datum afterwards needs a **Plutus validator** to hold the reference token. Decide
per use case and say so in the plan: if the NFT never changes, CIP-25 under a time-locked
policy is less machinery and cheaper. Do not build the Plutus half here.

## Cost, which belongs in the plan output

Fees are not the dominant mainnet cost — **min-ADA lockup** is. Every token sits in a UTxO
that must hold roughly 1–1.5 ADA permanently. A mint plan that does not surface that number
is hiding the real price.

## Done when

All three pass from a clean clone with no `node_modules`, no network, no key and no
Blockfrost project id:

```
node --test --experimental-strip-types 'src/capabilities/assets/*.test.ts'
npm run check
node scripts/freeze-ports.mjs --check
```

Then, to see it: `npm run console` and open the **assets** panel at
http://localhost:8787/console — or, if you have no browser, `npm run console:probe`, which
exercises every route this capability registered and prints what each one answered. A route
that still says `todo 501` is a route you have not written yet.

## Rules this capability keeps

- **Pure**: `requests.ts` and `plan.ts` import nothing but `../../core` and `../../ports`.
  No npm, no lucid, no network, no clock of their own.
- **Isolated**: never imports another capability. Cross-module traffic goes through a port.
  `src/capabilities/isolation.test.ts` enforces it.
- **Closed shape**: unknown request fields are rejected, not ignored.
- **Ports are frozen**: if you need to change `src/ports/*.ts`, that is a deliberate act —
  `node scripts/freeze-ports.mjs` and the manifest diff says which contract moved. Four other
  modules depend on them.
- **Fixtures are obviously fake**: `example.com`, placeholder words, never a value shaped like
  a real key. Never a real address, mnemonic or project id, in code, fixtures or comments.
