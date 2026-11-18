# accounts

Address derivation, gap-limit discovery and portfolio aggregation.

Implements the consumer side of `ports/accounts.ts`. Answers "what addresses does this wallet
have, and what is in them" — for base addresses, enterprise addresses and the reward address.

## Scope

1. **CIP-1852 path maths** — `m / 1852' / 1815' / account' / role / index`, roles 0 external,
   1 internal, 2 staking. Pure; validation of every segment, hardened-index handling.
2. **Address kinds** — base (payment + stake), enterprise (payment only, no stake part),
   reward. Pointer addresses are rejected, not supported. `core/address.ts` already encodes
   all three.
3. **Enumeration** — derive N addresses of a kind for an account. 100 is a display number,
   not a discovery number (below).
4. **Discovery** — a pure scan over `AccountReader.isUsed` with a configurable gap limit,
   default **20**.
5. **Portfolio aggregation** — fold `getUtxosBatch` results into one `Assets`, group by
   policy, keep lovelace separate, and surface the min-ADA locked per UTxO.

## The two facts that shape this module

- **Gap limit 20 is interoperability, not performance.** A wallet that hands out an address
  more than 20 past the last used one makes it undiscoverable to any other wallet restoring
  the same seed. Derive 100 for display; never hand out past the gap.
- **Enterprise addresses cost 100× more to inspect.** Base addresses share one stake
  credential, so `getAccountAddresses` returns the whole account in a call or two. Enterprise
  addresses have no stake part and are invisible to that call — 100 of them is 100 lookups,
  which at Blockfrost's 10 req/s is ten seconds. Use `getUtxosBatch`, never a loop over
  `ChainReader.getUtxos`.

Note that `isUsed`, not `getUtxos`, is the discovery primitive: an address that was used and
then emptied is still *used* and must not end a scan.

## Fixtures

The memory adapter ships a deterministic ledger of 120+ addresses with several seeded gap
patterns — a clean run, a gap of exactly 19, a gap of exactly 20, and a used-then-emptied
address sitting inside a gap.

## Done when

`npm run check` passes with the tests you add under
`src/capabilities/accounts/`, and `npm run console:probe` shows every `accounts`
route answering 200 instead of 501.

To watch it work: `npm run console` and the **accounts** panel at
http://localhost:8787/console.


See `../README.md` for the rules every module keeps.
