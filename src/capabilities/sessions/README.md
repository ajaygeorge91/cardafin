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

`npm run check` passes with the tests you add under
`src/capabilities/sessions/`, and `npm run console:probe` shows every `sessions`
route answering 200 instead of 501.

To watch it work: `npm run console` and the **sessions** panel at
http://localhost:8787/console.


See `../README.md` for the rules every module keeps.
