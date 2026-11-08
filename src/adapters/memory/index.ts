// The in-memory adapter set: a complete, deterministic implementation of
// every port, with no npm dependency and no network. Imported by tests and by
// nothing in `src/services` or `src/core`.
//
// Kept out of `src/index.ts` on purpose: the public barrel stays free of
// adapters so that importing cardafin never drags in a fake ledger.
//
// See docs/ARCHITECTURE.md §4.

export * from "./keys.ts";
export * from "./ledger.ts";
export * from "./hydra.ts";
export * from "./app.ts";
