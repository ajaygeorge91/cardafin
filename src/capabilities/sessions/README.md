# sessions

OAuth + wallet login, and the account link between them.

The plotmap-shaped auth surface, bridged to Cardano. Depends on `identity` **only** through
`ports/identity.ts` — it has no idea what COSE is, and its tests run against a fake verifier,
which is why this module and `identity` can be built in either order.

## Scope

1. **`ports/oauth.ts` adapters** — the Google/Instagram shape plotmap already runs. Real ones
   never execute in a test.
2. **Stateless sessions** — HS256 JWT via `node:crypto`, no jwt library. Issue, verify,
   refresh with rotation, revoke, revoke-all, clock-skew tolerance.
3. **Account linking** — one account, two kinds of credential: an OAuth subject and a stake
   address, either able to log in.
4. **Route split** — user routes move to sessions; machine routes (plotmap's backend is a
   machine client) stay on the bearer API key.

## This is the module, not the JWT

A JWT issuer is generic code that could live in any repo — and a task that could be applied
to any repo is not complex enough. The part that is specific to cardafin is the **link state
machine**, and it is where the rules live:

- Linking a credential already attached to **another** account is refused. Silently merging
  accounts is a data-loss bug; silently re-pointing one is account takeover.
- Unlinking the **last** credential is refused. It orphans the account beyond recovery.
- Linking requires a fresh `"link"`-purpose proof **from the credential being added**, never
  only a session from the one already present.
- An **unverified** OAuth email is never enough to link to an existing account. That is
  account takeover with extra steps.

## Done-when scenarios

A wallet login and an OAuth login land on the same linked account · a tampered JWT is refused
· a revoked session is refused · refresh rotates and invalidates the old token · the fake
OAuth provider is never called during a wallet login · each of the four link rules above has
a test that fails if the rule is removed.

## Done when

All three pass from a clean clone with no `node_modules`, no network, no key and no
Blockfrost project id:

```
node --test --experimental-strip-types 'src/capabilities/sessions/*.test.ts'
npm run check
node scripts/freeze-ports.mjs --check
```

Then, to see it: `npm run console` and open the **sessions** panel at
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
