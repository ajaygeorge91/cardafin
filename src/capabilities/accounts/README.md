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

All three pass from a clean clone with no `node_modules`, no network, no key and no
Blockfrost project id:

```
node --test --experimental-strip-types 'src/capabilities/accounts/*.test.ts'
npm run check
node scripts/freeze-ports.mjs --check
```

Then, to see it: `npm run console` and open the **accounts** panel at
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
