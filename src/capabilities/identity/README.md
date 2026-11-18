# identity

CIP-8 / COSE_Sign1 verification: the server half of browser wallet login.

A CIP-30 wallet's `api.signData(rewardAddress, payload)` returns a `DataSignature` — a
COSE_Sign1 and a COSE_Key, both hex CBOR. This module turns that into a `VerifiedIdentity`,
or into a specific error. It implements `ports/identity.ts`, which `sessions` depends on and
nothing else does.

Everything here is pure and deterministic. No network, no key, no npm — which is unusual for
cryptographic code and is the reason this module is worth doing properly.

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

## The routes you are filling in

Both are registered already and answer 501 today; `npm run console:probe` shows them as `todo`.

**`POST /v1/identity/challenge`** → `{ nonce, domain, network, purpose, expiresAt, message }`.

`message` is not optional and not decoration. **The browser signs that string verbatim** — see
`web/login.mjs`, which is written and tested — so whatever you put in it is what comes back to
be verified. Compose it once, here, and keep it with the nonce. Do not let the browser build
its own: the server would then have to recompose it byte-identically to verify (same field
order, same separators, same line endings, same unicode), and the first drift turns every
login into "invalid signature" with nothing to debug. Make it readable — a person sees it in
their wallet — and put the domain, the network, the purpose and the nonce in it.

**`POST /v1/identity/verify`** — body `{ nonce, signature: { signature, key } }`, the
`DataSignature` exactly as CIP-30 returned it. Returns a `VerifiedIdentity` or a specific
error. The browser half already sends this shape.

Wire both in `src/capabilities/identity/routes.ts` by replacing the two `notBuilt(...)`
handlers. When the last one is gone, so is the `notBuilt` import.

## The two things that must be true, and must have tests

- **Replay is closed.** The same signature presented twice succeeds once. `consume` removes
  the nonce in the same step it returns it.
- **Cross-network replay is closed.** CIP-8 warns about it by name: a signature produced
  against a Preprod challenge must not verify on Mainnet. The network is in the challenge.

## Traps worth knowing before you start

- CIP-30 does **not** hash the payload and uses no `external_aad`. The bytes are signed as
  they are — do not add a hash step that the wallet did not take.
- Wallets bind to the **stake (reward)** address in the protected header. An `address` header
  in any other format is a verification failure, not a fallback to a payment address.
- The public key arrives in the COSE_**Key**, not inside the COSE_Sign1. Two separate CBOR
  blobs, both of which must be parsed.
- A COSE test vector is generated from an Ed25519 **private key**. Do not commit it. Fixtures
  hold `{ payload, publicKey, signature, expectedAddress }` and nothing else.

## Negative cases the suite must cover

tampered payload · wrong address in the header · unknown nonce · reused nonce · expired
challenge · wrong network · wrong domain · malformed CBOR · a COSE_Key with the wrong curve.

## Done when

All three pass from a clean clone with no `node_modules`, no network, no key and no
Blockfrost project id:

```
node --test --experimental-strip-types 'src/capabilities/identity/*.test.ts'
npm run check
node scripts/freeze-ports.mjs --check
```

Then, to see it: `npm run console` and open the **identity** panel at
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
