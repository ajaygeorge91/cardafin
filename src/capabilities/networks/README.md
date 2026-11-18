# networks

Network and provider selection, rate limiting, failover.

One codebase, three chains. Network selection already exists in `core/network.ts`; this makes
it operationally real and implements `ports/provider.ts`.

## Scope

1. **Providers behind one interface** — Blockfrost (10 req/s, burst 500), Koios (100 per 10 s,
   no key), Maestro. Selection is **config, never an import**: the same build talks to any of
   them with no conditional compilation above the adapter line.
2. **A rate-limited batched scheduler** — reads `ProviderLimits` rather than hard-coding a
   number per call site. This is what makes `accounts`' 100-enterprise-address fetch bearable.
3. **Retry with backoff, and failover** — sticky enough not to flap, and it must *recover*: a
   demoted provider is retried after a cooldown, not abandoned for the life of the process.
4. **Cached `ProtocolParams`** with a TTL keyed by network, read through `ports/clock.ts`.
5. **The mainnet gate, promoted** — `CARDAFIN_MAINNET_CONFIRM=I_UNDERSTAND_REAL_FUNDS` plus a
   spend ceiling and dry-run-by-default on Mainnet.

## The conformance suite is the deliverable

One shared test file that **every** `ChainProvider` must pass, rather than each adapter having
its own bespoke tests. It runs against the memory adapter everywhere; it runs against a real
provider only on a machine that has a key, which means never in CI. An adapter that does not
pass it is not an adapter.

## Testing time without waiting

Every expiry, cooldown and rate-limit window reads `ports/clock.ts`. A test that sleeps is a
test that is slow and flaky; a fake clock makes "ten seconds of requests" instant and exact.
The scheduler check is: for a 120-address fetch against a provider declaring 10 req/s, no
more than 10 requests land in any one-second window of the fake clock.

## Done when

All three pass from a clean clone with no `node_modules`, no network, no key and no
Blockfrost project id:

```
node --test --experimental-strip-types 'src/capabilities/networks/*.test.ts'
npm run check
node scripts/freeze-ports.mjs --check
```

Then, to see it: `npm run console` and open the **networks** panel at
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
