# capabilities

One folder per module. A module declares its routes in `capability.ts` and
`registry.ts` lists it in one line, so adding a module never means editing a
shared table. Each folder's `README.md` is its brief.

Scaffold a new one with `npm run new-capability <name> "<description>"`.

All five modules here are briefs and route declarations — the implementations
are the work. Every route answers `501 NOT_IMPLEMENTED` with a pointer to its
own README until it is written; `npm run console:probe` shows which.

## Rules every module keeps

- **Pure** request parsing and planning: nothing but `../../core` and
  `../../ports`. No npm, no lucid, no network, no clock of its own.
- **Isolated**: never import another module. Cross-module traffic goes
  through a port, and `isolation.test.ts` enforces it.
- **Closed shape**: unknown request fields are rejected, not ignored.
- **Ports are frozen**: changing `src/ports/*.ts` means `npm run freeze` and
  a one-line manifest diff. Four other modules depend on them.
- **Fixtures are obviously fake**: `example.com`, placeholder words, never a
  real address, mnemonic or project id, in code, fixtures or comments.

## Done when

For any module: `npm run check` passes with the tests you added under
`src/capabilities/<name>/`, and `npm run console:probe` shows every one of
its routes answering 200 instead of 501.
