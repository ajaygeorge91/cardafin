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

`npm run check` passes with the tests you add under
`src/capabilities/networks/`, and `npm run console:probe` shows every `networks`
route answering 200 instead of 501.

To watch it work: `npm run console` and the **networks** panel at
http://localhost:8787/console.


See `../README.md` for the rules every module keeps.
