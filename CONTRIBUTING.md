# Contributing to cardafin

Thanks for looking. This file is short because `docs/ARCHITECTURE.md` is the
real spec; what follows is only what you need to get a change merged.

## Setup

Node 22.12 or newer, and nothing else:

```sh
git clone https://github.com/ajaygeorge91/cardafin && cd cardafin
npm test               # the whole suite, no install needed
npm run console:probe  # every HTTP route, printed as text
```

`npm install` is needed only for `npm run typecheck`, since `typescript` is a
devDependency rather than part of the Node runtime.

## The one command

```sh
npm run check   # typecheck + tests
```

If that is green and your change does what it says, it is reviewable. CI runs
the same thing plus the probe and the port-contract check.

## Four rules, each enforced by a test

These are not style preferences. A pull request that breaks one fails, and the
failure message tells you which:

1. **Purity** (`src/core/purity.test.ts`). `src/core`, `src/ports`,
   `src/services`, `src/capabilities`, `src/fixtures` and
   `src/adapters/memory` may import only relative paths and `node:` builtins.
   `src/adapters/lucid` is the single exemption. This is what lets the suite
   run offline with nothing installed, which is the property the whole repo is
   arranged around — please do not trade it away for convenience.
2. **Module isolation** (`src/capabilities/isolation.test.ts`). No module under
   `src/capabilities/` imports another. Cross-module traffic goes through a
   port in `src/ports/`.
3. **Frozen ports** (`src/ports/frozen.test.ts`). The port contracts are
   fingerprinted. Changing one is fine, but it is a deliberate act: run
   `npm run freeze` and include the one-line manifest diff in your commit, so
   a contract change is reviewed as a contract change. Rewording a doc comment
   does not count and does not need a re-freeze.
4. **Licence headers** (`src/core/license.test.ts`). Every source file starts
   with the two-line SPDX header. Copy it from any neighbouring file.

## Adding a module

```sh
npm run new-capability records "Listing versions recorded on chain"
```

writes a folder with a brief and a route declaration, then names the two lines
to add to `src/capabilities/registry.ts` — the only shared file. Fill in the
README's Scope section before writing code; the brief is how anyone else knows
what the module is for.

Routes answer `501 NOT_IMPLEMENTED` until implemented, and
`npm run console:probe` shows which are still dark. A module is done when its
tests pass under `npm run check` and the probe shows its routes answering 200.

## Style

There is no linter and no formatter, on purpose — they would be the first
dependencies in a repo whose tests deliberately have none. So: match the file
you are editing. Two-space indent, double quotes in `src/`, single quotes in
`web/` (that half started life in another project). Comments should record a
decision or a trap that is not obvious from the code; the ports and the
adapters are the best examples of the density to aim for.

Prefer a test that would have caught the bug over a comment saying not to make
it again.

## Pull requests

- One change per pull request, with a subject line that says what changed.
- Explain *why* in the body if it is not obvious. Link an issue if there is one.
- New behaviour comes with a test. Bug fixes come with the test that fails
  before the fix.
- Adding a runtime dependency needs a sentence on why, because the answer is
  usually no. The two that exist are confined to `src/adapters/lucid`.

## Things worth knowing before you start something large

- **Mainnet is gated.** `loadConfig` refuses to start against Mainnet without
  `CARDAFIN_MAINNET_CONFIRM=I_UNDERSTAND_REAL_FUNDS`, and every executor
  re-checks. Do not weaken that.
- **No secrets anywhere**, including fixtures, tests and comments. Fixtures use
  `example.com` and obviously-fake placeholders. The public BIP-39 test vector
  in `.env.example` is the only mnemonic-shaped string in the repo and it has
  never held funds.
- **The five modules in `src/capabilities/` are unimplemented by design.** If
  you want to take one on, open an issue first so two people do not write the
  same CBOR decoder.

## Licence

By contributing you agree your contribution is licensed under the Apache
License 2.0, the same as the project (see §5 of `LICENSE`). There is no
separate CLA.
