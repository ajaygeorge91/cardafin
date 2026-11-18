# identity

CIP-8 / COSE_Sign1 verification: the server half of browser wallet login.

A CIP-30 wallet's `api.signData(rewardAddress, payload)` returns a `DataSignature` — a
COSE_Sign1 and a COSE_Key, both hex CBOR. This module turns that into a `VerifiedIdentity`,
or into a specific error. It implements `ports/identity.ts`, which `sessions` depends on and
nothing else does.

Pure and deterministic throughout: no network, no key, no npm.

## Scope

1. **A CBOR decoder** (`core/cbor.ts`) — the COSE subset only: unsigned ints, byte strings,
   text strings, arrays, maps, and the negative-int keys COSE headers use. Not a general
   decoder; reject anything outside the subset rather than guessing.
2. **BLAKE2b** (`core/blake2b.ts`) — `node:crypto` exposes `blake2b512` and nothing else, but
   Cardano hashes keys to **224 bits**. Hand-written, against the vectors in
   `src/fixtures/vectors.ts`.
3. **Ed25519 verification** — via `node:crypto.verify`, wrapping the raw 32-byte key from the
   COSE_Key as SPKI DER. No dependency.
4. **`verify()`** — decode COSE_Sign1, rebuild the `Sig_structure`, verify the signature,
   hash the public key and check it against the `address` in the protected header, then
   consume the challenge.
5. **The challenge lifecycle** behind `ports/challenges.ts` — issue, single-use consume, sweep.

## The routes

Both are registered and answer 501 today.

**`POST /v1/identity/challenge`** → `{ nonce, domain, network, purpose, expiresAt, message }`.

`message` is required. The browser signs that string verbatim — see `web/login.mjs` — so
whatever goes in it is what comes back to be verified. Compose it here and keep it with the
nonce; if the browser built its own, the server would have to recompose it byte-identically,
and the first drift in field order or line endings fails every login. Make it readable, since
a person sees it in their wallet, and put the domain, network, purpose and nonce in it.

**`POST /v1/identity/verify`** — body `{ nonce, signature: { signature, key } }`, the
`DataSignature` exactly as CIP-30 returned it. Returns a `VerifiedIdentity` or a specific
error. The browser half already sends this shape.

Replace the two `notBuilt(...)` handlers in `capability.ts`; move them into a `routes.ts` once
there is a service to wire.

## Two things that must be true, and must have tests

- **Replay is closed.** The same signature presented twice succeeds once. `consume` removes
  the nonce in the same step it returns it.
- **Cross-network replay is closed.** CIP-8 warns about it by name: a signature produced
  against a Preprod challenge must not verify on Mainnet. The network is in the challenge.

## Traps

- CIP-30 does **not** hash the payload and uses no `external_aad`. The bytes are signed as
  they are — do not add a hash step that the wallet did not take.
- Wallets bind to the **stake (reward)** address in the protected header. An `address` header
  in any other format is a verification failure, not a fallback to a payment address.
- The public key arrives in the COSE_**Key**, not inside the COSE_Sign1. Two separate CBOR
  blobs, both of which must be parsed.
- A COSE test vector is generated from an Ed25519 **private key**. Do not commit it. Fixtures
  hold `{ payload, publicKey, signature, expectedAddress }` and nothing else.

## Negative cases

tampered payload · wrong address in the header · unknown nonce · reused nonce · expired
challenge · wrong network · wrong domain · malformed CBOR · a COSE_Key with the wrong curve.

## Done when

`npm run check` passes with the tests you add under
`src/capabilities/identity/`, and `npm run console:probe` shows every `identity`
route answering 200 instead of 501.

To watch it work: `npm run console` and the **identity** panel at
http://localhost:8787/console.


See `../README.md` for the rules every module keeps.
