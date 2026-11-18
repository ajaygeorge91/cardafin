# Plotmap brief for cardafin — listings recorded on Cardano

Plotmap (plotmap.com) is my own product — a map-first real-estate marketplace for independent
brokers in Kerala — and cardafin's first real consumer. I wrote this brief in Plotmap's voice
to force myself to specify what cardafin owes a client before building it, rather than
designing the service around whatever was convenient. It is a requirements document, not an
outside commission.

Date: 2026-11-10. Read `docs/ARCHITECTURE.md` first; this brief builds on it and does not
override its one rule (core is pure, adapters at the edge, tests run offline against the
memory adapters).

## 1. What Plotmap is asking for

Plotmap is a map-first real-estate marketplace for independent brokers, starting in Kerala.
A broker publishes a listing; for a one-time fee per listing they can press **Record on
chain**. From then on every version of that listing (price change, Sold, Rented, Off market,
transfer to another lister) is written to Cardano as an update to that listing's token, so
anyone can verify that this property was listed at this price by this account on this date
and how it changed. Later, updates should be instant and nearly free through a Hydra head,
settling to layer 1 when the head closes. The broker never needs a wallet.

cardafin is the service that does the chain part. Plotmap's backend keeps the authoritative
record (an immutable `listing_versions` history) and talks to cardafin over HTTP.

## 2. The contract Plotmap needs — one new capability: records

Add a **records** capability next to wallet, policies and tx, with the same discipline:
pure request validation in `core/requests.ts`, a plan in `core/plan.ts`, a service, routes
under `/v1`, memory fixtures, tests that never touch the network.

**`POST /v1/records`** — a record request. JSON, validated like the others; unknown fields are
rejected (the equivalent of `additionalProperties: false`).

| field | type | meaning |
| --- | --- | --- |
| `listingId` | string, 10 chars | Plotmap listing id, e.g. `6wm18g2a5x` |
| `version` | integer ≥ 1 | the `listing_versions` number this record stands for |
| `payloadHash` | sha256 hex | hash of that version's public payload, computed by Plotmap with cardafin's canonical-JSON rule |
| `status` | enum | ForSale · ForRent · Sold · Rented · OffMarket |
| `askAmount`, `askCurrency` | number ≥ 0, ISO 4217 | the ask at that version |
| `at` | date-time | when Plotmap published the version |
| `meta` | small object, optional | never free text about a person |
| `dryRun` | boolean, optional | same semantics as the other write routes |

**Nothing else, ever.** No names, emails, phones, street addresses, photos, descriptions.
The validator rejects them by name and by the closed shape. The chain holds ids, hashes,
prices, status and times. Anyone with the hash fetches the version from Plotmap's public API
and verifies it.

Mapping onto what cardafin already has: version 1 of a listing is a **mint** under a
Plotmap policy (one policy per Plotmap environment, created through `POST /v1/policies` and
kept by Plotmap as `policy.json`), asset name = the listing id; the metadata is the row above,
written with the existing CIP-25 path and the 64-byte chunking. Later versions are new
writes that reference the same asset; whether that is CIP-68 reference-datum updates or a
new metadata transaction per version is cardafin's call — tell us the trade-off in terms of
the five guarantees below.

**`GET /v1/records/:listingId`** — the record state: every version recorded, each with `txId`,
`status` (pending · confirmed · failed), `confirmedAt`, `layer` (L1 · hydra), `policyId`,
`assetName`, and any chain identifier cardafin wants to expose. Readable by anyone with an
API key; the public verifier (section 4) reads it too.

**Five guarantees Plotmap holds cardafin to:**
1. Idempotent: the same `listingId` + `version` recorded twice produces one chain write.
2. Ordered per listing: version N is never confirmed before version N−1.
3. Restart-safe: a request accepted before a crash is still completed after it. (v1 has no
   database by design; a records capability needs durable state, even a JSON file or SQLite
   under `data/`, so a queue survives a restart. Keep it behind a port with a memory adapter.)
4. Verifiable: a reader can recompute `payloadHash` from Plotmap's public payload and match.
5. Permanent: a recorded version is never deleted; Sold and OffMarket are new versions.

Also wanted, same style: `POST /v1/records/:listingId/refresh` to poll confirmations, and the
existing `hydra: true` pass-through kept on the request so the client contract does not change
when the head exists. Everything chain-specific stays yours: network, provider, token standard,
custody for the pilot, Hydra topology, fees and who pays them.

## 3. Modules, and tests a stranger can run

Plotmap will not be the only consumer, and I will not be the only person who ever has to
verify this. So the bar is: someone who has never seen the repo can check that a capability
works with one command and no setup — no key, no network, no database to stand up. cardafin
already clears it (`npm run check`, offline tests, memory adapters). Keep it that way and
make adding capabilities mechanical:

- One capability = one folder: `src/capabilities/<name>/` with `requests.ts`, `plan.ts` (pure),
  `service.ts`, `routes.ts`, `memory.ts` (fixtures for the memory adapters), `README.md`, and
  tests beside each file. The router registers capabilities from a list, not by hand-editing a
  table. A `node scripts/new-capability.mjs <name> "<description>"` generator writes the folder
  with a passing smoke test. Move wallet, policies and tx into this shape only if it is cheap;
  new work always uses it.
- Every capability's README states its "Done when" as exact commands, e.g.
  `npm run check` and `node --test src/capabilities/records/*.test.ts`.
- No real mnemonic, key, Blockfrost key or person's address anywhere, including fixtures and
  comments; placeholders are plain words (`YOUR_API_KEY_HERE`), fixtures use `example.com`.
- Pin versions that install on lagging registry mirrors — one sandbox 404'd on a package a
  day old. `engines.node >= 22.12` is fine, and the test suite needing no install at all is
  better.

## 4. The design ask — this is why we came to you

v1 deliberately has no web UI. Plotmap wants one now, and wants it stunning, because the
product's whole promise is trust and a broker has to feel it in ten seconds on a phone.

Before you design anything, interview Plotmap in one round of at most ten questions, one per
line, covering: the public name of the add-on and whether the pages live under plotmap.com or
a cardafin domain; who looks at it first (brokers, buyers, investors, developers); the one
action each page must drive; price and how it is sold; what proof a visitor sees (a live
record, a verifier, a head status); tone; languages (English first, Malayalam later); phones
on 3G in a field; what Plotmap already has (brand, logo, map screenshots); what must not
appear. Then one page of creative direction — palette, type pairing, layout concept, three
references from outside crypto, one real aesthetic risk — and wait for a yes. Then build.

Two surfaces:
1. **Public verifier** (`/verify/:listingId`): the listing's recorded versions on a timeline,
   each with its hash, status, price, time and a link to the transaction; a "recompute"
   control that fetches the version from Plotmap's public API, hashes it with the canonical
   rule and shows match or mismatch; readable by someone who has never heard the word NFT.
2. **Operator console** (behind the API key): wallet address and balance, policies, the
   records queue with pending/confirmed/failed, the Hydra head state once it exists, cost per
   operation in ADA and INR, dry-run previews shown as what will happen before it happens.

Constraints: TypeScript, static-exportable (plain HTML + Tailwind or Astro), no backend
needed to render the verifier against sample data, accessible (keyboard, contrast, reduced
motion), light and dark, fast on a mid-range Android. Copy for a broker: specific, plain, no
"revolutionize", no "web3 future", no emoji, no invented testimonials or numbers; every
placeholder marked. Ask before adding a dependency.

Brand you may use: deep slate `#2f556a`, ice `#ddeff9`, logo red `#a13348`; the wordmark is
lowercase "plotmap"; tagline "The real estate market, mapped." Plotmap never uses the words
"Pro" or "subscription" in its product; the add-on is sold per listing, one-time. If you need
a name before Plotmap gives one, use "Plotmap Chain" and mark it as a placeholder.

## 5. Order of work

1. The records capability against the memory adapters, with the five guarantees as tests.
2. The capability folder convention and generator.
3. The interview, the creative direction, then the verifier page against sample data.
4. The operator console.
5. Hydra routing behind `hydra: true`, when cardafin is ready; Plotmap's contract does not
   change for it.

Open on Plotmap's side: the public name of the add-on and its price. Everything else in this
brief is decided.
