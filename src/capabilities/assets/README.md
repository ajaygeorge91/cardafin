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

`npm run check` passes with the tests you add under
`src/capabilities/assets/`, and `npm run console:probe` shows every `assets`
route answering 200 instead of 501.

To watch it work: `npm run console` and the **assets** panel at
http://localhost:8787/console.


See `../README.md` for the rules every module keeps.
